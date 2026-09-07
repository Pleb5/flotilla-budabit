import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import {
  IndexedInitialImportStore,
  validateInitialImportJob,
  type InitialImportJob,
} from "./initial-import-store";
import { initialImportMetadata, initialImportAddress } from "./initial-import-metadata";
import { INITIAL_IMPORT_LIMITS, initialImportTemplate } from "./initial-import-source";

const key = new Uint8Array(32).fill(21);
function record(): InitialImportJob {
  const id = `initial-import:${crypto.randomUUID()}`;
  const owner = getPublicKey(key);
  return {
    version: 1,
    id,
    owner,
    name: "repo",
    relay: "wss://grasp.test",
    localRepoId: `${owner}:initial-${id.slice(15)}`,
    source: {
      url: "https://github.com/a/b",
      owner: "a",
      name: "b",
      id: 1,
      description: "",
      defaultBranch: "main",
      sizeKiB: 1,
      openIssues: 1,
    },
    refs: [{ ref: "refs/heads/main", oid: "a".repeat(40) }],
    createdAt: 1704067200,
    issues: true,
    comments: true,
    publicStarted: false,
    gitStage: "planned",
    status: "pending",
    localCleanup: "pending",
    counts: { issue: 0, status: 0, comment: 0, events: 0, bytes: 0 },
  };
}
beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));

describe("initial import recovery validation", () => {
  it("rejects corrupt states, counters and ref names before reuse", () => {
    for (const changes of [
      { status: "anything" },
      { issues: "yes" },
      { gitStage: "verified" },
      { status: "complete" },
      { counts: { issue: 1, status: 0, comment: 0, events: 0, bytes: 0 } },
      { refs: [{ ref: "refs/heads/../private", oid: "a".repeat(40) }] },
    ])
      expect(() =>
        validateInitialImportJob({ ...record(), ...changes } as InitialImportJob)
      ).toThrow();
  });
  it("rejects valid signatures for different destinations or state plans", () => {
    const job = record();
    job.announcement = finalizeEvent(
      initialImportMetadata({ ...job, name: "another-repo" }, "announcement"),
      key
    );
    expect(() => validateInitialImportJob(job)).toThrow();
    job.announcement = finalizeEvent(initialImportMetadata(job, "announcement"), key);
    job.publicStarted = true;
    job.state = finalizeEvent(
      initialImportMetadata(
        { ...job, refs: [{ ref: "refs/heads/main", oid: "b".repeat(40) }] },
        "state"
      ),
      key
    );
    expect(() => validateInitialImportJob(job)).toThrow();
  });
  it("bounds pending history too, including persisted retries and source-key scope", () => {
    const job = record();
    job.publicStarted = true;
    job.gitStage = "verified";
    job.announcement = finalizeEvent(initialImportMetadata(job, "announcement"), key);
    job.state = finalizeEvent(initialImportMetadata(job, "state"), key);
    const event = finalizeEvent(
      initialImportTemplate({
        source: job.source,
        type: "issue",
        ownerPubkey: job.owner,
        repoAddress: initialImportAddress(job),
        createdAt: job.createdAt,
        item: {
          id: 1,
          number: 1,
          title: "Issue",
          body: "body",
          user: null,
          state: "open",
          created_at: "2024-01-01",
          updated_at: "2024-01-01",
        },
      }),
      key
    );
    job.pending = { key: "github:github.com:1:issue:1", type: "issue", event };
    expect(() => validateInitialImportJob(job)).not.toThrow();
    expect(() =>
      validateInitialImportJob({
        ...job,
        pending: { ...job.pending!, key: "github:github.com:999:issue:1" },
      })
    ).toThrow();
    expect(() =>
      validateInitialImportJob({
        ...job,
        counts: { ...job.counts, bytes: INITIAL_IMPORT_LIMITS.historyBytes },
      })
    ).toThrow();
  });
  it("checks all planned metadata fits before the announcement is published", () => {
    const job = record();
    job.refs.push(
      ...Array.from({ length: 80 }, (_, n) => ({
        ref: `refs/heads/${n}-${"a".repeat(600)}`,
        oid: "a".repeat(40),
      }))
    );
    expect(() => validateInitialImportJob(job)).toThrow();
  });
  it("does not trust cached signature verification on a mutated event", () => {
    const job = record();
    job.publicStarted = true;
    job.announcement = finalizeEvent(initialImportMetadata(job, "announcement"), key);
    job.announcement.sig = "0".repeat(128);
    expect(() => validateInitialImportJob(job)).toThrow();
  });
  it("does not allow stale saves to discard a pending event or acknowledged metadata", async () => {
    const store = new IndexedInitialImportStore();
    const job = record();
    await store.create(job);
    const pending = {
      ...job,
      publicStarted: true,
      pending: {
        key: "announcement",
        type: "announcement" as const,
        event: finalizeEvent(initialImportMetadata(job, "announcement"), key),
      },
    };
    await store.save(pending);
    await expect(store.save(job)).rejects.toThrow("Stale import recovery");
    const confirmed = await store.confirm(pending);
    await expect(store.save({ ...confirmed, announcement: undefined })).rejects.toThrow(
      "Stale import recovery"
    );
    await store.close();
  });
  it("closes its database handle and rejects later operations", async () => {
    const store = new IndexedInitialImportStore();
    const job = record();
    await store.create(job);
    await store.close();
    await expect(store.get(job.id)).rejects.toThrow("closed");
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("nostr-git-initial-import", 2);
      request.onsuccess = () => resolve(request.result);
      request.onblocked = () => reject(new Error("Leaked database connection"));
      request.onerror = () => reject(request.error);
    });
    upgraded.close();
  });
  it("rejects malformed or wrong-type compact receipts rather than reusing their event IDs", async () => {
    const store = new IndexedInitialImportStore();
    const job = record();
    await store.create(job);
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("nostr-git-initial-import", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      for (const receipt of [
        { eventId: "invalid", type: "issue" },
        { eventId: "f".repeat(64), type: "comment" },
      ]) {
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction("receipts", "readwrite");
          tx.oncomplete = () => resolve();
          tx.onabort = () => reject(tx.error);
          tx.objectStore("receipts").put({
            jobId: job.id,
            key: "github:github.com:1:issue:1",
            ...receipt,
          });
        });
        await expect(store.receipt(job.id, "github:github.com:1:issue:1")).rejects.toThrow(
          "Invalid initial import delivery receipt"
        );
      }
    } finally {
      db.close();
      await store.close();
    }
  });
  it("closes a store destroyed during its first asynchronous open", async () => {
    const store = new IndexedInitialImportStore();
    const listing = store.list(getPublicKey(key));
    const rejected = expect(listing).rejects.toThrow("closed");
    await store.close();
    await rejected;
  });
});
