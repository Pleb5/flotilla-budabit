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
  it("uses shared destination naming rules while retaining the separate source constraints", async () => {
    const { runtime, store } = await fixture();
    const name = `project-${"a".repeat(85)}`;
    const prepared = await prepareInitialImport(
      {
        sourceUrl: source.url,
        owner,
        name,
        displayName: "名前",
        relay,
        issues: false,
        comments: false,
      },
      runtime,
      new AbortController().signal
    );
    expect(prepared.name).toBe(name);
    expect(prepared.displayName).toBe("名前");
    expect(prepared.upstream).toBe(`${source.url}.git`);
    await store.create(prepared);
    expect((await store.get(prepared.id))?.name).toBe(name);
    await expect(
      prepareInitialImport(
        { sourceUrl: source.url, owner, name: "bad..path", relay, issues: false, comments: false },
        runtime,
        new AbortController().signal
      )
    ).rejects.toThrow(/identifier/);
    await store.close();
  });
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
  it("holds the run until an in-flight relay send settles after Stop", async () => {
    const { runtime, job } = await fixture();
    const controller = new AbortController();
    let release!: () => void;
    let entered!: () => void;
    const sending = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    runtime.publish = async (event) => {
      entered();
      await gate;
      return { event, ackedRelays: [relay], hasRelayOutcomes: true };
    };
    let settled = false;
    const run = runInitialImport(job.id, runtime, controller.signal).then((result) => {
      settled = true;
      return result;
    });
    await sending;
    controller.abort();
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    const result = await run;
    expect(result.status).toBe("stopped");
    expect(result.announcement).toBeDefined();
    expect(runtime.git.clone).not.toHaveBeenCalled();
  });
  it("clears a settled clone receipt on Resume without repeating the clone", async () => {
    const { runtime, job } = await fixture();
    const controller = new AbortController();
    runtime.git.clone = vi.fn(async () => {
      controller.abort();
    });
    const stopped = await runInitialImport(job.id, runtime, controller.signal);
    expect(stopped.workerOperation?.type).toBe("cloneRemoteRepo");
    expect(stopped.gitStage).toBe("cloning");
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.status, result.message).toBe("complete");
    expect(result.workerOperation).toBeUndefined();
    expect(runtime.git.clone).toHaveBeenCalledOnce();
  });
  it("does not authorize a push after a failed clone even if local refs still exist", async () => {
    const { runtime, job, store } = await fixture();
    runtime.git.clone = async () => {
      throw new Error("clone interrupted");
    };
    await runInitialImport(job.id, runtime, new AbortController().signal);
    const saved = (await store.get(job.id))!;
    runtime.git.settle = createInitialImportGit({
      getOperationStatus: async () => ({
        operationId: saved.workerOperation!.id,
        operation: "cloneRemoteRepo",
        state: "failed",
        stage: "Failed",
      }),
    }).settle;
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.message).toContain("Local refs alone cannot prove complete Git history");
    expect(runtime.git.verifyLocal).not.toHaveBeenCalled();
    expect(runtime.git.push).not.toHaveBeenCalled();
    expect(result.state).toBeUndefined();
  });
  it("rejects unexpected refs introduced while the push was running", async () => {
    const { runtime, job, setRemote } = await fixture();
    runtime.git.push = async () => {
      setRemote([...refs, { ref: "refs/heads/unapproved", oid: "f".repeat(40) }]);
    };
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.gitStage).toBe("pushing");
    expect(result.counts.events).toBe(0);
    expect(result.message).toContain("not all confirmed");
  });
  it("fails closed on job event limits instead of growing the journal", async () => {
    const { runtime, job, store } = await fixture();
    const ready = await runInitialImport(job.id, runtime, new AbortController().signal);
    await store.save({
      ...ready,
      status: "stopped",
      counts: { ...ready.counts, issue: 998, events: 1000 },
    });
    runtime.pages = async function* () {
      yield [{ ...issue, id: 99 }];
    };
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
  it("reopens exact pending delivery from a new store instance and rejects missing explicit ACKs", async () => {
    const { runtime, job, store } = await fixture();
    const publish = runtime.publish;
    runtime.publish = async (event) => ({ event });
    const stopped = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(stopped.pending?.event.kind).toBe(30617);
    expect(runtime.git.clone).not.toHaveBeenCalled();
    const pendingId = stopped.pending!.event.id;
    runtime.store = new IndexedInitialImportStore();
    runtime.publish = publish;
    expect((await runInitialImport(job.id, runtime, new AbortController().signal)).status).toBe(
      "complete"
    );
    expect((await store.get(job.id))?.announcement?.id).toBe(pendingId);
  });
  it("does not overwrite another announcement while retrying an unacknowledged one", async () => {
    const { runtime, job, events } = await fixture();
    runtime.publish = async (event) => ({ event });
    await runInitialImport(job.id, runtime, new AbortController().signal);
    const other = finalizeEvent(
      {
        kind: 30617,
        created_at: job.createdAt + 1,
        tags: [["d", job.name]],
        content: "Changed by another action",
      },
      secret
    );
    events.set(other.id, other);
    runtime.publish = vi.fn();
    const stopped = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(stopped.message).toContain("Destination metadata changed");
    expect(runtime.publish).not.toHaveBeenCalled();
  });
  it("rechecks coordinate metadata before resuming Git with an already admitted state", async () => {
    const { runtime, job, events } = await fixture();
    runtime.git.push = vi.fn(async () => {
      throw new Error("push interrupted");
    });
    const interrupted = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(interrupted.state).toBeDefined();
    const changed = finalizeEvent(
      {
        kind: 30617,
        created_at: job.createdAt + 1,
        tags: [["d", job.name]],
        content: "Other owner action",
      },
      secret
    );
    events.set(changed.id, changed);
    vi.mocked(runtime.git.push).mockClear();
    const result = await runInitialImport(job.id, runtime, new AbortController().signal);
    expect(result.message).toContain("Destination metadata changed");
    expect(runtime.git.push).not.toHaveBeenCalled();
  });
  it("rejects a modified signed event even if its verification result was cached", async () => {
    const { runtime, job } = await fixture();
    runtime.sign = async (template) => {
      const event = finalizeEvent(template, secret);
      event.content = "Modified after signing";
      return event;
    };
    expect(
      (await runInitialImport(job.id, runtime, new AbortController().signal)).message
    ).toContain("Signer changed");
    expect(runtime.publish).not.toHaveBeenCalled();
  });
});

describe("bounded job store", () => {
  it("requires an explicit cleanup result and a matching worker receipt", async () => {
    const { job } = await fixture();
    const worker = {
      deleteRepo: vi.fn(async () => undefined),
      getOperationStatus: async () => ({
        operationId: "another-operation",
        operation: "pushToRemote",
        state: "completed",
        stage: "Done",
      }),
    };
    const git = createInitialImportGit(worker);
    await expect(git.cleanup(job, "cleanup")).rejects.toThrow("cleanup is pending");
    expect(
      await git.settle({
        ...job,
        workerOperation: { id: `${job.id}:pushToRemote:test`, type: "pushToRemote" },
      })
    ).toBe(false);
  });
  it("uses the same normalized local directory for clone, refs, push and cleanup", async () => {
    const { job, store } = await fixture();
    const worker = {
      cloneRemoteRepo: vi.fn(),
      deleteRepo: vi.fn(async () => ({ success: true })),
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
    for (const ref of [
      "refs/heads/.private",
      "refs/heads/a.lock",
      "refs/heads/a//b",
      "refs/heads/a b",
      "refs/heads/a..b",
      "refs/heads/a@{1}",
      "refs/heads/a\\b",
    ]) {
      expect(() =>
        selectInitialImportRefs([...refs, { ref, oid: "a".repeat(40) }], "main")
      ).toThrow();
    }
  });
});
