import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepoStateEvent } from "@nostr-git/core/events";
import type { NostrEvent } from "@nostr-git/core";
import { recoverRepoCreationRecord } from "./repo-creation-recovery.js";
import type { RepoCreationRecoveryRecord } from "./repo-creation-transaction.js";
import type { PublishRepoEvent } from "./grasp-pipeline.js";

const owner = "a".repeat(64);
const identifier = "legacy:repo";
const relay = "wss://completion.test/";
const failedRelay = "wss://unprovisioned.test/";
const hosted = "https://github.com/fixture/repo.git";
const failedHost = "https://unprovisioned.test/fixture/repo.git";
const commit = "b".repeat(40);
const feature = "c".repeat(40);
const makeState = (refs = [["main", commit]], created_at = 100, id = "provisional-state") => ({
  ...createRepoStateEvent({
    repoId: identifier,
    identifier,
    head: "main",
    created_at,
    refs: refs.map(([name, commit]) => ({ type: "heads" as const, name, commit })),
  }),
  id,
  sig: "fixture",
  pubkey: owner,
});

function pendingRecord({ twoRefs = false, failed = false } = {}): RepoCreationRecoveryRecord {
  const announcement: NostrEvent = {
    id: "provisional-announcement",
    sig: "fixture",
    pubkey: owner,
    kind: 30617,
    created_at: 100,
    content: "",
    tags: [
      ["d", identifier],
      ["name", "Completion fixture"],
      ["clone", hosted, ...(failed ? [failedHost] : [])],
      ["relays", relay, ...(failed ? [failedRelay] : [])],
    ],
  };
  return {
    version: 2,
    id: "completion-fixture",
    operation: "new",
    ownerPubkey: owner,
    repoName: identifier,
    phase: "metadata-preparing",
    repositoryRelayUrls: [relay],
    localResource: { ownedByTransaction: false, stage: "planned" },
    targets: [
      {
        id: "github",
        label: "GitHub",
        provider: "github",
        stage: "verified",
        remoteUrl: hosted,
        refs: [
          { ref: "refs/heads/main", commit, stage: "verified" },
          ...(twoRefs
            ? [{ ref: "refs/heads/feature", commit: feature, stage: "verified" as const }]
            : []),
        ],
        cleanup: { stage: "not-needed", manualAttention: false },
        manualAttention: false,
        updatedAt: 1,
      },
      ...(failed
        ? [
            {
              id: "grasp-failed",
              label: "Failed GRASP",
              provider: "grasp" as const,
              stage: "failed" as const,
              remoteUrl: failedHost,
              relayUrl: failedRelay,
              createdRemote: false,
              refs: [{ ref: "refs/heads/main", commit, stage: "failed" as const }],
              cleanup: { stage: "completed" as const, manualAttention: false },
              manualAttention: false,
              updatedAt: 1,
            },
          ]
        : []),
    ],
    targetResults: [
      {
        id: "github",
        label: "GitHub",
        provider: "github",
        success: true,
        outcome: "ok",
        remoteUrl: hosted,
      },
    ],
    publishedEvents: [{ event: announcement, stage: "provisional", relayUrls: [relay] }],
    eventAcks: [],
    pendingCompensations: [],
    cleanup: { stage: "not-needed", manualAttention: false },
    manualAttention: { required: false },
    createdAt: 1,
    updatedAt: 1,
  };
}

function fixture(record: RepoCreationRecoveryRecord, observed: NostrEvent[] = []) {
  let count = 0;
  const delivered: NostrEvent[] = [];
  const sign = vi.fn(async (event: NostrEvent) => ({
    ...event,
    id: `signed-${++count}`,
    sig: "fixture",
    pubkey: owner,
  }));
  const reject = vi.fn((_event: NostrEvent) => false);
  const publisher = vi.fn<PublishRepoEvent>(async (event, context) => {
    await context?.assertFresh?.();
    const signed = event.id ? event : await sign(event);
    await context?.assertFresh?.();
    delivered.push(signed);
    const rejected = reject(signed);
    return {
      event: signed,
      ackedRelays: rejected ? [] : context!.relays,
      failedRelays: rejected ? context!.relays : [],
      hasRelayOutcomes: true,
      relayOutcomes: context!.relays.map((relay) => ({
        relay,
        status: rejected ? "failure" : "success",
        detail: rejected ? "invalid: older state" : "fixture ACK",
      })),
    };
  });
  const deps = {
    publisher,
    fetchRelayEvents: vi.fn(async ({ filters }) =>
      observed.filter((event) =>
        filters.some(
          (filter: any) =>
            filter.kinds?.includes(event.kind) &&
            filter.authors?.includes(event.pubkey) &&
            filter["#d"]?.includes(identifier)
        )
      )
    ),
    onDeleteEvent: vi.fn(),
    workerApi: {
      listServerRefs: vi.fn(async ({ url }) => {
        if (url === failedHost) throw new Error("HTTP 404 Not Found");
        return [
          ...record.targets[0].refs.map((ref) => ({ ref: ref.ref, oid: ref.commit })),
          { ref: "HEAD", target: "refs/heads/main", oid: commit },
        ];
      }),
      createRemoteRepo: vi.fn(),
      pushToRemote: vi.fn(),
      deleteRepo: vi.fn(),
    },
  };
  return { deps, observed, delivered, sign, reject };
}

function rejectedAnnouncementFixture() {
  const record = pendingRecord();
  record.phase = "metadata-pending";
  record.publishedEvents[0].stage = "final";
  const announcement = record.publishedEvents[0].event;
  const old = makeState([["main", commit]], 900, "stuck-state");
  record.publishedEvents.push({ event: old, stage: "final", relayUrls: [] });
  const current = {
    ...announcement,
    id: "owner-edit",
    created_at: 200,
    tags: announcement.tags.map((tag) => (tag[0] === "name" ? ["name", "Owner edited name"] : tag)),
  };
  const ahead = makeState([["main", commit]], 1050, "ahead");
  const result = fixture(record, [current, ahead]);
  result.reject.mockImplementation((event) => {
    const newest = event.kind === 30617 ? current : event.kind === 30618 ? ahead : undefined;
    return Boolean(
      newest &&
      (event.created_at < newest.created_at ||
        (event.created_at === newest.created_at && event.id > newest.id))
    );
  });
  return { ...result, record, announcement, old, current, ahead };
}

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] || null,
    getItem: (k: string) => values.get(k) || null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  });
  vi.spyOn(Date, "now").mockReturnValue(1000_000);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("legitimate repository recovery completion", () => {
  it.each(["new", "fork"] as const)(
    "finishes %s using the survivor without requiring a failed provisional host",
    async (operation) => {
      const record = pendingRecord({ failed: true });
      record.operation = operation;
      const { deps, delivered } = fixture(record);
      expect(await recoverRepoCreationRecord(record, deps)).toEqual({ status: "recovered" });
      expect(delivered.find((event) => event.kind === 30617)?.tags).toContainEqual([
        "clone",
        hosted,
      ]);
      // Only the outcome probe reads the failed URL, not the established-host guard.
      expect(
        deps.workerApi.listServerRefs.mock.calls.filter(([args]) => args.url === failedHost)
      ).toHaveLength(1);
      expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
      expect(deps.workerApi.createRemoteRepo).not.toHaveBeenCalled();
      expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    }
  );

  it("completes exact provisional ref progress after verifying all planned live refs", async () => {
    const record = pendingRecord({ twoRefs: true });
    const partial = makeState();
    record.publishedEvents.push({ event: partial, stage: "provisional", relayUrls: [relay] });
    const { deps, delivered } = fixture(record, [partial]);
    expect(await recoverRepoCreationRecord(record, deps)).toEqual({ status: "recovered" });
    expect(deps.workerApi.listServerRefs).toHaveBeenCalledWith({ url: hosted, symrefs: true });
    expect(delivered.find((event) => event.kind === 30618)?.tags).toContainEqual([
      "refs/heads/feature",
      feature,
    ]);
  });

  it("orders new owner state after an identical observed future state", async () => {
    const record = pendingRecord();
    const ahead = makeState([["main", commit]], 1050, "ahead");
    const { deps, delivered, reject } = fixture(record, [ahead]);
    reject.mockImplementation(
      (event) => event.kind === 30618 && event.created_at <= ahead.created_at
    );
    expect(await recoverRepoCreationRecord(record, deps)).toEqual({ status: "recovered" });
    expect(delivered.find((event) => event.kind === 30618)!.created_at).toBeGreaterThan(
      ahead.created_at
    );
  });

  it("replaces a definitively superseded signed attempt without rewriting its archived receipt", async () => {
    const record = pendingRecord();
    const old = makeState([["main", commit]], 900, "stuck-state");
    record.publishedEvents[0].stage = "final";
    record.publishedEvents.push({ event: old, stage: "final", relayUrls: [] });
    record.phase = "metadata-pending";
    const ahead = makeState([["main", commit]], 1050, "ahead");
    const { deps, sign, reject } = fixture(record, [ahead]);
    reject.mockImplementation(
      (event) => event.kind === 30618 && event.created_at <= ahead.created_at
    );
    sign.mockRejectedValueOnce(new Error("replacement signer interrupted"));
    const result = await recoverRepoCreationRecord(record, deps);
    expect(result).toMatchObject({ status: "pending", record: { phase: "metadata-preparing" } });
    expect(result.record?.publishedEvents).toContainEqual({
      event: old,
      stage: "final",
      relayUrls: [],
    });
    expect(result.record?.metadataAttempt?.stateEventId).toBeUndefined();
    expect(await recoverRepoCreationRecord(result.record!, deps)).toEqual({ status: "recovered" });
    expect(old.created_at).toBe(900);
    expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
  });

  it.each(["original source", "reviewed independent announcement"])(
    "still protects failed hosting from the %s",
    async (origin) => {
      const record = pendingRecord({ failed: true });
      const source = {
        ...record.publishedEvents[0].event,
        id: "existing-owner-announcement",
        created_at: 200,
      };
      if (origin === "original source")
        record.sourceMetadata = {
          announcementEvent: source,
          cloneUrls: [hosted, failedHost],
          webUrls: [],
        };
      const { deps, sign } = fixture(record, [source]);
      const result = await recoverRepoCreationRecord(record, {
        ...deps,
        reviewedAnnouncement: source,
      });
      expect(result).toMatchObject({ status: "pending", reason: expect.stringContaining("404") });
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it.each(["visible", "omitted"])(
    "orders completion after %s checkpointed partial state",
    async (visibility) => {
      const record = pendingRecord({ twoRefs: true });
      const partial = makeState([["main", commit]], 1050);
      record.publishedEvents.push({ event: partial, stage: "provisional", relayUrls: [relay] });
      const { deps, delivered } = fixture(record, visibility === "visible" ? [partial] : []);
      expect(await recoverRepoCreationRecord(record, deps)).toEqual({ status: "recovered" });
      expect(delivered.find((event) => event.kind === 30618)!.created_at).toBe(1051);
    }
  );

  it.each([
    "unrecorded",
    "final",
    "missing stage",
    "altered timestamp",
    "altered signature",
    "changed commit",
    "changed HEAD",
    "extra content",
    "extra ref",
    "ancestry",
    "promoted duplicate",
  ])("does not exempt %s state as provisional progress", async (variant) => {
    const record = pendingRecord({ twoRefs: true });
    const partial = makeState();
    const observed: NostrEvent = structuredClone(partial);
    if (variant === "changed commit") observed.tags[1][1] = "d".repeat(40);
    if (variant === "changed HEAD") observed.tags[2][1] = "ref: refs/heads/feature";
    if (variant === "extra content") observed.content = "retain this";
    if (variant === "extra ref") observed.tags.push(["refs/heads/other", feature]);
    if (variant === "ancestry") observed.tags[1].push("d".repeat(40));
    if (variant !== "unrecorded")
      record.publishedEvents.push({
        event: structuredClone(observed),
        relayUrls: [relay],
        stage:
          variant === "final" ? "final" : variant === "missing stage" ? undefined : "provisional",
      });
    if (variant === "promoted duplicate")
      record.publishedEvents.push({ event: partial, stage: "final", relayUrls: [relay] });
    if (variant === "altered timestamp") observed.created_at++;
    if (variant === "altered signature") observed.sig = "not-the-receipt";
    const { deps, sign } = fixture(record, [observed]);
    const result = await recoverRepoCreationRecord(record, deps);
    expect(result).toMatchObject({
      status: "pending",
      reason: expect.stringContaining("Authoritative repository state differs"),
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it.each(["normal read", "later relay timeout"])(
    "does not let newer own progress mask independent state after %s",
    async (mode) => {
      const record = pendingRecord({ twoRefs: true });
      const partial = makeState([["main", commit]], 1050);
      const independent = makeState([["main", "d".repeat(40)]], 1020, "independent-edit");
      record.publishedEvents.push({ event: partial, stage: "provisional", relayUrls: [relay] });
      const { deps, sign, observed } = fixture(record, [partial, independent]);
      if (mode === "later relay timeout") {
        record.repositoryRelayUrls!.push(failedRelay);
        const normal = deps.fetchRelayEvents.getMockImplementation()!;
        deps.fetchRelayEvents.mockImplementation(async (args) => {
          if ((args as any).relays[0] === failedRelay && args.filters[0].kinds.includes(30618))
            throw new Error("timeout");
          return normal(args);
        });
      }
      const result = await recoverRepoCreationRecord(record, deps);
      expect(result.record?.stateConflictEvent).toEqual(independent);
      observed.splice(0);
      const retry = await recoverRepoCreationRecord(result.record!, deps);
      expect(retry.record?.stateConflictEvent).toEqual(independent);
      expect(sign).not.toHaveBeenCalled();
    }
  );

  it.each(["later state relay", "Git refs"])(
    "retains identical future state when %s is unavailable",
    async (unavailable) => {
      const record = pendingRecord();
      const ahead = makeState([["main", commit]], 1050, "ahead");
      const { deps, observed, delivered } = fixture(record, [ahead]);
      const normalRefs = deps.workerApi.listServerRefs.getMockImplementation()!;
      if (unavailable === "later state relay") {
        record.repositoryRelayUrls!.push(failedRelay);
        const normal = deps.fetchRelayEvents.getMockImplementation()!;
        deps.fetchRelayEvents.mockImplementation(async (args) => {
          if ((args as any).relays[0] === failedRelay && args.filters[0].kinds.includes(30618))
            throw new Error("timeout");
          return normal(args);
        });
      } else deps.workerApi.listServerRefs.mockRejectedValue(new Error("Git timeout"));
      const result = await recoverRepoCreationRecord(record, deps);
      expect(result).toMatchObject({ status: "pending", record: { stateConflictEvent: ahead } });
      observed.splice(0);
      deps.fetchRelayEvents.mockResolvedValue([]);
      deps.workerApi.listServerRefs.mockImplementation(normalRefs);
      expect(await recoverRepoCreationRecord(result.record!, deps)).toEqual({
        status: "recovered",
      });
      expect(delivered.find((event) => event.kind === 30618)!.created_at).toBe(1051);
    }
  );

  it("still checks live refs after accepting provisional progress", async () => {
    const record = pendingRecord({ twoRefs: true });
    const partial = makeState();
    record.publishedEvents.push({ event: partial, stage: "provisional", relayUrls: [relay] });
    const { deps, sign } = fixture(record, [partial]);
    deps.workerApi.listServerRefs.mockResolvedValue([
      { ref: "refs/heads/main", oid: commit },
      { ref: "refs/heads/feature", oid: "d".repeat(40) },
    ]);
    expect(await recoverRepoCreationRecord(record, deps)).toMatchObject({
      status: "pending",
      reason: expect.stringContaining("Git refs changed"),
    });
    expect(sign).not.toHaveBeenCalled();
  });

  it("orders new owner-signed state after identical direct-maintainer state", async () => {
    const record = pendingRecord();
    const maintainer = "e".repeat(64);
    record.publishedEvents[0].event.tags.push(["maintainers", maintainer]);
    const current = {
      ...makeState([["main", commit]], 1050, "maintainer-state"),
      pubkey: maintainer,
    };
    const { deps, delivered } = fixture(record, [current]);
    expect(await recoverRepoCreationRecord(record, deps)).toEqual({ status: "recovered" });
    expect(delivered.find((event) => event.kind === 30618)).toMatchObject({
      pubkey: owner,
      created_at: 1051,
    });
  });

  it.each(["normal", "no announcement ACK"])(
    "retains a newer ordering observation during signing (%s)",
    async (mode) => {
      const record = pendingRecord();
      const ahead = makeState([["main", commit]], 1050, "ahead");
      const newer = { ...ahead, id: "newer", created_at: 1052 };
      const { deps, delivered, sign, reject, observed } = fixture(record, [ahead]);
      const normal = sign.getMockImplementation()!;
      let advance = true;
      sign.mockImplementation(async (event) => {
        const signed = await normal(event);
        if (event.kind === 30618 && advance) {
          observed.push(newer);
          advance = false;
        }
        return signed;
      });
      reject.mockImplementation((event) => mode === "no announcement ACK" && event.kind === 30617);
      const result = await recoverRepoCreationRecord(record, deps);
      expect(result.status).toBe("pending");
      expect(result.record?.stateConflictEvent).toEqual(newer);
      expect(delivered.filter((event) => event.kind === 30618)).toEqual([]);
      observed.splice(0); // The ordering evidence must survive an empty later relay read.
      reject.mockReturnValue(false);
      expect(await recoverRepoCreationRecord(result.record!, deps)).toEqual({
        status: "recovered",
      });
      expect(delivered.find((event) => event.kind === 30618)!.created_at).toBe(1053);
    }
  );

  it.each(["same time", "newer time"])(
    "repairs an obsolete exact attempt with %s superseding state",
    async (mode) => {
      const record = pendingRecord();
      const old = makeState([["main", commit]], 1050, "zzz-stuck");
      const current = makeState(
        [["main", commit]],
        mode === "same time" ? 1050 : 1051,
        "aaa-current"
      );
      record.phase = "metadata-pending";
      record.publishedEvents[0].stage = "final";
      record.publishedEvents.push({ event: old, stage: "final", relayUrls: [] });
      const { deps, delivered, reject } = fixture(record, [current]);
      reject.mockImplementation(
        (event) => event.kind === 30618 && event.created_at <= current.created_at
      );
      expect(await recoverRepoCreationRecord(record, deps)).toEqual({ status: "recovered" });
      const states = delivered.filter((event) => event.kind === 30618);
      expect(states[0]).toEqual(old);
      expect(states[1].created_at).toBe(current.created_at + 1);
    }
  );

  it.each(["state", "announcement and state"])(
    "requires owner review when the obsolete %s is rejected",
    async (rejected) => {
      const record = pendingRecord();
      const old = makeState([["main", commit]], 900, "stuck-state");
      record.phase = "metadata-pending";
      record.publishedEvents[0].stage = "final";
      record.publishedEvents.push({ event: old, stage: "final", relayUrls: [] });
      const current = {
        ...record.publishedEvents[0].event,
        id: "owner-edit",
        created_at: 200,
        tags: record.publishedEvents[0].event.tags.map((tag) =>
          tag[0] === "name" ? ["name", "Owner edited name"] : tag
        ),
      };
      const ahead = makeState([["main", commit]], 1050, "ahead");
      const { deps, sign, reject, delivered } = fixture(record, [current, ahead]);
      reject.mockImplementation(
        (event) =>
          (event.kind === 30618 && event.created_at <= ahead.created_at) ||
          (rejected === "announcement and state" &&
            event.kind === 30617 &&
            event.created_at <= current.created_at)
      );
      const result = await recoverRepoCreationRecord(record, deps);
      expect(result).toMatchObject({
        status: "pending",
        record: { phase: "metadata-review", reviewAnnouncement: current },
      });
      expect(result.record?.metadataAttempt?.stateEventId).toBeUndefined();
      expect(
        result.record?.publishedEvents.find((item) => item.event.id === old.id)?.event
      ).toEqual(old);
      expect(sign).not.toHaveBeenCalled();
      expect(delivered.map((event) => event.kind)).toEqual(
        rejected === "state" ? [30617, 30618] : [30617]
      );
      expect(deps.fetchRelayEvents).toHaveBeenCalledWith({
        relays: [relay],
        filters: [{ kinds: [30617], authors: [owner], "#d": [identifier] }],
        timeoutMs: 5000,
        throwOnTimeout: true,
      });
      const unapprovedRetry = await recoverRepoCreationRecord(result.record!, deps);
      expect(unapprovedRetry).toMatchObject({
        status: "pending",
        record: { phase: "metadata-review", reviewAnnouncement: current },
      });
      expect(sign).not.toHaveBeenCalled();
      expect(
        await recoverRepoCreationRecord(unapprovedRetry.record!, {
          ...deps,
          reviewedAnnouncement: current,
        })
      ).toEqual({ status: "recovered" });
      expect(delivered.filter((event) => event.kind === 30617).at(-1)?.tags).toContainEqual([
        "name",
        "Owner edited name",
      ]);
      expect(delivered.filter((event) => event.kind === 30618).at(-1)?.created_at).toBeGreaterThan(
        ahead.created_at
      );
      expect(deps.workerApi.listServerRefs).toHaveBeenCalled();
      expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
      expect(deps.workerApi.createRemoteRepo).not.toHaveBeenCalled();
      expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
    }
  );

  it.each(["replacement preparation", "failed state read"])(
    "retains the newer announcement through %s and empty later reads",
    async (interruption) => {
      const { record, deps, current, sign, delivered } = rejectedAnnouncementFixture();
      const read = deps.fetchRelayEvents.getMockImplementation()!;
      let metadataRead = false;
      let stateFailed = false;
      deps.fetchRelayEvents.mockImplementation(async (args) => {
        if (args.filters[0].kinds.includes(30617)) {
          if (metadataRead) return [];
          metadataRead = true;
        } else if (interruption === "failed state read" && !stateFailed) {
          stateFailed = true;
          throw new Error("State read interrupted");
        }
        return read(args);
      });
      let result = await recoverRepoCreationRecord(record, deps);
      expect(result.record?.reviewAnnouncement).toEqual(current);
      if (interruption === "failed state read") {
        expect(result.record?.phase).toBe("metadata-pending");
        result = await recoverRepoCreationRecord(result.record!, deps);
      }
      expect(result.record?.phase).toBe("metadata-review");
      expect(sign).not.toHaveBeenCalled();
      expect(
        await recoverRepoCreationRecord(result.record!, { ...deps, reviewedAnnouncement: current })
      ).toEqual({ status: "recovered" });
      expect(delivered.filter((event) => event.kind === 30617).at(-1)?.tags).toContainEqual([
        "name",
        "Owner edited name",
      ]);
    }
  );

  it("recognizes a superseded announcement at the same timestamp using event-ID ordering", async () => {
    const { record, deps, current, announcement } = rejectedAnnouncementFixture();
    current.created_at = announcement.created_at;
    expect(current.id < announcement.id).toBe(true);
    expect(await recoverRepoCreationRecord(record, deps)).toMatchObject({
      status: "pending",
      record: { phase: "metadata-review", reviewAnnouncement: current },
    });
  });

  it.each([
    "no owner evidence",
    "wrong owner",
    "wrong identifier",
    "older owner event",
    "same-time later ID",
    "source older than saved pair",
    "metadata unavailable",
    "state missing",
    "state not superseding",
    "state unavailable",
    "state changed",
    "refs unavailable",
    "refs changed",
    "HEAD changed",
  ])("keeps ordinary exact retries after announcement failure with %s", async (problem) => {
    const { record, deps, current, ahead, announcement, old, observed, sign, reject, delivered } =
      rejectedAnnouncementFixture();
    if (problem === "no owner evidence") observed.splice(0, 1);
    if (problem === "wrong owner") current.pubkey = "f".repeat(64);
    if (problem === "wrong identifier")
      current.tags = current.tags.map((tag) => (tag[0] === "d" ? ["d", "another-repo"] : tag));
    if (problem === "older owner event") current.created_at = announcement.created_at - 1;
    if (problem === "same-time later ID") {
      current.created_at = announcement.created_at;
      current.id = "zzz-owner-edit";
    }
    if (problem === "source older than saved pair") {
      record.sourceMetadata = {
        announcementEvent: { ...announcement, id: "source", created_at: 50 },
        cloneUrls: [hosted],
        webUrls: [],
      };
      current.created_at = 80;
    }
    if (problem === "state missing") observed.splice(1, 1);
    if (problem === "state not superseding") ahead.created_at = old.created_at - 1;
    if (problem === "state changed")
      ahead.tags = ahead.tags.map((tag) =>
        tag[0] === "refs/heads/main" ? [tag[0], "d".repeat(40)] : tag
      );
    if (problem === "metadata unavailable" || problem === "state unavailable") {
      const read = deps.fetchRelayEvents.getMockImplementation()!;
      deps.fetchRelayEvents.mockImplementation(async (args) => {
        if (args.filters[0].kinds.includes(problem === "metadata unavailable" ? 30617 : 30618))
          throw new Error("Fixture read unavailable");
        return read(args);
      });
    }
    if (problem === "refs unavailable")
      deps.workerApi.listServerRefs.mockRejectedValue(new Error("Git offline"));
    if (problem === "refs changed")
      deps.workerApi.listServerRefs.mockResolvedValue([
        { ref: "refs/heads/main", oid: "d".repeat(40) },
      ]);
    if (problem === "HEAD changed")
      deps.workerApi.listServerRefs.mockResolvedValue([
        { ref: "refs/heads/main", oid: commit },
        { ref: "HEAD", target: "refs/heads/other", oid: commit },
      ]);
    reject.mockReturnValue(true);
    let pending = record;
    for (let retry = 0; retry < 2; retry++) {
      const result = await recoverRepoCreationRecord(pending, deps);
      expect(result).toMatchObject({ status: "pending", record: { phase: "metadata-pending" } });
      expect(result.record?.metadataAttempt).toEqual({
        announcementEventId: announcement.id,
        stateEventId: old.id,
      });
      expect(result.record?.publishedEvents.map((item) => item.event)).toEqual([announcement, old]);
      pending = JSON.parse(JSON.stringify(result.record));
    }
    expect(delivered).toEqual([announcement, announcement]);
    expect(sign).not.toHaveBeenCalled();
    // Even unavailable diagnostic reads must not become a prerequisite for
    // retrying unchanged signed payloads when relay delivery is working again.
    deps.fetchRelayEvents.mockClear();
    deps.workerApi.listServerRefs.mockClear();
    reject.mockReturnValue(false);
    expect(await recoverRepoCreationRecord(pending, deps)).toEqual({ status: "recovered" });
    expect(delivered.slice(-2)).toEqual([announcement, old]);
    expect(sign).not.toHaveBeenCalled();
    expect(deps.fetchRelayEvents).not.toHaveBeenCalled();
    expect(deps.workerApi.listServerRefs).not.toHaveBeenCalled();
    expect(deps.workerApi.pushToRemote).not.toHaveBeenCalled();
    expect(deps.workerApi.deleteRepo).not.toHaveBeenCalled();
  });

  it.each(["owner metadata", "state", "Git refs"])(
    "rechecks %s after reviewing a superseded announcement",
    async (changed) => {
      const { record, deps, current, ahead, observed, sign, delivered, announcement } =
        rejectedAnnouncementFixture();
      const review = await recoverRepoCreationRecord(record, deps);
      expect(review.record?.phase).toBe("metadata-review");
      if (changed === "owner metadata")
        observed.push({ ...current, id: "next-owner-edit", created_at: 201 });
      if (changed === "state")
        observed.push(makeState([["main", "d".repeat(40)]], ahead.created_at + 1, "next-state"));
      if (changed === "Git refs")
        deps.workerApi.listServerRefs.mockResolvedValue([
          { ref: "refs/heads/main", oid: "d".repeat(40) },
        ]);
      const result = await recoverRepoCreationRecord(review.record!, {
        ...deps,
        reviewedAnnouncement: current,
      });
      expect(result.status).toBe("pending");
      expect(result.reason).toMatch(
        changed === "owner metadata"
          ? /Review/
          : changed === "state"
            ? /state differs/
            : /Git refs changed/
      );
      expect(sign).not.toHaveBeenCalled();
      expect(delivered).toEqual([announcement]);
    }
  );

  it("preserves the replacement's exact signed payload after another lost delivery result", async () => {
    const record = pendingRecord();
    const old = makeState([["main", commit]], 900, "stuck-state");
    record.phase = "metadata-pending";
    record.publishedEvents[0].stage = "final";
    record.publishedEvents.push({ event: old, stage: "final", relayUrls: [] });
    const ahead = makeState([["main", commit]], 1050, "ahead");
    const { deps, sign, reject, delivered } = fixture(record, [ahead]);
    reject.mockImplementation((event) => event.kind === 30618);
    const result = await recoverRepoCreationRecord(record, deps);
    expect(result.record?.phase).toBe("metadata-pending");
    const replacement = delivered.filter((event) => event.kind === 30618).at(-1)!;
    expect(replacement.id).not.toBe(old.id);
    expect(replacement.created_at).toBe(1051);
    expect(result.record?.metadataAttempt?.stateEventId).toBe(replacement.id);
    expect(result.record?.publishedEvents.find((item) => item.event.id === old.id)?.event).toEqual(
      old
    );
    reject.mockReturnValue(false);
    deps.workerApi.listServerRefs.mockClear();
    expect(await recoverRepoCreationRecord(result.record!, deps)).toEqual({ status: "recovered" });
    expect(delivered.filter((event) => event.kind === 30618).at(-1)).toEqual(replacement);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(deps.workerApi.listServerRefs).not.toHaveBeenCalled();
  });

  it.each(["no superseding evidence", "unavailable state", "changed state", "changed live refs"])(
    "does not rewrite a failed exact attempt with %s",
    async (failure) => {
      const record = pendingRecord();
      const old = makeState([["main", commit]], 900, "stuck-state");
      record.phase = "metadata-pending";
      record.publishedEvents[0].stage = "final";
      record.publishedEvents.push({ event: old, stage: "final", relayUrls: [] });
      const current = makeState(
        [["main", failure === "changed state" ? "d".repeat(40) : commit]],
        1050,
        "ahead"
      );
      const { deps, sign, reject } = fixture(
        record,
        failure === "no superseding evidence" ? [] : [current]
      );
      reject.mockImplementation((event) => event.kind === 30618);
      if (failure === "unavailable state")
        deps.fetchRelayEvents.mockImplementation(async ({ filters }) => {
          if (filters[0].kinds.includes(30618)) throw new Error("state offline");
          return [];
        });
      if (failure === "changed live refs")
        deps.workerApi.listServerRefs.mockResolvedValue([
          { ref: "refs/heads/main", oid: "d".repeat(40) },
        ]);
      const result = await recoverRepoCreationRecord(record, deps);
      expect(result.status).toBe("pending");
      expect(
        result.record?.publishedEvents.find((item) => item.event.kind === 30618)?.event
      ).toEqual(old);
      expect(result.record?.metadataAttempt?.stateEventId).toBe(old.id);
      expect(sign).not.toHaveBeenCalled();
    }
  );
});
