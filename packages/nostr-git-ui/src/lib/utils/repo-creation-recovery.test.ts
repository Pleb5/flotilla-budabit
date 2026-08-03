import { nip19 } from "nostr-tools";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { recoverRepoCreationRecord } from "./repo-creation-recovery.js";
import type { RepoCreationRecoveryRecord } from "./repo-creation-transaction.js";

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
        ["relays", "wss://relay.example", "wss://grasp.failed"],
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
        repositoryRelayUrls: ["wss://selected.example"],
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
            id: "grasp:wss://grasp.failed",
            label: "Failed GRASP",
            provider: "grasp",
            stage: "pushing",
            relayUrl: "wss://grasp.failed",
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
          listServerRefs: vi.fn().mockResolvedValue([{ ref: "refs/heads/main", oid: commit }]),
          createRemoteRepo,
          pushToRemote,
        },
        publisher,
        fetchRelayEvents: vi.fn(),
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
    expect(finalAnnouncement?.tags).toContainEqual(["relays", "wss://selected.example"]);
    expect(finalAnnouncement?.tags).toContainEqual(["name", "Repository Display Name"]);
    expect(finalAnnouncement?.tags).toContainEqual(["t", "nostr"]);
    expect(
      publisher.mock.calls.every(
        ([, context]) => !(context?.relays || []).includes("wss://grasp.failed")
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
        publishedEvents: [{ event: provisional, relayUrls: ["wss://relay"], stage: "provisional" }],
      }),
      {
        workerApi: { deleteRepo },
        publisher: vi.fn(),
        fetchRelayEvents: vi.fn(),
        onDeleteEvent,
      }
    );

    expect(result.status).toBe("recovered");
    expect(onDeleteEvent).toHaveBeenCalledWith(provisional, ["wss://relay"]);
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
