import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getPendingRepoCreationTransactions,
  RepoCreationTransactionJournal,
  retryPendingRepoCreationMetadata,
  retryRepoCreationCompensations,
  trackRepoCreationPublisher,
} from "./repo-creation-transaction";

class MemoryStorage implements Storage {
  #values = new Map<string, string>();

  get length() {
    return this.#values.size;
  }

  clear(): void {
    this.#values.clear();
  }

  getItem(key: string): string | null {
    return this.#values.get(key) ?? null;
  }

  key(index: number): string | null {
    return Array.from(this.#values.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.#values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#values.set(key, value);
  }
}

class ToggleStorage extends MemoryStorage {
  failWrites = false;

  override setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("storage quota unavailable");
    super.setItem(key, value);
  }
}

const originalLocalStorage = globalThis.localStorage;

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", { value: originalLocalStorage });
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

describe("RepoCreationTransactionJournal", () => {
  it("persists recovery identifiers and exact signed repository events without tokens", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "new:owner/repo:1",
      operation: "new",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
      localRepoId: "owner/repo",
    });
    journal.setTargets([
      {
        id: "git:github.com",
        label: "GitHub",
        provider: "github",
        host: "github.com",
        token: "secret-token",
        tokens: ["backup-secret"],
      },
    ]);
    const event = {
      id: "event-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };
    const publisher = trackRepoCreationPublisher(
      journal,
      vi.fn().mockResolvedValue({
        event,
        ackedRelays: ["wss://relay.example"],
        failedRelays: [],
      })
    );

    await publisher?.(event, { relays: ["wss://relay.example"] });
    journal.setPhase("metadata-pending", new Error("relay timeout"));

    const [record] = getPendingRepoCreationTransactions();
    expect(record).toEqual(
      expect.objectContaining({
        version: 2,
        phase: "metadata-pending",
        lastError: "relay timeout",
        localResource: {
          id: "owner/repo",
          ownedByTransaction: true,
          stage: "unknown",
        },
        targets: [expect.objectContaining({ id: "git:github.com", host: "github.com" })],
        publishedEvents: [{ event, relayUrls: ["wss://relay.example"], stage: "provisional" }],
        eventAcks: [
          expect.objectContaining({
            eventId: "event-id",
            requestedRelayUrls: ["wss://relay.example"],
            ackedRelays: ["wss://relay.example"],
            failedRelays: [],
            successCount: 1,
            hasRelayOutcomes: true,
          }),
        ],
      })
    );
    expect(JSON.stringify(record)).not.toContain("secret-token");
  });

  it("fails closed when the initial journal cannot be persisted", () => {
    const storage = new ToggleStorage();
    storage.failWrites = true;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });

    expect(
      () =>
        new RepoCreationTransactionJournal({
          id: "new:owner/repo:storage-failure",
          operation: "new",
          ownerPubkey: "f".repeat(64),
          repoName: "repo",
        })
    ).toThrow("Failed to persist repository creation journal");
    expect(storage.length).toBe(0);
  });

  it("migrates stale v1 failures without TTL deletion", () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    const id = "import:owner:repo:legacy";
    const event = {
      id: "legacy-event",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };
    const legacyKey = `nostr-git:repo-creation:v1:${encodeURIComponent(id)}`;
    storage.setItem(
      legacyKey,
      JSON.stringify({
        version: 1,
        id,
        operation: "import",
        ownerPubkey: "f".repeat(64),
        repoName: "repo",
        localRepoId: "owner/repo",
        phase: "failed",
        targets: [
          {
            id: "git:github.com",
            label: "GitHub",
            provider: "github",
            host: "github.com",
          },
        ],
        targetResults: [
          {
            id: "git:github.com",
            label: "GitHub",
            provider: "github",
            success: false,
            remoteUrl: "https://github.com/owner/repo.git",
            createdRemote: true,
            outcome: "unknown",
            error: "network timeout",
          },
        ],
        publishedEvents: [{ event, relayUrls: ["wss://relay.example"], stage: "provisional" }],
        pendingCompensations: [],
        lastError: "network timeout",
        createdAt: 1,
        updatedAt: 1,
      })
    );

    const [record] = getPendingRepoCreationTransactions(10 * 24 * 60 * 60 * 1000);

    expect(record).toEqual(
      expect.objectContaining({
        version: 2,
        id,
        phase: "failed",
        localResource: {
          id: "owner/repo",
          ownedByTransaction: true,
          stage: "unknown",
        },
        manualAttention: expect.objectContaining({ required: true }),
        targets: [
          expect.objectContaining({
            id: "git:github.com",
            stage: "unknown",
            remoteUrl: "https://github.com/owner/repo.git",
            createdRemote: true,
            manualAttention: true,
          }),
        ],
        eventAcks: [
          expect.objectContaining({
            eventId: "legacy-event",
            ackedRelays: ["wss://relay.example"],
            hasRelayOutcomes: false,
            migrated: true,
          }),
        ],
      })
    );
    expect(storage.getItem(legacyKey)).toBeNull();
    expect(storage.key(0)).toContain("nostr-git:repo-creation:v2:");
  });

  it("redacts credentials from checkpoints, results, URLs, errors, and ACK details", () => {
    const storage = new MemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    const token = "ghp_super_secret";
    const journal = new RepoCreationTransactionJournal({
      id: "new:owner:repo:no-secrets",
      operation: "new",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    journal.setTargets([
      {
        id: "git:github.com",
        label: "GitHub",
        provider: "github",
        host: "github.com",
        token,
      },
    ]);
    journal.recordRemoteSyncCheckpoint({
      action: "push",
      position: "after",
      target: {
        id: "git:github.com",
        label: "GitHub",
        provider: "github",
        host: "github.com",
      },
      stage: "unknown",
      remoteUrl: `https://owner:${token}@github.com/owner/repo.git?access_token=${token}`,
      createdRemote: true,
      error: `network timeout for ${token}`,
      ref: { ref: "refs/heads/main", stage: "unknown", error: `lost ${token}` },
    });
    expect(journal.record.targets[0].cleanup).toEqual({
      stage: "pending",
      manualAttention: true,
    });
    journal.recordTargetResult({
      id: "git:github.com",
      label: "GitHub",
      provider: "github",
      success: false,
      createdRemote: true,
      outcome: "unknown",
      error: `ambiguous response ${token}`,
      failedRefs: [{ ref: "refs/heads/main", error: `failed with ${token}` }],
    });
    const event = {
      id: "event-no-secret",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };
    journal.recordPublishedEvent(
      {
        event,
        ackedRelays: ["wss://relay.example"],
        failedRelays: [],
        relayOutcomes: [
          { relay: "wss://relay.example", status: "success", detail: `accepted ${token}` },
        ],
      },
      ["wss://relay.example"],
      "provisional"
    );

    const serialized = storage.getItem(storage.key(0) as string) as string;
    expect(serialized).not.toContain(token);
    expect(serialized).not.toContain(encodeURIComponent(token));
    expect(serialized).toContain("[REDACTED]");
    expect(journal.record.targets[0]).toEqual(
      expect.objectContaining({
        stage: "unknown",
        createdRemote: true,
        manualAttention: true,
        cleanup: expect.objectContaining({ stage: "unknown", manualAttention: true }),
        refs: [expect.objectContaining({ ref: "refs/heads/main", stage: "unknown" })],
      })
    );
  });

  it("removes a completed transaction", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "fork:owner:repo:1",
      operation: "fork",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });

    expect(getPendingRepoCreationTransactions()).toHaveLength(1);
    journal.complete();
    expect(getPendingRepoCreationTransactions()).toHaveLength(0);
  });

  it("records only relays that acknowledged a provisional event", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "import:owner:repo:acked-relays",
      operation: "import",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    const event = {
      id: "event-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };
    const publisher = trackRepoCreationPublisher(
      journal,
      vi.fn().mockResolvedValue({
        event,
        ackedRelays: ["wss://accepted.example"],
        failedRelays: ["wss://timed-out.example"],
        successCount: 1,
        hasRelayOutcomes: true,
      })
    );

    await publisher?.(event, {
      relays: ["wss://accepted.example", "wss://timed-out.example"],
    });

    expect(journal.record.publishedEvents[0].relayUrls).toEqual(["wss://accepted.example"]);
  });

  it("records no rollback scope when publication has no relay outcomes", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "import:owner:repo:no-outcomes",
      operation: "import",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    const event = {
      id: "event-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };
    const publisher = trackRepoCreationPublisher(
      journal,
      vi.fn().mockResolvedValue({ event, successCount: 1 })
    );

    await publisher?.(event, { relays: ["wss://requested.example"] });

    expect(journal.record.publishedEvents[0].relayUrls).toEqual([]);
    expect(journal.record.eventAcks[0]).toMatchObject({
      requestedRelayUrls: ["wss://requested.example"],
      ackedRelays: [],
      hasRelayOutcomes: false,
    });
  });

  it("retries the latest exact signed metadata without recreating targets", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "import:owner:repo:1",
      operation: "import",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    const announcement = {
      id: "announcement-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 2,
      tags: [
        ["d", "repo"],
        ["relays", "wss://relay.example"],
      ],
      content: "",
    };
    const state = { ...announcement, id: "state-id", kind: 30618, tags: [["d", "repo"]] };
    journal.recordPublishedEvent({ event: announcement }, ["wss://relay.example"], "final");
    journal.recordPublishedEvent({ event: state }, ["wss://relay.removed"], "final");
    journal.setPhase("metadata-pending");
    const publisher = vi.fn(async (event) => ({
      event,
      ackedRelays: ["wss://relay.example"],
      failedRelays: [],
    }));

    await retryPendingRepoCreationMetadata(journal.record, publisher);

    expect(publisher.mock.calls.map((call) => call[0])).toEqual([announcement, state]);
    expect(publisher.mock.calls.every((call) => call[1].relays[0] === "wss://relay.example")).toBe(
      true
    );
    expect(getPendingRepoCreationTransactions()).toHaveLength(0);
  });

  it("requires exact GRASP visibility before completing metadata recovery", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "import:owner:repo:grasp-recovery",
      operation: "import",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    const announcement = {
      id: "announcement-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 2,
      tags: [
        ["d", "repo"],
        ["relays", "wss://grasp.example"],
      ],
      content: "",
    };
    const state = { ...announcement, id: "state-id", kind: 30618, tags: [["d", "repo"]] };
    journal.setTargets([
      {
        id: "grasp:wss://grasp.example",
        label: "GRASP",
        provider: "grasp",
        relayUrl: "wss://grasp.example",
      },
    ]);
    journal.setTargetResults([
      {
        id: "grasp:wss://grasp.example",
        label: "GRASP",
        provider: "grasp",
        relayUrl: "wss://grasp.example",
        remoteUrl: "https://grasp.example/npub1owner/repo.git",
        success: true,
      },
    ]);
    journal.recordPublishedEvent({ event: announcement }, ["wss://grasp.example"], "final");
    journal.recordPublishedEvent({ event: state }, ["wss://grasp.example"], "final");
    journal.setPhase("metadata-pending");
    const publisher = vi.fn(async (event) => ({
      event,
      ackedRelays: ["wss://grasp.example"],
      failedRelays: [],
    }));
    const fetchRelayEvents = vi.fn(async ({ filters }) => {
      const id = filters[0]?.ids?.[0];
      return [announcement, state].filter((event) => event.id === id);
    });

    await retryPendingRepoCreationMetadata(journal.record, publisher, fetchRelayEvents);

    expect(fetchRelayEvents).toHaveBeenCalledTimes(2);
    expect(getPendingRepoCreationTransactions()).toHaveLength(0);
  });

  it("recovers metadata through the relay subset that ACKs both exact events", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "import:owner:repo:partial-relays",
      operation: "import",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    const announcement = {
      id: "announcement-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 2,
      tags: [
        ["d", "repo"],
        ["clone", "https://github.com/owner/repo.git"],
        ["relays", "wss://available.example", "wss://offline.example"],
      ],
      content: "",
    };
    const state = { ...announcement, id: "state-id", kind: 30618, tags: [["d", "repo"]] };
    journal.recordPublishedEvent(
      { event: announcement },
      ["wss://available.example", "wss://offline.example"],
      "final"
    );
    journal.recordPublishedEvent(
      { event: state },
      ["wss://available.example", "wss://offline.example"],
      "final"
    );
    journal.setPhase("metadata-pending");
    let signedCount = 0;
    const publisher = vi.fn(async (event, context) => {
      const signed = event.id
        ? event
        : {
            ...event,
            id: `reconciled-${++signedCount}`,
            pubkey: "f".repeat(64),
            sig: "signature",
          };
      return {
        event: signed,
        ackedRelays: ["wss://available.example"],
        failedRelays: (context?.relays || []).filter(
          (relay: string) => relay !== "wss://available.example"
        ),
        successCount: 1,
        hasRelayOutcomes: true,
      };
    });

    const recovered = await retryPendingRepoCreationMetadata(journal.record, publisher);

    expect(publisher.mock.calls[0][1].relays).toEqual([
      "wss://available.example",
      "wss://offline.example",
    ]);
    expect(publisher.mock.calls[1][1].relays).toEqual(["wss://available.example"]);
    expect(recovered.announcement.event.tags).toContainEqual(["relays", "wss://available.example"]);
    expect(getPendingRepoCreationTransactions()).toHaveLength(0);
  });

  it("does not demote a final event when an exact replay omits the stage", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "new:owner:repo:stage",
      operation: "new",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    const event = {
      id: "final-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };

    journal.recordPublishedEvent({ event }, ["wss://relay.example"], "final");
    journal.recordPublishedEvent({ event }, ["wss://relay.example"], "provisional");

    expect(journal.record.publishedEvents[0].stage).toBe("final");
  });

  it("retains failed exact deletions and clears them after compensation succeeds", async () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: new MemoryStorage(),
    });
    const journal = new RepoCreationTransactionJournal({
      id: "new:owner:repo:cleanup",
      operation: "new",
      ownerPubkey: "f".repeat(64),
      repoName: "repo",
    });
    const event = {
      id: "provisional-id",
      sig: "signature",
      pubkey: "f".repeat(64),
      kind: 30617,
      created_at: 1,
      tags: [["d", "repo"]],
      content: "",
    };
    journal.recordPublishedEvent({ event }, ["wss://relay.example"], "provisional");
    journal.setPendingCompensations([
      {
        action: "delete",
        eventId: event.id,
        relayUrls: ["wss://relay.example"],
        error: "timeout",
      },
    ]);
    journal.complete();
    const [record] = getPendingRepoCreationTransactions();
    const onDeleteEvent = vi.fn();

    await retryRepoCreationCompensations(record, onDeleteEvent);

    expect(onDeleteEvent).toHaveBeenCalledWith(event, ["wss://relay.example"]);
    expect(getPendingRepoCreationTransactions()).toHaveLength(0);
  });
});
