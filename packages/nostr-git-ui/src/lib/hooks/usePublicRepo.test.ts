import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { usePublicRepo } from "./usePublicRepo.svelte";
import {
  getPendingRepoCreationTransactions,
  retryPendingRepoCreationMetadata,
} from "../utils/repo-creation-transaction";
import { publishRepoSyncAnnouncement, syncLocalRepoToTargets } from "../utils/remote-sync";
import { tokens } from "$lib/stores/tokens";
import { recoverRepoCreationRecord } from "../utils/repo-creation-recovery";
import type { PublicRepoSource } from "@nostr-git/core/git";

vi.mock("$lib/stores/tokens", () => ({
  tokens: {
    waitForInitialization: vi.fn(async () => [{ host: "codeberg.org", token: "target-token" }]),
  },
}));
vi.mock("../utils/remote-targets.js", async (original) => ({
  ...(await original<typeof import("../utils/remote-targets")>()),
  preflightNewRemoteTargets: async ({ targets }: any) => targets,
}));
vi.mock("../utils/remote-sync.js", async (original) => ({
  ...(await original<typeof import("../utils/remote-sync")>()),
  publishRepoSyncAnnouncement: vi.fn(async () => ({
    announcementEvent: {},
    announcementByGraspRelay: {},
    graspRelayUrls: [],
    latestAnnouncementCreatedAt: 1,
  })),
  syncLocalRepoToTargets: vi.fn(async () => [
    {
      id: "destination",
      label: "Codeberg",
      provider: "forgejo",
      success: true,
      remoteUrl: "https://codeberg.org/me/copy.git",
      webUrl: "https://codeberg.org/me/copy",
    },
  ]),
}));
vi.mock("../utils/grasp-pipeline.js", async (original) => ({
  ...(await original<typeof import("../utils/grasp-pipeline")>()),
  reconcileRepoCreationEvents: async (params: any) => ({
    announcementEvent: params.buildAnnouncement({
      relays: params.relayUrls,
      graspCloneUrls: [],
      createdAt: 3,
    }),
    stateEvent: params.stateEvent,
    graspCloneUrls: [],
    relays: params.relayUrls,
    cleanupFailures: [],
  }),
}));

const owner = "a".repeat(64);
const relay = "wss://metadata.example/";
const source: PublicRepoSource = {
  id: "42",
  provider: "forgejo",
  host: "codeberg.org",
  owner: "o",
  name: "r",
  url: "https://codeberg.org/o/r",
  cloneUrl: "https://codeberg.org/o/r.git",
  displayName: "Source",
  description: "Description",
  topics: [],
  defaultBranch: "trunk",
  empty: false,
};
const metadata = () =>
  new Response(
    JSON.stringify({
      id: 42,
      name: "r",
      full_name: "o/r",
      private: false,
      default_branch: "trunk",
      html_url: source.url,
      clone_url: source.cloneUrl,
    })
  );
const refs = [
  { ref: "refs/heads/trunk", oid: "b".repeat(40) },
  { ref: "refs/tags/v1", oid: "c".repeat(40) },
];

function setup() {
  const worker = {
    isRepoCloned: vi.fn(async () => false),
    cloneRemoteRepo: vi.fn(async () => {}),
    listServerRefs: vi.fn(async () => refs),
    resolveRef: vi.fn(async ({ ref }) => refs.find((item) => item.ref === ref)?.oid),
    deleteRepo: vi.fn(async () => ({ success: true })),
    getOperationStatus: vi.fn(async ({ operationId }) => ({
      operationId,
      operation: operationId.includes(":deleteRepo:") ? "deleteRepo" : "cloneRemoteRepo",
      state: "completed",
      stage: "done",
    })),
  };
  const publish = vi.fn(async (event, context) => ({
    event: { ...event, pubkey: owner, id: "d".repeat(64), sig: "signature" },
    ackedRelays: context.relays,
    failedRelays: [],
    hasRelayOutcomes: true,
  }));
  const fetchEvents = vi.fn(async () => []);
  const deleteEvent = vi.fn();
  const hook = usePublicRepo({
    workerApi: worker,
    userPubkey: owner,
    onPublishEvent: publish,
    onFetchRelayEvents: fetchEvents,
    onDeleteEvent: deleteEvent,
  });
  return { hook, worker, publish, fetchEvents, deleteEvent };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "$state",
    Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T) => value })
  );
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return storage.size;
    },
    key: (n: number) => Array.from(storage.keys())[n],
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
    removeItem: (k: string) => storage.delete(k),
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => metadata())
  );
});
afterEach(() => vi.unstubAllGlobals());

describe("public repository execution", () => {
  it("keeps zero-ACK copy announcements until exact cleanup succeeds", async () => {
    const { hook, worker, publish, fetchEvents, deleteEvent } = setup();
    const actual =
      await vi.importActual<typeof import("../utils/remote-sync")>("../utils/remote-sync");
    vi.mocked(publishRepoSyncAnnouncement).mockImplementationOnce((params) =>
      actual.publishRepoSyncAnnouncement({ ...params, announcementRetryDelayMs: 0 })
    );
    let signed = 0;
    publish.mockImplementation(async (event, context) => {
      const exact = event.id
        ? event
        : {
            ...event,
            pubkey: owner,
            id: (++signed).toString().padStart(64, "0"),
            sig: "signature",
          };
      context.onBeforePublish(exact);
      return { event: exact, ackedRelays: [], failedRelays: [relay], hasRelayOutcomes: true };
    });
    deleteEvent.mockRejectedValue(new Error("Deletion ACK lost"));
    expect(
      await hook.createRepository({
        mode: "copy",
        source,
        forkName: "lost-copy-acks",
        relays: [relay],
        targets: [
          { id: "destination", label: "Codeberg", provider: "forgejo", host: "codeberg.org" },
        ],
      })
    ).toBeNull();
    expect(signed).toBe(1);
    expect(publish).toHaveBeenCalledTimes(3);
    expect(deleteEvent).toHaveBeenCalledTimes(1);
    const [pending] = getPendingRepoCreationTransactions();
    expect(pending.publishedEvents).toHaveLength(1);
    expect(pending.pendingCompensations).toHaveLength(1);
    expect(pending.eventAcks).toHaveLength(6);
    expect(pending.eventAcks.every((ack) => ack.ackedRelays.length === 0)).toBe(true);
    expect(worker.cloneRemoteRepo).not.toHaveBeenCalled();
    expect(syncLocalRepoToTargets).not.toHaveBeenCalled();
    deleteEvent.mockResolvedValue(undefined);
    expect(
      (
        await recoverRepoCreationRecord(pending, {
          workerApi: worker,
          publisher: publish,
          fetchRelayEvents: fetchEvents,
          onDeleteEvent: deleteEvent,
        })
      ).status
    ).toBe("recovered");
    expect(getPendingRepoCreationTransactions()).toEqual([]);
    expect(deleteEvent.mock.calls.slice(1).map(([event, relays]) => [event.id, relays])).toEqual(
      pending.publishedEvents.map((item) => [item.event.id, [relay]])
    );
    expect(publish).toHaveBeenCalledTimes(3);
  });
  it("retains copy publication evidence when delivery throws after checkpointing", async () => {
    const { hook, worker, publish, fetchEvents, deleteEvent } = setup();
    deleteEvent.mockRejectedValueOnce(new Error("Deletion disconnected"));
    const actual =
      await vi.importActual<typeof import("../utils/remote-sync")>("../utils/remote-sync");
    vi.mocked(publishRepoSyncAnnouncement).mockImplementationOnce((params) =>
      actual.publishRepoSyncAnnouncement({ ...params, announcementRetryDelayMs: 0 })
    );
    publish.mockImplementationOnce(async (event, context) => {
      context.onBeforePublish({ ...event, pubkey: owner, id: "e".repeat(64), sig: "signature" });
      throw new Error("Transport disconnected after delivery started");
    });
    expect(
      await hook.createRepository({
        mode: "copy",
        source,
        forkName: "copy-disconnected",
        relays: [relay],
        targets: [
          { id: "destination", label: "Codeberg", provider: "forgejo", host: "codeberg.org" },
        ],
      })
    ).toBeNull();
    const [pending] = getPendingRepoCreationTransactions();
    expect(pending.publishedEvents[0].event.id).toBe("e".repeat(64));
    expect(pending.eventAcks).toHaveLength(1);
    expect(
      (
        await recoverRepoCreationRecord(pending, {
          workerApi: worker,
          publisher: publish,
          fetchRelayEvents: fetchEvents,
          onDeleteEvent: deleteEvent,
        })
      ).status
    ).toBe("recovered");
    expect(deleteEvent).toHaveBeenCalledWith(pending.publishedEvents[0].event, [relay]);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(worker.cloneRemoteRepo).not.toHaveBeenCalled();
  });
  it("releases a rejected signing attempt and permits retrying the same identifier", async () => {
    const { hook, publish } = setup();
    const config = {
      mode: "announce" as const,
      source,
      forkName: "sign-retry",
      targets: [],
      relays: [relay],
    };
    publish.mockImplementationOnce(async (_event, context) => {
      context.onPrepare();
      throw new Error("Signer rejected the request");
    });
    expect(await hook.createRepository(config)).toBeNull();
    expect(hook.error).toMatch(/Signer rejected/);
    expect(getPendingRepoCreationTransactions()).toEqual([]);
    expect(await hook.createRepository(config)).not.toBeNull();
  });

  it("retains the exact signed receipt when delivery throws before returning ACKs", async () => {
    const { hook, publish } = setup();
    publish.mockImplementationOnce(async (event, context) => {
      context.onPrepare();
      context.onBeforePublish({ ...event, pubkey: owner, id: "d".repeat(64), sig: "signature" });
      throw new Error("Transport disconnected after delivery started");
    });
    expect(
      await hook.createRepository({
        mode: "announce",
        source,
        forkName: "lost-ack",
        targets: [],
        relays: [relay],
      })
    ).toBeNull();
    expect(getPendingRepoCreationTransactions()[0]).toMatchObject({
      phase: "metadata-pending",
      publicationNotStarted: false,
      publishedEvents: [{ event: { id: "d".repeat(64) } }],
    });
  });

  it("does not discard an uncheckpointed publisher's unknown outcome", async () => {
    const { hook, publish } = setup();
    publish.mockRejectedValueOnce(new Error("Unknown publication outcome"));
    expect(
      await hook.createRepository({
        mode: "announce",
        source,
        forkName: "unknown-announcement",
        targets: [],
        relays: [relay],
      })
    ).toBeNull();
    expect(getPendingRepoCreationTransactions()[0]).toMatchObject({
      publicationNotStarted: false,
      publishedEvents: [],
    });
  });

  it("announces an existing public URL with no clone, state, target credentials or fork relationship", async () => {
    const { hook, worker, publish } = setup();
    const result = await hook.createRepository({
      mode: "announce",
      source,
      forkName: "announcement",
      targets: [],
      relays: [relay],
    });
    expect(hook.error).toBeNull();
    expect(result?.stateEvent).toBeUndefined();
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0][0].kind).toBe(30617);
    expect(result?.announcementEvent.tags).toContainEqual(["clone", source.cloneUrl]);
    expect(result?.announcementEvent.tags.some((tag) => tag[0] === "upstream")).toBe(false);
    for (const method of Object.values(worker)) expect(method).not.toHaveBeenCalled();
    expect(tokens.waitForInitialization).not.toHaveBeenCalled();
    expect(getPendingRepoCreationTransactions()).toHaveLength(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({ credentials: "omit" });
  });

  it("retains exact announcement-only delivery evidence and can recover without a state event", async () => {
    const { hook, publish } = setup();
    publish.mockImplementationOnce(async (event) => ({
      event: { ...event, pubkey: owner, id: "d".repeat(64), sig: "signature" },
      ackedRelays: [],
      failedRelays: [relay],
      hasRelayOutcomes: true,
    }));
    expect(
      await hook.createRepository({
        mode: "announce",
        source,
        forkName: "recover",
        targets: [],
        relays: [relay],
      })
    ).toBeNull();
    const [record] = getPendingRepoCreationTransactions();
    expect(record).toMatchObject({
      announcementOnly: true,
      phase: "metadata-pending",
      targets: [],
    });
    const exact = record.publishedEvents[0].event;
    await retryPendingRepoCreationMetadata(record, publish, async () => [exact]);
    expect(publish.mock.calls[1][0]).toEqual(exact);
    expect(getPendingRepoCreationTransactions()).toHaveLength(0);
  });

  it("uses the shared copy path with anonymous source reads despite a same-host target token", async () => {
    const { hook, worker } = setup();
    const result = await hook.createRepository({
      mode: "copy",
      source,
      forkName: "copy",
      targets: [
        {
          id: "destination",
          provider: "forgejo",
          label: "Codeberg",
          host: "codeberg.org",
          token: "target-token",
        },
      ],
      relays: [relay],
    });
    expect(hook.error).toBeNull();
    expect(result).not.toBeNull();
    expect(worker.cloneRemoteRepo).toHaveBeenCalledTimes(1);
    expect(worker.cloneRemoteRepo.mock.calls[0][0]).toMatchObject({
      url: source.cloneUrl,
      publicSource: true,
    });
    expect(worker.cloneRemoteRepo.mock.calls[0][0]).not.toHaveProperty("token");
    expect(worker.listServerRefs).toHaveBeenCalledWith({
      url: source.cloneUrl,
      symrefs: true,
      publicSource: true,
    });
    expect(syncLocalRepoToTargets).toHaveBeenCalledWith(
      expect.objectContaining({
        strictSourceSnapshot: true,
        refs: expect.arrayContaining([expect.objectContaining({ ref: "refs/tags/v1" })]),
        upstreams: undefined,
      })
    );
    expect(result?.announcementEvent.tags).toContainEqual([
      "clone",
      "https://codeberg.org/me/copy.git",
    ]);
    expect(result?.announcementEvent.tags.some((tag) => tag[0] === "upstream")).toBe(false);
  });

  it("does not push an incomplete clone or a changed source snapshot", async () => {
    const { hook, worker } = setup();
    worker.resolveRef.mockResolvedValue("f".repeat(40));
    expect(
      await hook.createRepository({
        mode: "copy",
        source,
        forkName: "bad-copy",
        targets: [
          { id: "destination", provider: "forgejo", label: "Codeberg", host: "codeberg.org" },
        ],
        relays: [relay],
      })
    ).toBeNull();
    expect(hook.error).toMatch(/incomplete/);
    expect(syncLocalRepoToTargets).not.toHaveBeenCalled();
    expect(worker.deleteRepo).toHaveBeenCalled();
  });

  it("announces only verified destinations after a partial copy failure", async () => {
    const { hook } = setup();
    vi.mocked(syncLocalRepoToTargets).mockResolvedValueOnce([
      {
        id: "good",
        label: "Good",
        provider: "forgejo",
        success: true,
        remoteUrl: "https://codeberg.org/me/copy.git",
      },
      {
        id: "bad",
        label: "Bad",
        provider: "gitlab",
        success: false,
        createdRemote: true,
        pushedRefs: ["refs/heads/trunk"],
        failedRefs: [{ ref: "refs/tags/v1", error: "rejected" }],
        remoteUrl: "https://gitlab.com/me/copy.git",
        error: "rejected",
      },
    ]);
    const result = await hook.createRepository({
      mode: "copy",
      source,
      forkName: "partial",
      relays: [relay],
      targets: [
        { id: "good", label: "Good", provider: "forgejo", host: "codeberg.org" },
        { id: "bad", label: "Bad", provider: "gitlab", host: "gitlab.com" },
      ],
    });
    expect(result).not.toBeNull();
    expect(hook.warning).toMatch(/Synced 1\/2/);
    expect(result!.announcementEvent.tags.filter((tag) => tag[0] === "clone")).toEqual([
      ["clone", "https://codeberg.org/me/copy.git"],
    ]);
    const [pending] = getPendingRepoCreationTransactions();
    expect(pending).toMatchObject({
      phase: "cleanup-pending",
      manualAttention: { required: true },
    });
    expect(pending.targets.find((target) => target.id === "bad")).toMatchObject({
      manualAttention: true,
      createdRemote: true,
      refs: [
        { ref: "refs/heads/trunk", stage: "pushed" },
        { ref: "refs/tags/v1", stage: "failed" },
      ],
    });
  });

  it("retains an unknown worker outcome without pushing or deleting the clone", async () => {
    const { hook, worker } = setup();
    worker.getOperationStatus.mockImplementation(async ({ operationId }) => ({
      operationId,
      operation: "cloneRemoteRepo",
      stage: "unknown",
      state: "unknown",
    }));
    expect(
      await hook.createRepository({
        mode: "copy",
        source,
        forkName: "unknown-copy",
        targets: [
          { id: "destination", provider: "forgejo", label: "Codeberg", host: "codeberg.org" },
        ],
        relays: [relay],
      })
    ).toBeNull();
    expect(syncLocalRepoToTargets).not.toHaveBeenCalled();
    expect(worker.deleteRepo).not.toHaveBeenCalled();
    expect(getPendingRepoCreationTransactions()[0].localResource.stage).toBe("unknown");
  });

  it("checks the actor before network work", async () => {
    const publish = vi.fn();
    const hook = usePublicRepo({
      userPubkey: owner,
      onPublishEvent: publish,
      assertActor: () => {
        throw new Error("Account changed");
      },
    });
    expect(
      await hook.createRepository({
        mode: "announce",
        source,
        forkName: "changed",
        targets: [],
        relays: [relay],
      })
    ).toBeNull();
    expect(hook.error).toBe("Account changed");
    expect(fetch).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
