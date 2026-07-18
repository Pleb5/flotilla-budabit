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
        phase: "metadata-pending",
        lastError: "relay timeout",
        targets: [expect.objectContaining({ id: "git:github.com", host: "github.com" })],
        publishedEvents: [{ event, relayUrls: ["wss://relay.example"], stage: "provisional" }],
      })
    );
    expect(JSON.stringify(record)).not.toContain("secret-token");
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
