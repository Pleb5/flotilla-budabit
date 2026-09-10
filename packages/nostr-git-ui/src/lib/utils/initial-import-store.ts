import type { NostrEvent } from "@nostr-git/core";
import { getEventHash, verifyEvent } from "nostr-tools";
import { validateRepoDisplayName, validateRepoIdentifier } from "@nostr-git/core/utils";
import {
  INITIAL_IMPORT_LIMITS,
  parseInitialImportUrl,
  isInitialImportName,
  isInitialImportRef,
  type InitialImportSource,
} from "./initial-import-source.js";
import { initialImportMetadata, initialImportAddress } from "./initial-import-metadata.js";

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
  displayName?: string;
  /** Present on new jobs only so existing exact signed recovery payloads remain unchanged. */
  upstream?: string;
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
  close?(): Promise<void>;
}

const gitStages = ["planned", "cloning", "cloned", "pushing", "verified"];
const eventKinds: Record<InitialImportEventType, number[]> = {
  announcement: [30617],
  state: [30618],
  issue: [1621],
  status: [1630, 1632],
  comment: [1111],
};

export function validateInitialImportJob(job: InitialImportJob): void {
  if (!job || !job.source || !job.counts || !Array.isArray(job.refs))
    throw new Error("Invalid initial import recovery record");
  const parsed = parseInitialImportUrl(job.source.url);
  if (
    job.version !== 1 ||
    !/^[0-9a-f]{64}$/.test(job.owner) ||
    // Preserve previously accepted recovery identifiers; new input uses the shared validator.
    typeof job.name !== "string" ||
    (!isInitialImportName(job.name) && Boolean(validateRepoIdentifier(job.name))) ||
    (job.upstream !== undefined && job.upstream !== `${job.source?.url}.git`) ||
    (job.displayName !== undefined &&
      (typeof job.displayName !== "string" || Boolean(validateRepoDisplayName(job.displayName)))) ||
    !/^initial-import:[\w-]+$/.test(job.id) ||
    !Number.isSafeInteger(job.createdAt) ||
    job.createdAt <= 0 ||
    parsed.url !== job.source.url ||
    parsed.owner !== job.source.owner ||
    parsed.name !== job.source.name ||
    !Number.isSafeInteger(job.source.id) ||
    job.source.id <= 0 ||
    typeof job.source.description !== "string" ||
    job.source.description.length > 2000 ||
    !Number.isFinite(job.source.sizeKiB) ||
    job.source.sizeKiB <= 0 ||
    job.source.sizeKiB > INITIAL_IMPORT_LIMITS.gitKiB ||
    !Number.isSafeInteger(job.source.openIssues) ||
    job.source.openIssues < 0 ||
    job.localRepoId !== `${job.owner}:initial-${job.id.slice(15)}` ||
    job.refs.length === 0 ||
    job.refs.length > INITIAL_IMPORT_LIMITS.refs ||
    job.refs.some((r) => !isInitialImportRef(r)) ||
    new Set(job.refs.map((r) => r.ref)).size !== job.refs.length ||
    !job.refs.some((r) => r.ref === `refs/heads/${job.source.defaultBranch}`) ||
    !gitStages.includes(job.gitStage) ||
    !["pending", "complete", "stopped", "attention", "partial"].includes(job.status) ||
    !["pending", "complete"].includes(job.localCleanup) ||
    [job.issues, job.comments, job.publicStarted].some((value) => typeof value !== "boolean") ||
    (job.comments && !job.issues)
  ) {
    throw new Error("Invalid initial import recovery record");
  }
  if (
    [
      job.counts.issue,
      job.counts.status,
      job.counts.comment,
      job.counts.events,
      job.counts.bytes,
    ].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    job.counts.events !== job.counts.issue + job.counts.status + job.counts.comment ||
    job.counts.events > INITIAL_IMPORT_LIMITS.events ||
    job.counts.bytes > INITIAL_IMPORT_LIMITS.historyBytes ||
    (job.workerOperation &&
      (!["cloneRemoteRepo", "pushToRemote", "deleteRepo"].includes(job.workerOperation.type) ||
        !job.workerOperation.id.startsWith(`${job.id}:${job.workerOperation.type}:`)))
  ) {
    throw new Error("Invalid import counters or worker operation scope");
  }
  const relay = new URL(job.relay);
  if (
    !(
      relay.protocol === "wss:" ||
      (relay.protocol === "ws:" && ["localhost", "127.0.0.1"].includes(relay.hostname))
    ) ||
    relay.username ||
    relay.password ||
    relay.search ||
    relay.hash
  ) {
    throw new Error("Recovery relay must not contain credentials");
  }
  if (
    ((job.gitStage !== "planned" || job.state) && !job.announcement) ||
    (job.gitStage === "verified" && !job.state) ||
    ((job.status === "complete" || job.status === "partial" || job.localCleanup === "complete") &&
      job.gitStage !== "verified") ||
    (job.status === "complete" && (job.pending || job.workerOperation)) ||
    (job.counts.events > 0 && job.gitStage !== "verified") ||
    (!job.issues && job.counts.events > 0) ||
    (!job.comments && job.counts.comment > 0) ||
    (!job.publicStarted && (job.announcement || job.state))
  ) {
    throw new Error("Inconsistent initial import recovery stage");
  }
  const metadata = {
    announcement: initialImportMetadata(job, "announcement"),
    state: initialImportMetadata(job, "state"),
  };
  if (
    Object.values(metadata).some(
      (template) =>
        new TextEncoder().encode(JSON.stringify(template)).byteLength >
        INITIAL_IMPORT_LIMITS.eventBytes - 512
    )
  )
    throw new Error("Planned repository metadata exceeds the 32 KiB event limit");
  const validateEvent = (event: NostrEvent, type: InitialImportEventType) => {
    // Never accept nostr-tools' cached verification symbol on a mutable event object.
    const plain = {
      id: event.id,
      sig: event.sig,
      pubkey: event.pubkey,
      kind: event.kind,
      created_at: event.created_at,
      tags: event.tags,
      content: event.content,
    };
    if (
      event.pubkey !== job.owner ||
      event.created_at !== job.createdAt ||
      !eventKinds[type]?.includes(event.kind) ||
      new TextEncoder().encode(JSON.stringify(event)).byteLength >
        INITIAL_IMPORT_LIMITS.eventBytes ||
      !verifyEvent(plain)
    ) {
      throw new Error("Invalid or oversized signed recovery event");
    }
    if (type === "announcement" || type === "state") {
      if (event.id !== getEventHash({ ...metadata[type], pubkey: job.owner }))
        throw new Error("Recovery metadata differs from the approved destination/ref plan");
    } else if (
      !event.tags.some((t) => ["a", "A", "q"].includes(t[0]) && t[1] === initialImportAddress(job))
    ) {
      throw new Error("Pending history belongs to another repository");
    }
  };
  if (job.announcement) validateEvent(job.announcement, "announcement");
  if (job.state) validateEvent(job.state, "state");
  if (job.pending) {
    const { event, type, key } = job.pending;
    validateEvent(event, type);
    if (type === "announcement" || type === "state") {
      if (key !== type || (type === "state" && !job.announcement))
        throw new Error("Invalid pending metadata identity");
    } else {
      const prefix = `github:github.com:${job.source.id}:${type}:`;
      if (
        job.gitStage !== "verified" ||
        !job.issues ||
        (type === "comment" && !job.comments) ||
        !key.startsWith(prefix) ||
        !/^[1-9]\d*$/.test(key.slice(prefix.length)) ||
        !event.tags.some((t) => t[0] === "source-key" && t[1] === key)
      )
        throw new Error("Invalid pending source identity or history stage");
      if (
        job.counts.events + 1 > INITIAL_IMPORT_LIMITS.events ||
        job.counts.bytes + new TextEncoder().encode(JSON.stringify(event)).byteLength >
          INITIAL_IMPORT_LIMITS.historyBytes
      )
        throw new Error("Pending history exceeds the import delivery budget");
    }
  }
  if (new TextEncoder().encode(JSON.stringify(job)).byteLength > 128 * 1024)
    throw new Error("Import journal exceeds its 128 KiB limit");
}

const identity = (job: InitialImportJob) =>
  JSON.stringify([
    job.owner,
    job.name,
    job.displayName,
    job.upstream,
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
  private closed = false;
  async close(): Promise<void> {
    this.closed = true;
    const db = await this.db?.catch(() => undefined);
    db?.close();
  }
  private open(): Promise<IDBDatabase> {
    if (this.closed) return Promise.reject(new Error("Import recovery store is closed"));
    return (this.db ??= new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") {
        reject(new Error("IndexedDB is required for recoverable imports"));
        return;
      }
      const request = indexedDB.open("nostr-git-initial-import", 1);
      let unavailable = false;
      request.onupgradeneeded = () => {
        const jobs = request.result.createObjectStore("jobs", { keyPath: "id" });
        jobs.createIndex("coordinate", ["owner", "name"], { unique: true });
        jobs.createIndex("owner", "owner");
        request.result.createObjectStore("receipts", { keyPath: ["jobId", "key"] });
      };
      request.onsuccess = () => {
        if (this.closed || unavailable) {
          request.result.close();
          reject(new Error("Import recovery store is closed or unavailable"));
          return;
        }
        request.result.onversionchange = () => {
          request.result.close();
          this.db = undefined;
        };
        resolve(request.result);
      };
      request.onerror = request.onblocked = () => {
        unavailable = true;
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
      if (
        (previous.publicStarted && !job.publicStarted) ||
        gitStages.indexOf(job.gitStage) < gitStages.indexOf(previous.gitStage) ||
        (previous.announcement && job.announcement?.id !== previous.announcement.id) ||
        (previous.state && job.state?.id !== previous.state.id) ||
        (previous.localCleanup === "complete" && job.localCleanup !== "complete") ||
        Object.keys(previous.counts).some(
          (key) =>
            job.counts[key as keyof typeof job.counts] <
            previous.counts[key as keyof typeof job.counts]
        ) ||
        (previous.pending &&
          (job.pending?.event.id !== previous.pending.event.id ||
            job.pending?.key !== previous.pending.key ||
            job.pending?.type !== previous.pending.type))
      )
        throw new Error(
          "Stale import recovery cannot discard confirmed progress or a pending event"
        );
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
    const receipt = await requestResult(
      db.transaction("receipts").objectStore("receipts").get([jobId, key])
    );
    if (
      receipt &&
      (!/^[0-9a-f]{64}$/.test(receipt.eventId) ||
        receipt.jobId !== jobId ||
        receipt.key !== key ||
        receipt.type !== (key === "announcement" || key === "state" ? key : key.split(":")[3]))
    )
      throw new Error("Invalid initial import delivery receipt");
    return receipt;
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
      validateInitialImportJob(current);
      const receipts = tx.objectStore("receipts");
      const existing = await requestResult(receipts.get([job.id, pending.key]));
      if (existing && (existing.eventId !== pending.event.id || existing.type !== pending.type))
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
