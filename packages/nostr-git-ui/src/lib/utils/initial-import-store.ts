import type { NostrEvent } from "@nostr-git/core";
import { verifyEvent } from "nostr-tools";
import {
  INITIAL_IMPORT_LIMITS,
  parseInitialImportUrl,
  type InitialImportSource,
} from "./initial-import-source.js";

export interface InitialImportRef {
  ref: string;
  oid: string;
}
export type InitialImportEventType = "announcement" | "state" | "issue" | "status" | "comment";
export interface InitialImportPending {
  key: string;
  type: InitialImportEventType;
  event: NostrEvent;
}
export interface InitialImportReceipt {
  eventId: string;
  type: InitialImportEventType;
}
export interface InitialImportJob {
  version: 1;
  id: string;
  owner: string;
  name: string;
  relay: string;
  source: InitialImportSource;
  refs: InitialImportRef[];
  localRepoId: string;
  createdAt: number;
  issues: boolean;
  comments: boolean;
  publicStarted: boolean;
  gitStage: "planned" | "cloning" | "cloned" | "pushing" | "verified";
  status: "pending" | "complete" | "stopped" | "attention" | "partial";
  localCleanup: "pending" | "complete";
  workerOperation?: { id: string; type: "cloneRemoteRepo" | "pushToRemote" | "deleteRepo" };
  announcement?: NostrEvent;
  state?: NostrEvent;
  pending?: InitialImportPending;
  counts: { issue: number; status: number; comment: number; events: number; bytes: number };
  message?: string;
}
export interface InitialImportStore {
  create(job: InitialImportJob): Promise<void>;
  save(job: InitialImportJob): Promise<void>;
  get(id: string): Promise<InitialImportJob | undefined>;
  list(owner: string): Promise<InitialImportJob[]>;
  receipt(jobId: string, key: string): Promise<InitialImportReceipt | undefined>;
  confirm(job: InitialImportJob): Promise<InitialImportJob>;
}

export function validateInitialImportJob(job: InitialImportJob): void {
  const parsed = parseInitialImportUrl(job.source.url);
  if (
    job.version !== 1 ||
    !/^[0-9a-f]{64}$/.test(job.owner) ||
    !/^[\w.-]{1,64}$/.test(job.name) ||
    !/^initial-import:[\w-]+$/.test(job.id) ||
    !Number.isSafeInteger(job.createdAt) ||
    parsed.url !== job.source.url ||
    parsed.owner !== job.source.owner ||
    parsed.name !== job.source.name ||
    !Number.isSafeInteger(job.source.id) ||
    job.source.id <= 0 ||
    job.localRepoId !== `${job.owner}:initial-${job.id.slice(15)}` ||
    job.refs.length === 0 ||
    job.refs.length > INITIAL_IMPORT_LIMITS.refs ||
    job.refs.some((r) => !/^refs\/(heads|tags)\/.+/.test(r.ref) || !/^[0-9a-f]{40}$/.test(r.oid))
  ) {
    throw new Error("Invalid initial import recovery record");
  }
  if (
    Object.values(job.counts).some((n) => !Number.isSafeInteger(n) || n < 0) ||
    job.counts.events > INITIAL_IMPORT_LIMITS.events ||
    job.counts.bytes > INITIAL_IMPORT_LIMITS.historyBytes ||
    (job.workerOperation &&
      !job.workerOperation.id.startsWith(`${job.id}:${job.workerOperation.type}:`))
  ) {
    throw new Error("Invalid import counters or worker operation scope");
  }
  const relay = new URL(job.relay);
  if (
    !["ws:", "wss:"].includes(relay.protocol) ||
    relay.username ||
    relay.password ||
    relay.search ||
    relay.hash
  ) {
    throw new Error("Recovery relay must not contain credentials");
  }
  for (const event of [job.announcement, job.state, job.pending?.event]) {
    if (
      event &&
      (event.pubkey !== job.owner ||
        !verifyEvent(event) ||
        new TextEncoder().encode(JSON.stringify(event)).byteLength >
          INITIAL_IMPORT_LIMITS.eventBytes)
    ) {
      throw new Error("Invalid or oversized signed recovery event");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(job)).byteLength > 128 * 1024)
    throw new Error("Import journal exceeds its 128 KiB limit");
}

const identity = (job: InitialImportJob) =>
  JSON.stringify([
    job.owner,
    job.name,
    job.relay,
    job.source,
    job.refs,
    job.localRepoId,
    job.createdAt,
    job.issues,
    job.comments,
  ]);
const requestResult = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Import storage request failed"));
  });
const completed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(new Error("Could not persist import recovery. No further work was started."));
  });

/** Indexed lookups only: no getAll of history, body arrays, or in-memory receipt index. */
export class IndexedInitialImportStore implements InitialImportStore {
  private db?: Promise<IDBDatabase>;
  private open(): Promise<IDBDatabase> {
    return (this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is required for recoverable imports"));
        return;
      }
      const request = indexedDB.open("nostr-git-initial-import", 1);
      request.onupgradeneeded = () => {
        const jobs = request.result.createObjectStore("jobs", { keyPath: "id" });
        jobs.createIndex("coordinate", ["owner", "name"], { unique: true });
        jobs.createIndex("owner", "owner");
        request.result.createObjectStore("receipts", { keyPath: ["jobId", "key"] });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => {
        this.db = undefined;
        reject(new Error("Import recovery storage is unavailable"));
      };
    }));
  }
  async create(job: InitialImportJob): Promise<void> {
    validateInitialImportJob(job);
    const db = await this.open();
    const tx = db.transaction("jobs", "readwrite");
    const done = completed(tx);
    try {
      const jobs = tx.objectStore("jobs");
      if ((await requestResult(jobs.count())) >= 50)
        throw new Error(
          "Local import job limit reached (50); preserve/export recovery before clearing storage"
        );
      await requestResult(jobs.add(job));
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async save(job: InitialImportJob): Promise<void> {
    validateInitialImportJob(job);
    const db = await this.open();
    const tx = db.transaction("jobs", "readwrite");
    const done = completed(tx);
    try {
      const previous = (await requestResult(tx.objectStore("jobs").get(job.id))) as
        | InitialImportJob
        | undefined;
      if (!previous || identity(previous) !== identity(job))
        throw new Error("Import source, destination or actor changed");
      tx.objectStore("jobs").put(job);
      await done;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
  async get(id: string): Promise<InitialImportJob | undefined> {
    const db = await this.open();
    const job = await requestResult(db.transaction("jobs").objectStore("jobs").get(id));
    if (job) validateInitialImportJob(job);
    return job;
  }
  async list(owner: string): Promise<InitialImportJob[]> {
    const db = await this.open();
    // 50 jobs globally, bounded summaries. Never load receipts here.
    const jobs = (await requestResult(
      db.transaction("jobs").objectStore("jobs").index("owner").getAll(owner, 50)
    )) as InitialImportJob[];
    jobs.forEach(validateInitialImportJob);
    return jobs;
  }
  async receipt(jobId: string, key: string): Promise<InitialImportReceipt | undefined> {
    const db = await this.open();
    return requestResult(db.transaction("receipts").objectStore("receipts").get([jobId, key]));
  }
  async confirm(job: InitialImportJob): Promise<InitialImportJob> {
    const db = await this.open();
    const tx = db.transaction(["jobs", "receipts"], "readwrite");
    const done = completed(tx);
    try {
      const current = (await requestResult(tx.objectStore("jobs").get(job.id))) as InitialImportJob;
      if (
        !current ||
        identity(current) !== identity(job) ||
        !current.pending ||
        current.pending.event.id !== job.pending?.event.id
      ) {
        throw new Error("Pending import event changed");
      }
      const pending = current.pending;
      const receipts = tx.objectStore("receipts");
      const existing = await requestResult(receipts.get([job.id, pending.key]));
      if (existing && existing.eventId !== pending.event.id)
        throw new Error("Import source identity already has a different event receipt");
      const next = confirmedInitialImportJob(current, Boolean(existing));
      validateInitialImportJob(next);
      receipts.put({
        jobId: job.id,
        key: pending.key,
        eventId: pending.event.id,
        type: pending.type,
      });
      tx.objectStore("jobs").put(next);
      await done;
      return next;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await done.catch(() => {});
      throw error;
    }
  }
}

export function confirmedInitialImportJob(
  job: InitialImportJob,
  alreadyConfirmed = false
): InitialImportJob {
  if (!job.pending) throw new Error("No pending import event");
  const { type, event } = job.pending;
  const next = { ...job, pending: undefined, counts: { ...job.counts } };
  if (type === "announcement") next.announcement = event;
  else if (type === "state") next.state = event;
  else if (!alreadyConfirmed) {
    next.counts[type]++;
    next.counts.events++;
    next.counts.bytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
  }
  return next;
}
