import { nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recoverRepoCreationRecord } from "./repo-creation-recovery.js";
import {
  getPendingRepoCreationTransactions,
  persistRepoCreationRecoveryRecord,
  type RepoCreationRecoveryRecord,
} from "./repo-creation-transaction.js";
import { createRepoStateEvent } from "@nostr-git/core/events";
import { reserveRepoCreation } from "./repo-creation-preflight.js";
import type { PublishRepoEvent } from "./grasp-pipeline.js";

function record(overrides: Partial<RepoCreationRecoveryRecord> = {}): RepoCreationRecoveryRecord {
  return {
    version: 2,
    id: "new:owner/repo:1",
    operation: "new",
    ownerPubkey: "a".repeat(64),
    repoName: "repo",
    phase: "syncing",
    localRepoId: "owner/repo",
    localResource: { id: "owner/repo", ownedByTransaction: true, stage: "created" },
    targets: [],
    targetResults: [],
    publishedEvents: [],
    eventAcks: [],
    pendingCompensations: [],
    cleanup: { stage: "not-needed", manualAttention: false },
    manualAttention: { required: false },
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function storage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (index: number) => Array.from(values.keys())[index] || null,
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
    clear: () => values.clear(),
  } as Storage;
}

describe("repository creation recovery", () => {
  beforeEach(() => vi.stubGlobal("localStorage", storage()));

  it("keeps an ambiguous remote without replaying mutations", async () => {
    const createRemoteRepo = vi.fn();
    const pushToRemote = vi.fn();
    const pending = record({
      targets: [
        {
          id: "git:github.com",
          label: "GitHub",
          provider: "github",
          stage: "pushing",
          remoteUrl: "https://github.com/alice/repo.git",
          refs: [{ ref: "refs/heads/main", commit: "a".repeat(40), stage: "pushing" }],
          cleanup: { stage: "unknown", manualAttention: true },
          manualAttention: true,
          updatedAt: 1,
        },
      ],
    });

    const result = await recoverRepoCreationRecord(pending, {
      workerApi: {
        listServerRefs: vi.fn().mockRejectedValue(new Error("network unavailable")),
        createRemoteRepo,
        pushToRemote,
      },
      publisher: vi.fn(),
      fetchRelayEvents: vi.fn(),
      onDeleteEvent: vi.fn(),
    });

    expect(result.status).toBe("pending");
    expect(result.record?.targets[0].stage).toBe("unknown");
    expect(createRemoteRepo).not.toHaveBeenCalled();
    expect(pushToRemote).not.toHaveBeenCalled();
  });

  it("reconciles final metadata from a verified survivor without replaying Git mutations", async () => {
    const commit = "b".repeat(40);
    const ownerPubkey = "a".repeat(64);
    const legacyCloneUrl = `https://legacy.example/${nip19.npubEncode(ownerPubkey)}/repo.git`;
    const provisional = {
      id: "provisional",
      sig: "sig",
      kind: 30617,
      pubkey: ownerPubkey,
      created_at: 1,
      content: "",
      tags: [
        ["d", "repo"],
        ["name", "Repository Display Name"],
        ["t", "nostr"],
        ["clone", "https://github.com/alice/repo.git", legacyCloneUrl],
        ["web", "https://github.com/alice/repo"],
        ["relays", "wss://relay.example/", "wss://grasp.failed/"],
      ],
    };
    const publisher = vi.fn(async (event: any, context?: { relays?: string[] }) => ({
      event: {
        ...event,
        id: `${event.kind}-${event.created_at}`,
        sig: "sig",
        pubkey: ownerPubkey,
      },
      relayOutcomes: (context?.relays || []).map((relay) => ({
        relay,
        status: "success",
        detail: "stored",
      })),
    }));
    const createRemoteRepo = vi.fn();
    const pushToRemote = vi.fn();

    const result = await recoverRepoCreationRecord(
      record({
        repositoryRelayUrls: ["wss://selected.example/"],
        sourceMetadata: {
          cloneUrls: ["https://github.com/alice/repo.git", legacyCloneUrl],
          webUrls: ["https://github.com/alice/repo"],
          announcementEvent: provisional,
        },
        targets: [
          {
            id: "git:github.com",
            label: "GitHub",
            provider: "github",
            stage: "pushing",
            remoteUrl: "https://github.com/alice/repo.git",
            webUrl: "https://github.com/alice/repo",
            refs: [{ ref: "refs/heads/main", commit, stage: "pushing" }],
            cleanup: { stage: "not-needed", manualAttention: false },
            manualAttention: true,
            updatedAt: 1,
          },
          {
            id: "grasp:wss://grasp.failed/",
            label: "Failed GRASP",
            provider: "grasp",
            stage: "pushing",
            relayUrl: "wss://grasp.failed/",
            remoteUrl: "https://grasp.failed/npub1owner/repo.git",
            refs: [{ ref: "refs/heads/main", commit, stage: "pushing" }],
            cleanup: { stage: "not-needed", manualAttention: false },
            manualAttention: true,
            updatedAt: 1,
          },
        ],
        publishedEvents: [],
      }),
      {
        workerApi: {
          listServerRefs: vi.fn().mockResolvedValue([
            { ref: "refs/heads/main", oid: commit },
            { ref: "HEAD", target: "refs/heads/main", oid: commit },
          ]),
          createRemoteRepo,
          pushToRemote,
        },
        publisher,
        fetchRelayEvents: vi.fn().mockResolvedValue([]),
        onDeleteEvent: vi.fn(),
      }
    );

    expect(result.status).toBe("recovered");
    expect(publisher).toHaveBeenCalled();
    const finalAnnouncement = publisher.mock.calls
      .map(([event]) => event)
      .find((event) => event.kind === 30617);
    const finalCloneTag = finalAnnouncement?.tags.find((tag) => tag[0] === "clone");
    expect(finalCloneTag).toContain("https://github.com/alice/repo.git");
    expect(finalCloneTag).toContain(legacyCloneUrl);
    expect(finalAnnouncement?.tags).toContainEqual(["web", "https://github.com/alice/repo"]);
    expect(finalAnnouncement?.tags).toContainEqual(["relays", "wss://selected.example/"]);
    expect(finalAnnouncement?.tags).toContainEqual(["name", "Repository Display Name"]);
    expect(finalAnnouncement?.tags).toContainEqual(["t", "nostr"]);
    expect(
      publisher.mock.calls.every(
        ([, context]) => !(context?.relays || []).includes("wss://grasp.failed/")
      )
    ).toBe(true);
    expect(createRemoteRepo).not.toHaveBeenCalled();
    expect(pushToRemote).not.toHaveBeenCalled();
  });

  it("compensates a known failure and removes its transaction-owned local repo", async () => {
    const provisional = {
      id: "event",
      sig: "sig",
      kind: 30617,
      pubkey: "a".repeat(64),
      created_at: 1,
      content: "",
      tags: [["d", "repo"]],
    };
    const onDeleteEvent = vi.fn();
    const deleteRepo = vi.fn().mockResolvedValue({ success: true });
    const result = await recoverRepoCreationRecord(
      record({
        phase: "failed",
        targets: [
          {
            id: "git:github.com",
            label: "GitHub",
            provider: "github",
            stage: "planned",
            refs: [],
            cleanup: { stage: "not-needed", manualAttention: false },
            manualAttention: false,
            updatedAt: 1,
          },
        ],
        publishedEvents: [
          { event: provisional, relayUrls: ["wss://relay/"], stage: "provisional" },
        ],
      }),
      {
        workerApi: { deleteRepo },
        publisher: vi.fn(),
        fetchRelayEvents: vi.fn(),
        onDeleteEvent,
      }
    );

    expect(result.status).toBe("recovered");
    expect(onDeleteEvent).toHaveBeenCalledWith(provisional, ["wss://relay/"]);
    expect(deleteRepo).toHaveBeenCalledWith({ repoId: "owner/repo" });
  });

  it("retains failed local cleanup for retry", async () => {
    const result = await recoverRepoCreationRecord(
      record({ phase: "cleanup-pending", operation: "import" }),
      {
        workerApi: { deleteRepo: vi.fn().mockResolvedValue({ success: false, error: "busy" }) },
        publisher: vi.fn(),
        fetchRelayEvents: vi.fn(),
        onDeleteEvent: vi.fn(),
      }
    );

    expect(result.status).toBe("pending");
    expect(result.record?.localResource).toMatchObject({ stage: "cleanup-pending", error: "busy" });
  });

  it("does not clean up a persisted unknown worker outcome after reload", async () => {
    const deleteRepo = vi.fn();
    const onDeleteEvent = vi.fn();
    const result = await recoverRepoCreationRecord(
      record({
        phase: "cleanup-pending",
        workerOperations: [
          {
            operationId: "import:push:1",
            operation: "pushToRemote",
            stage: "Outcome unknown",
            state: "unknown",
            sideEffectMayHaveOccurred: true,
            startedAt: 1,
            updatedAt: 2,
            completedAt: 2,
          },
        ],
      }),
      {
        workerApi: { deleteRepo },
        publisher: vi.fn(),
        fetchRelayEvents: vi.fn(),
        onDeleteEvent,
      }
    );

    expect(result.status).toBe("pending");
    expect(result.reason).toContain("unknown outcome");
    expect(deleteRepo).not.toHaveBeenCalled();
    expect(onDeleteEvent).not.toHaveBeenCalled();
  });
});

const owner = "a".repeat(64);
const commit = "b".repeat(40);
const relay = "wss://metadata.test/";
const hosted = "https://github.com/fixture/repo.git";
const sourceEvent = (identifier = "repo") => ({
  id: "source",
  sig: "fixture",
  kind: 30617,
  pubkey: owner,
  created_at: 10,
  content: "old content",
  tags: [
    ["d", identifier],
    ["name", "Old name"],
    ["maintainers", "c".repeat(64)],
    ["u", "https://old-upstream.test/repo.git"],
    ["clone", "https://old-host.test/repo.git"],
    ["relays", relay],
  ],
});
const currentEvent = (identifier = "repo") => ({
  ...sourceEvent(identifier),
  id: "current",
  created_at: 20,
  content: "Current owner content",
  tags: [
    ["d", identifier],
    ["name", "Current name"],
    ["description", "Owner edited this"],
    ["u", "https://new-upstream.test/repo.git", "hint"],
    ["x-extension", "keep", "exactly"],
    ["clone", "https://current-host.test/repo.git"],
    ["web", "https://current-host.test/repo"],
    ["relays", relay],
  ],
});
function hostedRecord(identifier = "repo", overrides: Partial<RepoCreationRecoveryRecord> = {}) {
  const announcement = sourceEvent(identifier);
  return record({
    operation: "fork",
    repoName: identifier,
    localResource: { ownedByTransaction: false, stage: "created" },
    repositoryRelayUrls: [relay],
    sourceMetadata: {
      announcementEvent: announcement,
      cloneUrls: ["https://old-host.test/repo.git"],
      webUrls: [],
    },
    targets: [
      {
        id: "git:github.com",
        label: "GitHub",
        provider: "github",
        stage: "verified",
        remoteUrl: hosted,
        refs: [{ ref: "refs/heads/main", commit, stage: "verified" }],
        cleanup: { stage: "not-needed", manualAttention: false },
        manualAttention: false,
        updatedAt: 1,
      },
    ],
    targetResults: [
      {
        id: "git:github.com",
        label: "GitHub",
        provider: "github",
        remoteUrl: hosted,
        success: true,
        outcome: "ok",
      },
    ],
    ...overrides,
  });
}
function recoveryDeps() {
  let id = 0;
  const publisher = vi.fn<PublishRepoEvent>(async (event, context) => ({
    event: event.id ? event : { ...event, id: `signed-${++id}`, sig: "fixture", pubkey: owner },
    ackedRelays: context?.relays || [],
    failedRelays: [],
    relayOutcomes: (context?.relays || []).map((relay) => ({
      relay,
      status: "success",
      detail: "mock ACK",
    })),
  }));
  return {
    workerApi: {
      listServerRefs: vi.fn().mockResolvedValue([
        { ref: "refs/heads/main", oid: commit },
        { ref: "HEAD", target: "refs/heads/main", oid: commit },
      ]),
      createRemoteRepo: vi.fn(),
      pushToRemote: vi.fn(),
      deleteRepo: vi.fn(),
    },
    publisher,
    fetchRelayEvents: vi.fn().mockResolvedValue([]),
    onDeleteEvent: vi.fn(),
  };
}

function currentState(overrides: Partial<ReturnType<typeof createRepoStateEvent>> = {}) {
  return {
    ...createRepoStateEvent({
      repoId: "repo",
      identifier: "repo",
      head: "main",
      refs: [{ type: "heads", name: "main", commit }],
      created_at: 50,
    }),
    id: "current-state",
    sig: "fixture",
    pubkey: owner,
    ...overrides,
  };
}

describe("metadata recovery safety", () => {
  beforeEach(() => vi.stubGlobal("localStorage", storage()));

  it.each(["both", "relay state only", "Git refs only"])(
    "does not mint old checkpoint state after newer changes to %s",
    async (changed) => {
      const deps = recoveryDeps();
      const newerCommit = "d".repeat(40);
      const newerState = {
        ...createRepoStateEvent({
          repoId: "repo",
          identifier: "repo",
          head: "main",
          refs: [{ type: "heads", name: "main", commit: newerCommit }],
          created_at: 50,
        }),
        id: "newer-state",
        sig: "fixture",
        pubkey: owner,
      };
      if (changed !== "Git refs only") deps.fetchRelayEvents.mockResolvedValue([newerState]);
      if (changed !== "relay state only")
        deps.workerApi.listServerRefs.mockResolvedValue([
          { ref: "refs/heads/main", oid: newerCommit },
        ]);
      const pending = hostedRecord("repo", { phase: "metadata-preparing" });
      const result = await recoverRepoCreationRecord(pending, deps);
      expect(result.status).toBe("pending");
      expect(result.reason).toMatch(/state|refs/i);
      expect(result.record?.targets[0]).toEqual(pending.targets[0]);
      expect(deps.publisher).not.toHaveBeenCalled();
      expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
      expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    }
  );

  it("reads exact state for the owner and direct maintainers, not upstream authors", async () => {
    const deps = recoveryDeps();
    const maintainerState = currentState({
      pubkey: "c".repeat(64),
      tags: [
        ["d", "repo"],
        ["HEAD", "ref: refs/heads/next"],
      ],
    });
    deps.fetchRelayEvents.mockResolvedValue([maintainerState]);
    const result = await recoverRepoCreationRecord(
      hostedRecord("repo", { phase: "metadata-preparing" }),
      deps
    );
    expect(result).toMatchObject({
      status: "pending",
      record: { stateConflictEvent: maintainerState },
    });
    expect(deps.fetchRelayEvents).toHaveBeenCalledWith({
      relays: [relay],
      filters: [
        {
          kinds: [30618],
          authors: expect.arrayContaining([owner, "c".repeat(64)]),
          "#d": ["repo"],
        },
      ],
      timeoutMs: 5000,
      throwOnTimeout: true,
    });
    expect(deps.publisher).not.toHaveBeenCalled();
  });

  it.each(["other author", "other identifier"])("ignores state from %s", async (variant) => {
    const deps = recoveryDeps();
    deps.fetchRelayEvents.mockResolvedValue([
      currentState({
        pubkey: variant === "other author" ? "e".repeat(64) : owner,
        tags: [
          ["d", variant === "other identifier" ? "different-repo" : "repo"],
          ["refs/heads/else", "d".repeat(40)],
        ],
      }),
    ]);
    expect(
      await recoverRepoCreationRecord(hostedRecord("repo", { phase: "metadata-preparing" }), deps)
    ).toEqual({ status: "recovered" });
  });

  it("uses replaceable ordering and does not lose a state conflict across empty relay reads", async () => {
    const deps = recoveryDeps();
    const newer = currentState({
      id: "aaa",
      tags: [
        ["d", "repo"],
        ["refs/heads/main", "d".repeat(40)],
      ],
    });
    deps.fetchRelayEvents.mockResolvedValue([currentState({ id: "zzz" }), newer]);
    const conflict = await recoverRepoCreationRecord(
      hostedRecord("repo", { phase: "metadata-preparing" }),
      deps
    );
    expect(conflict.record?.stateConflictEvent).toEqual(newer);
    deps.fetchRelayEvents.mockResolvedValue([]);
    const stillPending = await recoverRepoCreationRecord(conflict.record!, {
      ...deps,
      reviewedAnnouncement: sourceEvent(),
    });
    expect(stillPending.record?.stateConflictEvent).toEqual(newer);
    expect(deps.publisher).not.toHaveBeenCalled();
    // A later authoritative resolution consistent with the live refs unblocks it.
    deps.fetchRelayEvents.mockResolvedValue([currentState({ created_at: 51 })]);
    expect(await recoverRepoCreationRecord(stillPending.record!, deps)).toEqual({
      status: "recovered",
    });
  });

  it("retains an intervening state observed before another relay times out", async () => {
    const deps = recoveryDeps();
    const otherRelay = "wss://unavailable-metadata.test/";
    const changed = currentState({
      tags: [
        ["d", "repo"],
        ["refs/heads/main", "d".repeat(40)],
      ],
    });
    deps.fetchRelayEvents.mockImplementation(async ({ relays, filters }) => {
      if (!filters[0].kinds.includes(30618)) return [];
      if (relays[0] === otherRelay) throw new Error("state read timed out");
      return [changed];
    });
    const result = await recoverRepoCreationRecord(
      hostedRecord("repo", {
        phase: "metadata-preparing",
        repositoryRelayUrls: [relay, otherRelay],
      }),
      deps
    );
    expect(result).toMatchObject({ status: "pending", record: { stateConflictEvent: changed } });
    deps.fetchRelayEvents.mockResolvedValue([]);
    expect(await recoverRepoCreationRecord(result.record!, deps)).toMatchObject({
      status: "pending",
      record: { stateConflictEvent: changed },
    });
    expect(deps.publisher).not.toHaveBeenCalled();
  });

  it("does not overwrite an advance on existing hosting while its new target is unchanged", async () => {
    const deps = recoveryDeps();
    const normal = deps.workerApi.listServerRefs.getMockImplementation()!;
    deps.workerApi.listServerRefs.mockImplementation(async ({ url }) =>
      url === hosted
        ? normal()
        : [
            { ref: "refs/heads/main", oid: "d".repeat(40) },
            { ref: "HEAD", target: "refs/heads/main" },
          ]
    );
    const result = await recoverRepoCreationRecord(
      hostedRecord("repo", { phase: "metadata-preparing" }),
      deps
    );
    expect(result).toMatchObject({
      status: "pending",
      reason: expect.stringContaining("Git refs changed"),
    });
    expect(deps.publisher).not.toHaveBeenCalled();
    expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
    expect(deps.workerApi.listServerRefs.mock.calls.map(([args]) => args.url)).not.toContain(
      "https://old-upstream.test/repo.git"
    );
  });

  it.each(["state read", "Git read", "missing HEAD"])(
    "fails closed when %s is unavailable",
    async (unavailable) => {
      const deps = recoveryDeps();
      if (unavailable === "state read")
        deps.fetchRelayEvents.mockImplementation(async ({ filters }) => {
          if (filters[0].kinds.includes(30618)) throw new Error("state relay offline");
          return [];
        });
      if (unavailable === "Git read")
        deps.workerApi.listServerRefs.mockRejectedValue(new Error("Git offline"));
      if (unavailable === "missing HEAD")
        deps.workerApi.listServerRefs.mockResolvedValue([{ ref: "refs/heads/main", oid: commit }]);
      const pending = hostedRecord("repo", { phase: "metadata-preparing" });
      const result = await recoverRepoCreationRecord(pending, deps);
      expect(result).toMatchObject({
        status: "pending",
        record: { phase: "metadata-preparing", targets: pending.targets },
      });
      expect(deps.publisher).not.toHaveBeenCalled();
      expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    }
  );

  it("bounds a stalled Git-ref read without discarding completed targets", async () => {
    vi.useFakeTimers();
    try {
      const deps = recoveryDeps();
      deps.workerApi.listServerRefs.mockImplementation(() => new Promise(() => {}));
      const result = recoverRepoCreationRecord(
        hostedRecord("repo", { phase: "metadata-preparing" }),
        deps
      );
      await vi.advanceTimersByTimeAsync(10001);
      expect(await result).toMatchObject({
        status: "pending",
        reason: expect.stringContaining("timed out"),
      });
      expect(deps.publisher).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["new branch", "deleted branch", "changed HEAD"])(
    "does not overwrite %s from live Git",
    async (change) => {
      const deps = recoveryDeps();
      const refs = [
        { ref: "refs/heads/main", oid: commit },
        { ref: "HEAD", target: "refs/heads/main", oid: commit },
      ];
      if (change === "new branch") refs.push({ ref: "refs/heads/next", oid: "d".repeat(40) });
      if (change === "deleted branch") refs.shift();
      if (change === "changed HEAD") refs[1].target = "refs/heads/next";
      deps.workerApi.listServerRefs.mockResolvedValue(refs);
      const result = await recoverRepoCreationRecord(
        hostedRecord("repo", { phase: "syncing" }),
        deps
      );
      expect(result).toMatchObject({ status: "pending", record: { phase: "metadata-preparing" } });
      expect(result.record?.targets[0].stage).toBe("verified");
      expect(deps.publisher).not.toHaveBeenCalled();
      expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    }
  );

  it.each(["before state signing", "after state signing"])(
    "rechecks live refs %s without losing the signed announcement",
    async (timing) => {
      const deps = recoveryDeps();
      const normal = deps.publisher.getMockImplementation()!;
      deps.publisher.mockImplementation(async (event, context) => {
        if (
          (timing === "before state signing" && event.kind === 30617) ||
          (timing === "after state signing" && event.kind === 30618)
        ) {
          deps.workerApi.listServerRefs.mockResolvedValue([
            { ref: "refs/heads/main", oid: "d".repeat(40) },
          ]);
          if (event.kind === 30618) await context?.assertFresh?.();
        }
        return normal(event, context);
      });
      const result = await recoverRepoCreationRecord(
        hostedRecord("repo", { phase: "metadata-preparing" }),
        deps
      );
      expect(result).toMatchObject({ status: "pending", record: { phase: "metadata-preparing" } });
      expect(result.record?.publishedEvents.map((item) => item.event.kind)).toEqual([30617]);
      expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
      expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    }
  );

  it("checks currently visible archived state rather than treating every receipt as safe to replace", async () => {
    const state = currentState({
      tags: [
        ["d", "repo"],
        ["refs/heads/main", "d".repeat(40)],
      ],
    });
    const deps = recoveryDeps();
    deps.fetchRelayEvents.mockResolvedValue([state]);
    const result = await recoverRepoCreationRecord(
      hostedRecord("repo", {
        phase: "metadata-preparing",
        publishedEvents: [{ event: state, stage: "final", relayUrls: [relay] }],
      }),
      deps
    );
    expect(result).toMatchObject({ status: "pending", record: { stateConflictEvent: state } });
    expect(deps.publisher).not.toHaveBeenCalled();
  });

  it("parks stale owner metadata, then applies only verified hosting after explicit review", async () => {
    const pending = persistRepoCreationRecoveryRecord(hostedRecord());
    const deps = recoveryDeps();
    const current = currentEvent();
    deps.fetchRelayEvents.mockResolvedValue([current]);
    const paused = await recoverRepoCreationRecord(pending, deps);
    expect(paused).toMatchObject({
      status: "pending",
      record: { phase: "metadata-review", reviewAnnouncement: current },
    });
    expect(deps.publisher).not.toHaveBeenCalled();
    expect(paused.record?.targets[0].stage).toBe("verified");
    expect(() => reserveRepoCreation(owner, "repo", getPendingRepoCreationTransactions())).toThrow(
      /needs recovery/
    );
    expect(deps.fetchRelayEvents).toHaveBeenCalledWith({
      relays: [relay],
      filters: [{ kinds: [30617], authors: [owner], "#d": ["repo"] }],
      timeoutMs: 5000,
      throwOnTimeout: true,
    });

    deps.workerApi.listServerRefs.mockClear();
    const result = await recoverRepoCreationRecord(paused.record!, {
      ...deps,
      reviewedAnnouncement: current,
    });
    expect(result).toEqual({ status: "recovered" });
    const announcement = deps.publisher.mock.calls.find(([event]) => event.kind === 30617)![0];
    expect(announcement.content).toBe(current.content);
    for (const tag of current.tags.filter((tag) => !["clone", "web", "relays"].includes(tag[0])))
      expect(announcement.tags).toContainEqual(tag);
    expect(announcement.tags).toContainEqual([
      "clone",
      "https://current-host.test/repo.git",
      hosted,
    ]);
    expect(announcement.tags).toContainEqual(["web", "https://current-host.test/repo"]);
    expect(announcement.tags.some((tag) => tag[0] === "maintainers")).toBe(false);
    expect(JSON.stringify(announcement)).not.toContain("old-");
    expect(deps.workerApi.listServerRefs).toHaveBeenCalledWith({ url: hosted, symrefs: true });
    expect(deps.workerApi.createRemoteRepo).not.toHaveBeenCalled();
    expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
    expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    expect(getPendingRepoCreationTransactions()).toEqual([]);
    reserveRepoCreation(owner, "repo", getPendingRepoCreationTransactions())();
  });

  it("invalidates review when the owner edits again", async () => {
    const current = currentEvent();
    const newer = { ...current, id: "newer", created_at: 30 };
    const deps = recoveryDeps();
    deps.fetchRelayEvents.mockResolvedValue([newer]);
    const result = await recoverRepoCreationRecord(
      hostedRecord("repo", { phase: "metadata-review", reviewAnnouncement: current }),
      {
        ...deps,
        reviewedAnnouncement: current,
      }
    );
    expect(result.record).toMatchObject({ phase: "metadata-review", reviewAnnouncement: newer });
    expect(deps.publisher).not.toHaveBeenCalled();
  });

  it("fails closed on unavailable current-announcement reads", async () => {
    const deps = recoveryDeps();
    deps.fetchRelayEvents.mockRejectedValue(new Error("timed out"));
    const result = await recoverRepoCreationRecord(hostedRecord(), deps);
    expect(result).toMatchObject({ status: "pending", record: { phase: "metadata-review" } });
    expect(result.reason).toMatch(/Could not verify/);
    expect(deps.publisher).not.toHaveBeenCalled();
    expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
  });

  it("does not forget a newer observed announcement after a read timeout", async () => {
    const deps = recoveryDeps();
    deps.fetchRelayEvents.mockRejectedValueOnce(new Error("timed out"));
    const result = await recoverRepoCreationRecord(
      hostedRecord("repo", {
        phase: "metadata-review",
        reviewAnnouncement: currentEvent(),
      }),
      deps
    );
    expect(result.record?.reviewAnnouncement).toEqual(currentEvent());
    deps.fetchRelayEvents.mockResolvedValue([]);
    const retry = await recoverRepoCreationRecord(result.record!, deps);
    expect(retry.record?.reviewAnnouncement).toEqual(currentEvent());
    expect(deps.publisher).not.toHaveBeenCalled();
  });

  it("forwards freshness checks so an edit while signing stops delivery", async () => {
    const deps = recoveryDeps();
    deps.publisher.mockImplementation(async (_event, context) => {
      deps.fetchRelayEvents.mockResolvedValue([currentEvent()]);
      await context?.assertFresh?.();
      throw new Error("must not deliver");
    });
    const result = await recoverRepoCreationRecord(hostedRecord(), deps);
    expect(result.record).toMatchObject({
      phase: "metadata-review",
      reviewAnnouncement: currentEvent(),
    });
    expect(result.reason).not.toContain("must not deliver");
  });

  it.each(["legacy:stable-id", "legacy/stable-id"])(
    "keeps exact recovered announcement and state identity: %s",
    async (identifier) => {
      const deps = recoveryDeps();
      const result = await recoverRepoCreationRecord(hostedRecord(identifier), deps);
      expect(result).toEqual({ status: "recovered" });
      expect(deps.publisher.mock.calls.map(([event]) => event.kind)).toEqual([30617, 30618]);
      for (const [event, context] of deps.publisher.mock.calls) {
        expect(event.tags).toContainEqual(["d", identifier]);
        expect(context?.repoAddress).toBe(`30617:${owner}:${identifier}`);
        expect(context?.assertCurrent).toBeTypeOf("function");
      }
    }
  );

  it.each(["wrong identifier", "wrong owner", "duplicate d", "wrong kind"])(
    "rejects recorded metadata with %s before any side effects",
    async (variant) => {
      let event = { ...sourceEvent("legacy:stable-id"), kind: 30618 };
      if (variant === "wrong identifier") event.tags = [["d", "stable-id"]];
      if (variant === "wrong owner") event.pubkey = "d".repeat(64);
      if (variant === "duplicate d") event.tags.push(["d", "legacy:stable-id"]);
      if (variant === "wrong kind") event.kind = 1;
      const deps = recoveryDeps();
      const result = await recoverRepoCreationRecord(
        hostedRecord("legacy:stable-id", {
          phase: "metadata-pending",
          publishedEvents: [{ event, relayUrls: [relay], stage: "final" }],
        }),
        deps
      );
      expect(result).toMatchObject({ status: "pending" });
      expect(result.reason).toMatch(/exact owner and identifier/);
      expect(result.record?.publishedEvents[0].event).toEqual(event);
      expect(deps.publisher).not.toHaveBeenCalled();
      expect(deps.onDeleteEvent).not.toHaveBeenCalled();
      expect(deps.workerApi.listServerRefs).not.toHaveBeenCalled();
      expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    }
  );

  it.each(["metadata-pending", "metadata-preparing"] as const)(
    "recovers %s with no final signed events",
    async (phase) => {
      const deps = recoveryDeps();
      const result = await recoverRepoCreationRecord(hostedRecord("repo", { phase }), deps);
      expect(result).toEqual({ status: "recovered" });
      expect(deps.publisher).toHaveBeenCalledTimes(2);
      expect(deps.workerApi.listServerRefs).toHaveBeenCalledWith({ url: hosted, symrefs: true });
    }
  );

  it("persists a signed announcement before state failure and retries that exact payload", async () => {
    const deps = recoveryDeps();
    const normalPublish = deps.publisher.getMockImplementation()!;
    deps.publisher.mockImplementation(async (event, context) => {
      if (event.kind === 30618) throw new Error("signer unavailable");
      return normalPublish(event, context);
    });
    const first = await recoverRepoCreationRecord(
      hostedRecord("repo", { phase: "metadata-preparing" }),
      deps
    );
    expect(first).toMatchObject({ status: "pending", record: { phase: "metadata-preparing" } });
    const saved = getPendingRepoCreationTransactions()[0];
    expect(saved.publishedEvents).toHaveLength(1);
    const signed = saved.publishedEvents[0].event;
    // Losing a second delivery result must not lose the active signed half.
    deps.publisher.mockImplementationOnce(async () => {
      throw new Error("delivery interrupted");
    });
    const interrupted = await recoverRepoCreationRecord(saved, deps);
    expect(interrupted.record?.metadataAttempt?.announcementEventId).toBe(signed.id);
    deps.publisher.mockClear().mockImplementation(normalPublish);
    expect(await recoverRepoCreationRecord(interrupted.record!, deps)).toEqual({
      status: "recovered",
    });
    expect(deps.publisher.mock.calls[0][0]).toEqual(signed);
    expect(deps.workerApi.createRemoteRepo).not.toHaveBeenCalled();
  });

  it("supports a legacy state-only final payload without changing its signed identifier", async () => {
    const identifier = "legacy:stable-id";
    const state = {
      ...createRepoStateEvent({
        repoId: identifier,
        identifier,
        refs: [{ type: "heads", name: "main", commit }],
        head: "main",
      }),
      id: "state-only",
      sig: "fixture",
      pubkey: owner,
    };
    const deps = recoveryDeps();
    deps.fetchRelayEvents.mockResolvedValue([
      currentState({
        created_at: state.created_at + 1,
        tags: [
          ["d", identifier],
          ["refs/heads/main", "d".repeat(40)],
        ],
      }),
    ]);
    deps.workerApi.listServerRefs.mockRejectedValue(new Error("Exact replay needs no Git reads"));
    const result = await recoverRepoCreationRecord(
      hostedRecord(identifier, {
        phase: "metadata-pending",
        publishedEvents: [{ event: state, relayUrls: [relay], stage: "final" }],
      }),
      deps
    );
    expect(result).toEqual({ status: "recovered" });
    expect(deps.publisher.mock.calls.find(([event]) => event.kind === 30618)![0]).toEqual(state);
    expect(deps.workerApi.listServerRefs).not.toHaveBeenCalled();
    expect(
      deps.fetchRelayEvents.mock.calls.every(([params]) => params.filters[0].kinds[0] === 30617)
    ).toBe(true);
  });

  it("preserves a complete signed pair across failed exact delivery", async () => {
    const announcement = { ...sourceEvent(), id: "final-announcement" };
    const state = { ...sourceEvent(), id: "final-state", kind: 30618 };
    const pending = hostedRecord("repo", {
      phase: "metadata-pending",
      publishedEvents: [announcement, state].map((event) => ({
        event,
        relayUrls: [relay],
        stage: "final",
      })),
    });
    const deps = recoveryDeps();
    deps.fetchRelayEvents.mockResolvedValue([currentState()]);
    deps.workerApi.listServerRefs.mockRejectedValue(new Error("Exact replay needs no Git reads"));
    const normal = deps.publisher.getMockImplementation()!;
    deps.publisher.mockImplementationOnce(async (event) => ({
      event,
      ackedRelays: [],
      failedRelays: [relay],
      relayOutcomes: [{ relay, status: "failure", detail: "offline" }],
    }));
    const failed = await recoverRepoCreationRecord(pending, deps);
    expect(failed.status).toBe("pending");
    deps.publisher.mockClear().mockImplementation(normal);
    expect(await recoverRepoCreationRecord(failed.record!, deps)).toEqual({ status: "recovered" });
    expect(deps.publisher.mock.calls.map(([event]) => event)).toEqual([announcement, state]);
    expect(deps.fetchRelayEvents).not.toHaveBeenCalled();
    expect(deps.workerApi.listServerRefs).not.toHaveBeenCalled();
  });

  it("retains completed resources if partial metadata recovery cannot verify any target", async () => {
    const pending = hostedRecord("repo", { phase: "metadata-preparing" });
    pending.targets[0].stage = "pushing";
    const deps = recoveryDeps();
    deps.workerApi.listServerRefs.mockResolvedValue([]);
    const result = await recoverRepoCreationRecord(pending, deps);
    expect(result.status).toBe("pending");
    expect(result.reason).toMatch(/retained/);
    expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    expect(deps.onDeleteEvent).not.toHaveBeenCalled();
  });

  it("checks the active owner before exact replay or cleanup", async () => {
    const deps = recoveryDeps();
    const result = await recoverRepoCreationRecord(
      hostedRecord("repo", { phase: "cleanup-pending" }),
      {
        ...deps,
        assertCurrent: () => {
          throw new Error("active account changed");
        },
      }
    );
    expect(result).toMatchObject({ status: "pending", reason: "active account changed" });
    expect(deps.publisher).not.toHaveBeenCalled();
    expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
  });

  it("requires review before partial ACK pruning can mint newer replacements", async () => {
    const otherRelay = "wss://other-metadata.test/";
    const announcement = {
      ...sourceEvent(),
      id: "final-announcement",
      tags: [
        ...sourceEvent().tags.filter((tag) => tag[0] !== "relays"),
        ["relays", relay, otherRelay],
      ],
    };
    const state = { ...sourceEvent(), id: "final-state", kind: 30618 };
    const pending = hostedRecord("repo", {
      phase: "metadata-pending",
      repositoryRelayUrls: [relay, otherRelay],
      publishedEvents: [announcement, state].map((event) => ({
        event,
        relayUrls: [relay, otherRelay],
        stage: "final",
      })),
    });
    const deps = recoveryDeps();
    deps.publisher.mockImplementation(async (event) => ({
      event,
      ackedRelays: [relay],
      failedRelays: [otherRelay],
      hasRelayOutcomes: true,
    }));
    deps.fetchRelayEvents.mockResolvedValue([currentEvent()]);
    const result = await recoverRepoCreationRecord(pending, deps);
    expect(result).toMatchObject({
      status: "pending",
      record: { phase: "metadata-review", reviewAnnouncement: currentEvent() },
    });
    expect(deps.publisher.mock.calls.map(([event]) => event)).toEqual([announcement, state]);
    expect(result.record?.publishedEvents.map((item) => item.event)).toEqual([announcement, state]);
  });

  it("does not combine an archived state with a newer interrupted metadata attempt", async () => {
    const oldState = {
      ...sourceEvent(),
      kind: 30618,
      id: "archived-state",
      tags: [
        ["d", "repo"],
        ["refs/heads/main", "d".repeat(40)],
      ],
    };
    const pending = hostedRecord("repo", {
      phase: "metadata-review",
      reviewAnnouncement: currentEvent(),
      publishedEvents: [{ event: oldState, stage: "final", relayUrls: [relay] }],
    });
    const deps = recoveryDeps();
    const normal = deps.publisher.getMockImplementation()!;
    deps.fetchRelayEvents.mockResolvedValue([currentEvent()]);
    deps.publisher.mockImplementation(async (event, context) => {
      if (event.kind === 30618) throw new Error("state signing interrupted");
      return normal(event, context);
    });
    const result = await recoverRepoCreationRecord(pending, {
      ...deps,
      reviewedAnnouncement: currentEvent(),
    });
    expect(result).toMatchObject({ status: "pending", record: { phase: "metadata-preparing" } });
    expect(result.record?.publishedEvents.map((item) => item.event)).toContainEqual(oldState);
    expect(result.record?.metadataAttempt?.stateEventId).toBeUndefined();
    deps.publisher.mockClear().mockImplementation(normal);
    expect(await recoverRepoCreationRecord(result.record!, deps)).toEqual({ status: "recovered" });
    const state = deps.publisher.mock.calls.find(([event]) => event.kind === 30618)![0];
    expect(state.tags).toContainEqual(["refs/heads/main", commit]);
    expect(state.id).not.toBe(oldState.id);
  });
});
