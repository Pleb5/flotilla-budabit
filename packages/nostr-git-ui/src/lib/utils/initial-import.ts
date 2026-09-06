import { ImportAbortController, type NostrEvent } from "@nostr-git/core";
import { createRepoAnnouncementEvent, createRepoStateEvent } from "@nostr-git/core/events";
import { getEventHash, verifyEvent } from "nostr-tools";
import {
  buildGraspRepoUrls,
  extractPublishRelayAck,
  type FetchRelayEvents,
  type PublishRepoEvent,
} from "./grasp-pipeline.js";
import {
  INITIAL_IMPORT_LIMITS,
  initialImportPages,
  initialImportSourceKey,
  initialImportTemplate,
  inspectInitialImportSource,
  type ImportEventTemplate,
  type InitialImportSource,
} from "./initial-import-source.js";
import {
  validateInitialImportJob,
  type InitialImportEventType,
  type InitialImportJob,
  type InitialImportRef,
  type InitialImportStore,
} from "./initial-import-store.js";

export interface InitialImportGit {
  refs(url: string): Promise<InitialImportRef[]>;
  assertNew(job: InitialImportJob): Promise<void>;
  ready(job: InitialImportJob, signal: AbortSignal): Promise<void>;
  clone(job: InitialImportJob, operationId: string): Promise<void>;
  verifyLocal(job: InitialImportJob): Promise<void>;
  push(job: InitialImportJob, refs: InitialImportRef[], operationId: string): Promise<void>;
  settle(job: InitialImportJob): Promise<boolean>;
  cancel(operationId: string): Promise<void>;
  cleanup(job: InitialImportJob, operationId: string): Promise<void>;
}
export interface InitialImportRuntime {
  store: InitialImportStore;
  git: InitialImportGit;
  sign(template: ImportEventTemplate): Promise<NostrEvent>;
  publish: PublishRepoEvent;
  fetchEvents: FetchRelayEvents;
  assertActor(owner: string): void;
  onProgress?(job: InitialImportJob, step: string): void;
  inspectSource?: typeof inspectInitialImportSource;
  pages?: typeof initialImportPages;
  pause?(signal: AbortSignal): Promise<void>;
}
export interface InitialImportInput {
  sourceUrl: string;
  owner: string;
  name: string;
  relay: string;
  issues: boolean;
  comments: boolean;
}

export function normalizeInitialImportRelay(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a wss:// GRASP service URL");
  }
  if (
    !(
      url.protocol === "wss:" ||
      (url.protocol === "ws:" && ["localhost", "127.0.0.1"].includes(url.hostname))
    ) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname.includes("npub1")
  ) {
    throw new Error("Choose one secure GRASP service URL without credentials or query parameters");
  }
  return url.toString().replace(/\/$/, "");
}
export const initialImportAddress = (job: Pick<InitialImportJob, "owner" | "name">) =>
  `30617:${job.owner}:${job.name}`;
export const initialImportUrls = (job: Pick<InitialImportJob, "owner" | "name" | "relay">) =>
  buildGraspRepoUrls({ relayUrls: [job.relay], ownerPubkey: job.owner, repoName: job.name });

export function selectInitialImportRefs(
  refs: InitialImportRef[],
  defaultBranch: string
): InitialImportRef[] {
  const selected = refs.filter(
    (r) => /^refs\/(heads|tags)\//.test(r.ref) && !r.ref.endsWith("^{}")
  );
  if (
    !selected.length ||
    selected.length > INITIAL_IMPORT_LIMITS.refs ||
    !selected.some((r) => r.ref === `refs/heads/${defaultBranch}`) ||
    selected.some((r) => !/^[0-9a-f]{40}$/.test(r.oid)) ||
    new Set(selected.map((r) => r.ref)).size !== selected.length
  ) {
    throw new Error("Source must expose its default branch and at most 100 valid branch/tag refs");
  }
  return selected.sort((a, b) => a.ref.localeCompare(b.ref));
}

async function assertNewCoordinate(
  job: InitialImportJob,
  runtime: InitialImportRuntime
): Promise<void> {
  await runtime.git.assertNew(job);
  const events = await runtime.fetchEvents({
    relays: [job.relay],
    filters: [{ kinds: [30617, 30618], authors: [job.owner], "#d": [job.name] }],
    timeoutMs: 10_000,
    throwOnTimeout: true,
  });
  if (
    events.some(
      (e) =>
        e.pubkey === job.owner &&
        [30617, 30618].includes(e.kind) &&
        e.tags.some((t) => t[0] === "d" && t[1] === job.name)
    )
  ) {
    throw new Error(
      "Repository coordinate already exists. Choose a new name; imports cannot augment existing repositories."
    );
  }
}

export async function prepareInitialImport(
  input: InitialImportInput,
  runtime: InitialImportRuntime,
  signal: AbortSignal
): Promise<InitialImportJob> {
  if (
    !/^[0-9a-f]{64}$/.test(input.owner) ||
    !/^[a-zA-Z0-9][\w.-]{0,63}$/.test(input.name) ||
    input.name.endsWith(".git")
  ) {
    throw new Error(
      "Use a signed-in account and a new repository name (1–64 letters, digits, dots, underscores or hyphens; no .git suffix)"
    );
  }
  runtime.assertActor(input.owner);
  signal.throwIfAborted();
  const source = await (runtime.inspectSource || inspectInitialImportSource)(
    input.sourceUrl,
    signal
  );
  const refs = selectInitialImportRefs(
    await runtime.git.refs(`${source.url}.git`),
    source.defaultBranch
  );
  const id = `initial-import:${crypto.randomUUID()}`;
  const job: InitialImportJob = {
    version: 1,
    id,
    source,
    refs,
    owner: input.owner,
    name: input.name,
    relay: normalizeInitialImportRelay(input.relay),
    issues: input.issues,
    comments: input.issues && input.comments,
    localRepoId: `${input.owner}:initial-${id.slice(15)}`,
    createdAt: Math.floor(Date.now() / 1000),
    publicStarted: false,
    gitStage: "planned",
    status: "pending",
    localCleanup: "pending",
    counts: { issue: 0, status: 0, comment: 0, events: 0, bytes: 0 },
  };
  validateInitialImportJob(job);
  await assertNewCoordinate(job, runtime);
  signal.throwIfAborted();
  runtime.assertActor(job.owner);
  return job;
}

export function initialImportDelay(signal: AbortSignal, ms = 1250): Promise<void> {
  return new Promise((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", stop);
    };
    const stop = () => {
      done();
      reject(new Error("Import stopped"));
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, ms);
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();
  });
}

// A cancelled signer request cannot be recalled. Do not accumulate unresolved signing promises on retries.
const outstandingSignatures = new Set<string>();

/** Caller holds a Web Lock for this job; UI dependencies expose no delete-remote operation. */
export async function runInitialImport(
  jobId: string,
  runtime: InitialImportRuntime,
  signal: AbortSignal,
  token = ""
): Promise<InitialImportJob> {
  let job = await runtime.store.get(jobId);
  if (!job)
    throw new Error("Import recovery was not found. Do not restart into an existing repository.");
  validateInitialImportJob(job);
  if (job.status === "complete" || job.status === "partial") return job;
  const abort = new ImportAbortController();
  const stop = () => {
    abort.abort("Import stopped; already published data is retained");
    if (job?.workerOperation) void runtime.git.cancel(job.workerOperation.id).catch(() => {});
  };
  signal.addEventListener("abort", stop, { once: true });
  if (signal.aborted) stop();
  const active = () => {
    abort.throwIfAborted();
    runtime.assertActor(job!.owner);
  };
  const progress = (step: string) => runtime.onProgress?.(job!, step);
  const save = async (changes: Partial<InitialImportJob>) => {
    const next = { ...job!, ...changes };
    await runtime.store.save(next);
    job = next;
  };
  const exactVisible = async (event: NostrEvent): Promise<boolean> => {
    const events = await abort.raceWithAbort(
      runtime.fetchEvents({
        relays: [job!.relay],
        filters: [{ ids: [event.id] }],
        timeoutMs: 10_000,
        throwOnTimeout: true,
      })
    );
    return events.some((e) => e.id === event.id && e.pubkey === job!.owner && verifyEvent(e));
  };
  const assertAnnouncementUnchanged = async () => {
    const latest = await abort.raceWithAbort(
      runtime.fetchEvents({
        relays: [job!.relay],
        filters: [{ kinds: [30617], authors: [job!.owner], "#d": [job!.name], limit: 10 }],
        timeoutMs: 10_000,
        throwOnTimeout: true,
      })
    );
    active();
    if (
      !job!.announcement ||
      !latest.some((e) => e.id === job!.announcement?.id && verifyEvent(e)) ||
      latest.some(
        (e) => e.id !== job!.announcement?.id && e.created_at >= job!.announcement!.created_at
      )
    ) {
      throw new Error(
        "Repository announcement changed or is unavailable; inspect before resuming initial history"
      );
    }
  };
  const deliverPending = async () => {
    if (!job!.pending) return;
    const pending = job!.pending;
    active();
    // Announcement/state admission always requires a real ACK (purgatory is not readable before push).
    if (!["announcement", "state"].includes(pending.type) && (await exactVisible(pending.event))) {
      job = await runtime.store.confirm(job!);
      return;
    }
    await (runtime.pause || initialImportDelay)(abort.signal);
    active();
    await save({ publicStarted: true });
    progress(`Publishing kind ${pending.event.kind}; public side effects may have started…`);
    active();
    const result = await abort.raceWithAbort(
      Promise.resolve(runtime.publish(pending.event, { relays: [job!.relay] }))
    );
    const ack = extractPublishRelayAck(result);
    if (
      result.event?.id !== pending.event.id ||
      !ack.hasRelayOutcomes ||
      !ack.ackedRelays.some((r) => r.replace(/\/$/, "") === job!.relay.replace(/\/$/, ""))
    ) {
      throw new Error(
        "Required repository relay did not ACK the exact event. Resume will retry that event, not create a duplicate."
      );
    }
    job = await runtime.store.confirm(job!);
  };
  const deliver = async (
    key: string,
    type: InitialImportEventType,
    makeTemplate: () => ImportEventTemplate
  ): Promise<string> => {
    active();
    const receipt = await runtime.store.receipt(job!.id, key);
    if (receipt) return receipt.eventId;
    const template = makeTemplate();
    if (job!.pending) throw new Error("A previous event must settle before preparing another");
    if (
      !["announcement", "state"].includes(type) &&
      job!.counts.events >= INITIAL_IMPORT_LIMITS.events
    ) {
      throw new Error(
        "Initial history reached its 1,000-event limit. Keep the partial import; no data was truncated."
      );
    }
    if (outstandingSignatures.has(job!.owner))
      throw new Error(
        "A previous signer request is still open. Resolve it in your signer before resuming."
      );
    outstandingSignatures.add(job!.owner);
    const owner = job!.owner;
    const plannedId = getEventHash({ ...template, pubkey: owner });
    const signing = Promise.resolve()
      .then(() => {
        active();
        return runtime.sign(template);
      })
      .finally(() => outstandingSignatures.delete(owner));
    const event = await abort.raceWithAbort(signing);
    active();
    if (event.pubkey !== owner || event.id !== plannedId || !verifyEvent(event)) {
      throw new Error("Signer changed the import event or active account");
    }
    const bytes = new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (
      bytes > INITIAL_IMPORT_LIMITS.eventBytes ||
      job!.counts.bytes + bytes > INITIAL_IMPORT_LIMITS.historyBytes
    ) {
      throw new Error("Initial history reached its byte limit. Published data is retained.");
    }
    if (token && JSON.stringify(event).includes(token))
      throw new Error("Credential material cannot be stored in import events");
    await save({ pending: { key, type, event } });
    await deliverPending();
    progress(`Confirmed ${job!.counts.events} history events`);
    return event.id;
  };
  const mutate = async (
    type: "cloneRemoteRepo" | "pushToRemote" | "deleteRepo",
    operation: (id: string) => Promise<void>
  ) => {
    active();
    const id = `${job!.id}:${type}:${crypto.randomUUID()}`;
    await save({ workerOperation: { id, type } });
    progress(`Git operation: ${type}`);
    active();
    await abort.raceWithAbort(operation(id));
    if (!(await runtime.git.settle(job!)))
      throw new Error("Git worker outcome is unknown; inspect recovery before continuing");
    await save({ workerOperation: undefined });
  };
  try {
    active();
    // Revalidate source public access and identity, not its mutable description/counts.
    const source: InitialImportSource = await (runtime.inspectSource || inspectInitialImportSource)(
      job.source.url,
      abort.signal
    );
    if (source.id !== job.source.id) throw new Error("Source repository identity changed");
    if (!job.publicStarted && !job.pending) await assertNewCoordinate(job, runtime);
    if (job.workerOperation && !(await runtime.git.settle(job)))
      throw new Error(
        "Previous Git operation is still active or unknown; no new mutation was started"
      );
    if (job.gitStage === "verified") await assertAnnouncementUnchanged();
    await save({ status: "pending", message: undefined });
    await deliverPending();
    const urls = initialImportUrls(job);
    if (!job.announcement) {
      progress("Admitting repository announcement before Git work…");
      const event = createRepoAnnouncementEvent({
        repoId: job.name,
        name: job.name,
        description: job.source.description,
        clone: urls.cloneUrls,
        web: urls.webUrls,
        relays: [job.relay],
        maintainers: [job.owner],
        created_at: job.createdAt,
      });
      await deliver("announcement", "announcement", () => event);
    }
    if (job.gitStage !== "verified") {
      progress("Waiting for GRASP read/write provisioning…");
      await runtime.git.ready(job, abort.signal);
      active();
      if (job.gitStage === "planned") {
        progress("Cloning the public source into temporary local storage…");
        await save({ gitStage: "cloning" });
        await mutate("cloneRemoteRepo", (id) => runtime.git.clone(job!, id));
      }
      // Never silently reclone an interrupted local mirror. Prove it complete or ask for attention.
      await runtime.git.verifyLocal(job);
      active();
      if (job.gitStage === "cloning") await save({ gitStage: "cloned" });
      if (!job.state) {
        const state = createRepoStateEvent({
          repoId: job.name,
          head: job.source.defaultBranch,
          refs: job.refs.map((r) => ({
            type: r.ref.startsWith("refs/heads/") ? "heads" : "tags",
            name: r.ref.split("/").slice(2).join("/"),
            commit: r.oid,
          })),
          created_at: job.createdAt,
        });
        progress("Admitting the exact repository state before pushing…");
        await deliver("state", "state", () => state);
      }
      const current = await runtime.git.refs(urls.cloneUrls[0]);
      active();
      const remote = new Map(
        current
          .filter((r) => /^refs\/(heads|tags)\//.test(r.ref) && !r.ref.endsWith("^{}"))
          .map((r) => [r.ref, r.oid])
      );
      if ([...remote].some(([ref, oid]) => job!.refs.find((r) => r.ref === ref)?.oid !== oid))
        throw new Error("Destination refs diverged; no overwrite or force-push was attempted");
      const missing = job.refs.filter((r) => !remote.has(r.ref));
      if (missing.length) {
        await save({ gitStage: "pushing" });
        progress(`Pushing ${missing.length} pinned branch/tag refs…`);
        await mutate("pushToRemote", (id) => runtime.git.push(job!, missing, id));
      }
      const verified = new Map(
        (await runtime.git.refs(urls.cloneUrls[0])).map((r) => [r.ref, r.oid])
      );
      if (job.refs.some((r) => verified.get(r.ref) !== r.oid))
        throw new Error(
          "Destination Git refs are not all confirmed; repository retained for inspection"
        );
      if (
        !job.announcement ||
        !job.state ||
        !(await exactVisible(job.announcement)) ||
        !(await exactVisible(job.state))
      ) {
        throw new Error(
          "Git refs arrived but GRASP metadata promotion is not yet confirmed. Resume to verify again."
        );
      }
      await save({ gitStage: "verified" });
      progress("Repository created. Importing optional initial history…");
    }
    // Reject metadata/scope drift on resume; do not publish old history into changed relay scope.
    await assertAnnouncementUnchanged();
    // Git buffers are not needed while the relay-paced history stream runs.
    if (job.localCleanup !== "complete") {
      await mutate("deleteRepo", (id) => runtime.git.cleanup(job!, id));
      await save({ localCleanup: "complete" });
    }
    let observed = 0;
    const countSource = () => {
      if (++observed > INITIAL_IMPORT_LIMITS.sourceItems)
        throw new Error("Source exceeded the 5,000-item browser scan limit");
    };
    const pages = runtime.pages || initialImportPages;
    if (job.issues)
      for await (const items of pages(job.source, "issues", abort.signal, { token })) {
        for (const item of items) {
          active();
          countSource();
          if (item.pull_request || Date.parse(item.created_at) / 1000 > job.createdAt) continue;
          const base = {
            source: job.source,
            item,
            repoAddress: initialImportAddress(job),
            ownerPubkey: job.owner,
            createdAt: job.createdAt,
          };
          const rootId = await deliver(
            initialImportSourceKey(job.source, "issue", item.id),
            "issue",
            () => initialImportTemplate({ ...base, type: "issue" })
          );
          await deliver(initialImportSourceKey(job.source, "status", item.id), "status", () =>
            initialImportTemplate({ ...base, rootId, type: "status" })
          );
          if (job.comments)
            for await (const comments of pages(job.source, "comments", abort.signal, {
              token,
              issueNumber: item.number,
            })) {
              for (const comment of comments) {
                active();
                countSource();
                if (Date.parse(comment.created_at) / 1000 > job.createdAt) continue;
                await deliver(
                  initialImportSourceKey(job.source, "comment", comment.id),
                  "comment",
                  () =>
                    initialImportTemplate({
                      ...base,
                      item: comment,
                      rootId,
                      issueNumber: item.number,
                      type: "comment",
                    })
                );
              }
            }
        }
      }
    active();
    await save({ status: "complete" });
    progress("Repository and selected initial history imported");
  } catch (error) {
    let message = error instanceof Error ? error.message : "Initial import could not finish";
    if (token)
      message = message
        .split(token)
        .join("[redacted]")
        .split(encodeURIComponent(token))
        .join("[redacted]");
    message = message
      .replace(/https?:\/\/[^\s]*[?@][^\s]*/g, "[source URL redacted]")
      .slice(0, 1200);
    // No compensation or remote deletion. One pending event remains for exact retry.
    await save({
      status: signal.aborted ? "stopped" : job.gitStage === "verified" ? "stopped" : "attention",
      message,
    });
    progress(message);
  } finally {
    signal.removeEventListener("abort", stop);
  }
  return job;
}

export async function withInitialImportLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  if (typeof navigator === "undefined" || !navigator.locks)
    throw new Error("This browser needs Web Locks support for safe imports");
  return navigator.locks.request("nostr-git:initial-import", { ifAvailable: true }, (lock) => {
    if (!lock) throw new Error("An initial import is already running in another tab");
    return action();
  });
}
