import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import type { EventTemplate } from 'nostr-tools';
import { record } from './context.js';
import {
  discardJournal,
  loadJournal,
  preparePublication,
  publishJournal,
  JournalRecoveryError,
  type ReleaseDraft,
} from './publication.js';
import { signed, testPubkey, testRepo } from './test-fixtures.js';

const draft = (version: string): ReleaseDraft => ({
  appId: 'app',
  appPubkey: testPubkey(),
  newApplication: false,
  version,
  channel: 'main',
  releaseNotes: version,
  artifacts: [
    {
      eventId: 'artifact',
      pipelineRunId: 'run',
      filename: 'file',
      url: 'https://files.example/file',
      sha256: 'a'.repeat(64),
      mimeType: 'application/octet-stream',
    },
  ],
});

// Independent clients, one atomic simulated host backend. No account or relay I/O.
function sharedHost() {
  let raw: string | null = null;
  const revision = () => (raw === null ? null : createHash('sha256').update(raw).digest('hex'));
  function client() {
    const published: string[] = [];
    let failRelease = false;
    const bridge = {
      request: async (action: string, input: unknown) => {
        const p = record(input);
        if (action === 'context:getRepo') return { status: 'ok', repoContext: testRepo() };
        if (action === 'nostr:query') return { status: 'ok', complete: true, events: [signed()] };
        if (action === 'nostr:sign')
          return { status: 'ok', event: signed(p as unknown as EventTemplate) };
        if (action === 'storage:get')
          return {
            status: 'ok',
            data: raw === null ? null : JSON.parse(raw),
            revision: revision(),
            atomic: true,
          };
        if (action === 'storage:compareAndSet' && p.expectedRevision !== revision())
          return { status: 'conflict' };
        if (action === 'storage:set' || action === 'storage:compareAndSet') {
          raw = p.data == null ? null : JSON.stringify(p.data);
          return { status: 'ok', revision: revision() };
        }
        if (action === 'nostr:publish') {
          const event = p.event as NostrEvent;
          published.push(event.id);
          if (failRelease && event.kind === 30063) throw new Error('lost release acknowledgement');
          return { status: 'ok', result: { eventId: event.id, successCount: 1 } };
        }
        throw new Error(action);
      },
    } as unknown as WidgetBridge;
    return {
      bridge,
      published,
      failRelease: () => {
        failRelease = true;
      },
    };
  }
  return {
    client,
    revision,
    raw: () => raw,
    corrupt: (data: unknown) => {
      raw = JSON.stringify(data);
    },
  };
}

function holdRequest(
  bridge: WidgetBridge,
  match: (action: string, p: Record<string, unknown>) => boolean,
  after = false
) {
  let ready!: () => void,
    resume!: () => void,
    used = false;
  const entered = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const wrapper = {
    request: async (action: string, input: unknown) => {
      if (used || !match(action, record(input))) return bridge.request(action, input);
      used = true;
      const result = after ? await bridge.request(action, input) : undefined;
      ready();
      await gate;
      return after ? result : bridge.request(action, input);
    },
  } as unknown as WidgetBridge;
  return { bridge: wrapper, entered, resume };
}

describe('publication recovery across widget sessions', () => {
  it('allows only one overlapping preparation to claim the empty slot', async () => {
    const host = sharedHost(),
      a = host.client(),
      b = host.client();
    expect(await loadJournal(a.bridge, testRepo())).toBeNull();
    expect(await loadJournal(b.bridge, testRepo())).toBeNull();
    const results = await Promise.allSettled([
      preparePublication(a.bridge, testRepo(), draft('A')),
      preparePublication(b.bridge, testRepo(), draft('B')),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { message: expect.stringMatching(/another session/i) },
    });
    expect(a.published.concat(b.published)).toEqual([]);
  });

  it('preserves a partially published new batch when a stale client completes the previous batch', async () => {
    const host = sharedHost(),
      a = host.client(),
      b = host.client();
    const stale = await preparePublication(a.bridge, testRepo(), draft('A'));
    await publishJournal(b.bridge, testRepo(), (await loadJournal(b.bridge, testRepo()))!);
    const next = await preparePublication(b.bridge, testRepo(), draft('B'));
    b.failRelease();
    await expect(publishJournal(b.bridge, testRepo(), next)).rejects.toThrow(
      'lost release acknowledgement'
    );
    const stored = host.raw();
    await expect(publishJournal(a.bridge, testRepo(), stale)).rejects.toThrow(/another session/i);
    expect(host.raw()).toBe(stored);
    expect((await loadJournal(host.client().bridge, testRepo()))?.events.map((e) => e.id)).toEqual(
      next.events.map((e) => e.id)
    );
    expect(a.published).toEqual([]);
  });

  it('does not let a stale discard confirmation remove a later batch', async () => {
    const host = sharedHost(),
      a = host.client(),
      b = host.client();
    const old = await preparePublication(a.bridge, testRepo(), draft('A'));
    const expected = host.revision();
    await publishJournal(b.bridge, testRepo(), (await loadJournal(b.bridge, testRepo()))!);
    const next = await preparePublication(b.bridge, testRepo(), draft('B'));
    const stored = host.raw();
    await expect(discardJournal(a.bridge, testRepo(), expected!)).rejects.toThrow(
      /another session/i
    );
    expect(host.raw()).toBe(stored);
    expect((await loadJournal(b.bridge, testRepo()))?.events).toEqual(next.events);
    expect(next.events.at(-1)?.id).not.toBe(old.events.at(-1)?.id);
  });

  it.each(['progress', 'cleanup'])(
    'protects a new partial batch from delayed old %s',
    async (phase) => {
      const host = sharedHost(),
        a = host.client(),
        b = host.client();
      const old = await preparePublication(a.bridge, testRepo(), draft('A'));
      const held = holdRequest(
        a.bridge,
        (action, p) =>
          phase === 'progress'
            ? action === 'nostr:publish'
            : action === 'storage:compareAndSet' && p.data === null,
        phase === 'progress'
      );
      const result = publishJournal(held.bridge, testRepo(), old).then(
        () => null,
        (error) => error
      );
      await held.entered;
      const active = (await loadJournal(b.bridge, testRepo()))!;
      await discardJournal(b.bridge, testRepo(), active.revision!);
      const next = await preparePublication(b.bridge, testRepo(), draft('B'));
      b.failRelease();
      await expect(publishJournal(b.bridge, testRepo(), next)).rejects.toThrow(
        'lost release acknowledgement'
      );
      const stored = host.raw();
      held.resume();
      expect(await result).toMatchObject({ message: expect.stringMatching(/another session/i) });
      expect(host.raw()).toBe(stored);
      expect(
        (await loadJournal(host.client().bridge, testRepo()))?.events.map((e) => e.id)
      ).toEqual(next.events.map((e) => e.id));
    }
  );

  it('pins invalid recovery data for discard instead of deleting a newly valid batch', async () => {
    const host = sharedHost(),
      a = host.client(),
      b = host.client();
    host.corrupt({ schema: 'invalid' });
    const failure = await loadJournal(a.bridge, testRepo()).catch((error) => error);
    expect(failure).toBeInstanceOf(JournalRecoveryError);
    await discardJournal(b.bridge, testRepo(), host.revision()!);
    const next = await preparePublication(b.bridge, testRepo(), draft('B'));
    await expect(discardJournal(a.bridge, testRepo(), failure.revision)).rejects.toThrow(
      /another session/i
    );
    expect((await loadJournal(a.bridge, testRepo()))?.batchId).toBe(next.batchId);
  });

  it('keeps repeated same-batch retries idempotent and gives a new preparation a distinct identity', async () => {
    const host = sharedHost(),
      a = host.client(),
      b = host.client();
    const initial = await preparePublication(a.bridge, testRepo(), draft('same'));
    const copy = (await loadJournal(b.bridge, testRepo()))!;
    const results = await Promise.allSettled([
      publishJournal(a.bridge, testRepo(), initial),
      publishJournal(b.bridge, testRepo(), copy),
    ]);
    expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
    expect(new Set([...a.published, ...b.published])).toEqual(
      new Set(initial.events.map((e) => e.id))
    );
    expect(await loadJournal(a.bridge, testRepo())).toBeNull();
    const next = await preparePublication(a.bridge, testRepo(), draft('same'));
    expect(next.batchId).not.toBe(initial.batchId);
    expect(JSON.parse(host.raw()!)).not.toHaveProperty('revision');
  });
});
