import { beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { finalizeEvent, getPublicKey } from "nostr-tools";
import {
  IndexedInitialImportStore,
  type InitialImportJob,
  type InitialImportRef,
} from "./initial-import-store";
import {
  initialImportAddress,
  prepareInitialImport,
  runInitialImport,
  selectInitialImportRefs,
  type InitialImportRuntime,
} from "./initial-import";
import { createInitialImportGit } from "./initial-import-git";
import type { GitHubImportItem, InitialImportSource } from "./initial-import-source";

const secret = new Uint8Array(32).fill(9);
const owner = getPublicKey(secret);
const relay = "wss://grasp.test";
const source: InitialImportSource = {
  url: "https://github.com/alice/project",
  owner: "alice",
  name: "project",
  id: 1,
  description: "A project",
  defaultBranch: "main",
  sizeKiB: 10,
  openIssues: 1,
};
const refs: InitialImportRef[] = [
  { ref: "refs/heads/main", oid: "a".repeat(40) },
  { ref: "refs/tags/v1", oid: "b".repeat(40) },
];
const issue: GitHubImportItem = {
  id: 10,
  number: 1,
  title: "Issue",
  body: "Body",
  user: { login: "alice" },
  state: "open",
  created_at: "2024-01-01T00:00:00Z",
  updated_at: "2024-01-02T00:00:00Z",
};

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));

async function fixture() {
  const store = new IndexedInitialImportStore();
  const events = new Map<string, ReturnType<typeof finalizeEvent>>();
  const order: string[] = [];
  let remoteRefs: InitialImportRef[] = [];
  const runtime: InitialImportRuntime = {
    store,
    inspectSource: vi.fn(async () => source),
    assertActor: vi.fn(),
    pause: async () => {},
    git: {
      refs: vi.fn(async (url) => (url.includes("github.com") ? refs : remoteRefs)),
      assertNew: vi.fn(async () => {}),
      ready: vi.fn(async () => {
        order.push("ready");
      }),
      clone: vi.fn(async () => {
        order.push("clone");
      }),
      verifyLocal: vi.fn(async () => {}),
      push: vi.fn(async () => {
        order.push("push");
        remoteRefs = refs;
      }),
      settle: vi.fn(async () => true),
      cancel: vi.fn(async () => {}),
      cleanup: vi.fn(async () => {
        order.push("cleanup");
      }),
    },
    sign: vi.fn(async (template) => finalizeEvent(template, secret)),
    publish: vi.fn(async (event) => {
      const saved = (await store.get(job.id))!;
      expect(saved.pending?.event.id).toBe(event.id);
      expect(saved.publicStarted).toBe(true);
      order.push(`publish:${event.kind}`);
      events.set(event.id, event);
      return { event, ackedRelays: [relay], failedRelays: [], hasRelayOutcomes: true };
    }),
    fetchEvents: vi.fn(async ({ filters }) => {
      const ids = filters[0].ids;
      if (ids) return [...events.values()].filter((e) => ids.includes(e.id));
      return [...events.values()].filter((e) => filters[0].kinds?.includes(e.kind));
    }),
    pages: async function* (_source, kind) {
      yield kind === "issues"
        ? [issue]
        : [{ ...issue, id: 20, number: undefined, body: "comment" }];
    },
  };
  const job = await prepareInitialImport(
    { sourceUrl: source.url, owner, name: "new-project", relay, issues: true, comments: true },
    runtime,
    new AbortController().signal
  );
  await store.create(job);
  return {
    runtime,
    store,
    job,
    events,
    order,
    setRemote: (next: InitialImportRef[]) => {
      remoteRefs = next;
    },
  };
}

describe("new repository + initial history", () => {
  it("journals before send and enforces announcement -> ready/clone -> state -> push -> history", async () => {
    const { runtime, job, order } = await fixture();
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.status, result.message).toBe("complete");
    expect(result.gitStage).toBe("verified");
    expect(result.counts).toMatchObject({ issue: 1, status: 1, comment: 1, events: 3 });
    expect(result.pending).toBeUndefined();
    expect(order).toEqual([
      "publish:30617",
      "ready",
      "clone",
      "publish:30618",
      "push",
      "cleanup",
      "publish:1621",
      "publish:1630",
      "publish:1111",
    ]);
  });
  it.each([30617, 30618])("does not push when kind %i admission is rejected", async (kind) => {
    const { runtime, job } = await fixture();
    const publish = runtime.publish;
    runtime.publish = async (event, context) =>
      event.kind === kind
        ? { event, ackedRelays: [], failedRelays: [relay] }
        : publish(event, context);
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(runtime.git.push).not.toHaveBeenCalled();
    expect(result.pending?.event.kind).toBe(kind);
    expect(result.publicStarted).toBe(true);
  });
  it("retries the exact unacknowledged event and never repeats Git for unfinished history", async () => {
    const { runtime, job, store } = await fixture();
    const publish = runtime.publish;
    let reject = true;
    runtime.publish = vi.fn(async (event, context) => {
      if (event.kind === 1621 && reject) {
        reject = false;
        throw new Error("connection lost");
      }
      return publish(event, context);
    });
    const partial = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(partial.gitStage).toBe("verified");
    expect(partial.status).toBe("stopped");
    const pendingId = partial.pending!.event.id;
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.status, result.message).toBe("complete");
    expect(await store.receipt(job.id, "github:github.com:1:issue:10")).toMatchObject({
      eventId: pendingId,
    });
    expect(runtime.git.push).toHaveBeenCalledTimes(1);
    expect(runtime.publish).toHaveBeenCalledWith(expect.objectContaining({ id: pendingId }), {
      relays: [relay],
    });
  });
  it("readbacks an accepted event with a lost ACK without signing or publishing a duplicate", async () => {
    const { runtime, job } = await fixture();
    const publish = runtime.publish;
    let lost = true;
    runtime.publish = vi.fn(async (event, context) => {
      const result = await publish(event, context);
      if (lost && event.kind === 1621) {
        lost = false;
        throw new Error("lost ACK");
      }
      return result;
    });
    await runInitialImport(job.id, runtime, new AbortController().signal);
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.status, result.message).toBe("complete");
    expect(vi.mocked(runtime.publish).mock.calls.filter(([e]) => e.kind === 1621)).toHaveLength(1);
  });
  it("stops between events, retaining repo and pending event, without starting the next event", async () => {
    const { runtime, job } = await fixture();
    const controller = new AbortController();
    const publish = runtime.publish;
    runtime.publish = async (event, context) => {
      if (event.kind === 1621) controller.abort();
      return publish(event, context);
    };
    const result = await runInitialImport(job.id, runtime, controller.signal);
    expect(result.gitStage).toBe("verified");
    expect(result.status).toBe("stopped");
    expect(result.counts.comment).toBe(0);
  });
  it("blocks changed actors, storage failures and diverged remote refs", async () => {
    const { runtime, job, store, setRemote } = await fixture();
    runtime.assertActor = () => {
      throw new Error("Account changed");
    };
    await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(runtime.sign).not.toHaveBeenCalled();
    runtime.assertActor = () => {};
    const save = vi.spyOn(store, "save").mockRejectedValue(new Error("disk full"));
    await expect(runInitialImport(job.id, runtime, new AbortController().signal)).rejects.toThrow(
      "disk full"
    );
    expect(runtime.publish).not.toHaveBeenCalled();
    save.mockRestore();
    setRemote([{ ref: "refs/heads/main", oid: "c".repeat(40) }]);
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.message).toContain("diverged");
    expect(runtime.git.push).not.toHaveBeenCalled();
  });
  it("scans bounded pages with compact receipts, not accumulated bodies, across retries", async () => {
    const { runtime, job, store } = await fixture();
    runtime.pages = async function* (_source, kind) {
      if (kind === "comments") return;
      for (let n = 1; n <= 300; n++) yield [{ ...issue, number: n, id: n, body: "x".repeat(1000) }];
    };
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.status, result.message).toBe("complete");
    expect(result.counts.events).toBe(600);
    expect(JSON.stringify(await store.get(job.id)).length).toBeLessThan(12_000);
    expect(await store.receipt(job.id, "github:github.com:1:issue:300")).not.toHaveProperty(
      "event"
    );
    expect(await store.receipt(job.id, "github:github.com:1:issue:300")).not.toHaveProperty("body");
  }, 30_000);
  it("fails closed on job event limits instead of growing the journal", async () => {
    const { runtime, job, store } = await fixture();
    job.counts.events = 1000;
    await store.save(job);
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.gitStage).toBe("verified");
    expect(result.message).toContain("1,000-event");
    expect(result.pending).toBeUndefined();
  });
  it("rechecks the actor after persistence and pins the template before calling a signer", async () => {
    const { runtime, job, store } = await fixture();
    let changed = false;
    const save = store.save.bind(store);
    runtime.assertActor = () => {
      if (changed) throw new Error("Account changed");
    };
    store.save = async (next) => {
      await save(next);
      if (next.publicStarted) changed = true;
    };
    await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(runtime.publish).not.toHaveBeenCalled();
    vi.stubGlobal("indexedDB", new IDBFactory());
    const other = await fixture();
    other.runtime.sign = async (template) => {
      template.content = "Unexpected signer mutation";
      return finalizeEvent(template, secret);
    };
    const result = await runInitialImport(
      other.job.id,
      other.runtime,
      new AbortController().signal
    );
    expect(result.message).toContain("Signer changed");
    expect(other.runtime.publish).not.toHaveBeenCalled();
  });
  it("does not resend pending history into changed scope or an unknown worker session", async () => {
    const { runtime, job, events, store } = await fixture();
    const publish = runtime.publish;
    runtime.publish = async (event, context) => {
      if (event.kind === 1621) throw new Error("offline");
      return publish(event, context);
    };
    const partial = await runInitialImport(job.id, runtime, new AbortController().signal);
    events.clear();
    runtime.publish = vi.fn(publish);
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.message).toContain("announcement changed or is unavailable");
    expect(runtime.publish).not.toHaveBeenCalled();
    await store.save({
      ...partial,
      workerOperation: { id: `${job.id}:pushToRemote:unknown`, type: "pushToRemote" },
    });
    runtime.git.settle = async () => false;
    expect(
      (await runInitialImport(job.id, runtime, new AbortController().signal)).message
    ).toContain("unknown");
    expect(runtime.publish).not.toHaveBeenCalled();
  });
});

describe("bounded job store", () => {
  it("uses the same normalized local directory for clone, refs, push and cleanup", async () => {
    const { job, store } = await fixture();
    const worker = {
      cloneRemoteRepo: vi.fn(),
      deleteRepo: vi.fn(),
      resolveRef: vi.fn(async ({ ref }) => refs.find((r) => r.ref === ref)?.oid),
    };
    const git = createInitialImportGit(worker);
    await git.clone(job, "clone");
    await git.verifyLocal(job);
    await git.cleanup(job, "cleanup");
    expect(worker.cloneRemoteRepo).toHaveBeenCalledWith(
      expect.objectContaining({
        dir: `/repos/${job.localRepoId.replace(":", "/")}`,
        initialImport: true,
      })
    );
    await expect(
      store.save({ ...job, localRepoId: `${owner}:important-user-repo` })
    ).rejects.toThrow("recovery record");
  });
  it("rejects coordinate reuse, changed scope, and credential-bearing recovery relays", async () => {
    const { store, job } = await fixture();
    await expect(
      store.create({ ...job, id: `initial-import:${crypto.randomUUID()}` })
    ).rejects.toThrow();
    await expect(store.save({ ...job, source: { ...job.source, id: 99 } })).rejects.toThrow(
      "changed"
    );
    await expect(store.save({ ...job, relay: `${relay}?token=secret` })).rejects.toThrow(
      "credentials"
    );
    expect(initialImportAddress(job)).toBe(`30617:${owner}:new-project`);
  });
  it("preserves tags and refuses missing default branches or excessive refs", () => {
    expect(selectInitialImportRefs(refs, "main")).toEqual(refs);
    expect(() => selectInitialImportRefs(refs, "absent")).toThrow();
    expect(() =>
      selectInitialImportRefs(
        Array.from({ length: 101 }, (_, i) => ({ ref: `refs/heads/b${i}`, oid: "a".repeat(40) })),
        "b0"
      )
    ).toThrow();
  });
});
