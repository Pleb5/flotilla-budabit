import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {WidgetBridge} from 'budabit-sdk';
import {buildScriptArgs} from './blossom';
import {submitRunController} from './controllers';
import {submitRerun} from './nip07';
import type {RerunDraft} from './types';

vi.mock('./blossom', () => ({buildScriptArgs: vi.fn()}));
vi.mock('./workflows', () => ({loadWorkflowRunDetail: vi.fn()}));
vi.mock('./worker-routing', () => ({
  resolveWorkerDeliveryRelays: vi.fn(async (_worker, relays) => ['wss://worker-inbox.example', ...relays]),
}));

const user = 'a'.repeat(64);
const worker = 'b'.repeat(64);
const runId = 'c'.repeat(64);
const relays = ['wss://repo.example', 'wss://relay.budabit.club'];
const publicationRelays = [relays, ['wss://worker-inbox.example', ...relays]];
const repoAddress = `30617:${user}:repo`;

// Like a Svelte $state draft, reading/spreading the outer object leaves nested
// arrays proxied. Real postMessage rejects even an otherwise ordinary array Proxy.
function reactiveDraft(): RerunDraft {
  return new Proxy({
    repoAddress, workflowPath: '.github/workflows/test.yml', branch: 'dev', commit: '1234',
    workerPubkey: worker, command: 'bash', args: new Proxy(['-c', 'echo test'], {}),
    envVars: new Proxy([{key: 'PUBLIC_ENV', value: 'original'}], {}),
    repoNostrUrl: 'nostr://fixture/repo', publishRelays: new Proxy([...relays], {}),
  }, {});
}

function bridgeHarness() {
  const published: Array<{event: {kind: number; tags: string[][]}; relays: string[]}> = [];
  const target = {
    postMessage(message: any) {
      // Enforce the browser boundary rather than a vi.fn() that silently accepts proxies.
      const wire = structuredClone(message);
      let payload: unknown;
      if (wire.action === 'nostr:publish') {
        published.push(wire.payload);
        payload = {status: 'ok', result: {eventId: wire.payload.event.kind === 5401 ? runId : 'd'.repeat(64)}};
      } else if (wire.action === 'nostr:nip44Encrypt') {
        payload = {ciphertext: `encrypted-for-${wire.payload.recipientPubkey}`};
      } else throw new Error(`Unexpected bridge action: ${wire.action}`);
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', {
        source: target as unknown as Window,
        origin: window.location.origin,
        data: {type: 'response', action: wire.action, id: wire.id, payload},
      })));
    },
  };
  const bridge = new WidgetBridge({targetWindow: target as unknown as Window, timeoutMs: 500});
  return {bridge, published};
}

const bridges: WidgetBridge[] = [];
beforeEach(() => {vi.mocked(buildScriptArgs).mockReset().mockResolvedValue(['-c', 'download-and-run']);});
afterEach(() => {for (const bridge of bridges.splice(0)) bridge.destroy();});

describe('workflow submission across the structured-clone boundary', () => {
  it('also serializes relay arrays at the direct publication boundary', async () => {
    const {bridge, published} = bridgeHarness(); bridges.push(bridge);
    await expect(submitRerun(bridge, user, reactiveDraft(), '', [])).resolves.toBe(runId);
    expect(published.map(p => p.relays)).toEqual(publicationRelays);
  });

  it.each([
    ['new', true], ['new', false], ['rerun', true], ['rerun', false],
  ] as const)('publishes a %s run (paid=%s) from a reactive form', async (submissionMode, requiresPayment) => {
    const {bridge, published} = bridgeHarness(); bridges.push(bridge);
    const draft = reactiveDraft();
    expect(() => structuredClone(draft.publishRelays)).toThrow();
    await expect(submitRunController({
      bridge, signerPubkey: user, submissionMode, rerunCommandMode: 'reuse',
      rerunDraft: draft, rerunArgsText: '-c\necho test', rerunPaymentToken: 'fixture-payment',
      requiresPayment, runnerScriptTemplate: '#!/bin/sh\necho test',
      rerunSecrets: new Proxy([{key: 'SECRET_ENV', value: 'fixture-secret'}], {}),
    })).resolves.toBe(runId);
    expect(published.map(({event}) => event.kind)).toEqual([5401, 5100]);
    expect(published.map(({relays: actual}) => actual)).toEqual(publicationRelays);
    const job = published[1]!.event;
    expect(job.tags).toContainEqual(['p', worker]);
    expect(job.tags).toContainEqual(['e', runId]);
    expect(job.tags.filter(t => t[0] === 'payment')).toEqual(requiresPayment ? [['payment', 'fixture-payment']] : []);
    expect(job.tags).toContainEqual(['env', 'PUBLIC_ENV', 'original']);
    expect(job.tags).toContainEqual(['secret', 'SECRET_ENV', `encrypted-for-${worker}`]);
    expect(JSON.stringify(job)).not.toContain('fixture-secret');
  });

  it('freezes relay and secret inputs before waiting for the script upload', async () => {
    let finishUpload!: (args: string[]) => void;
    vi.mocked(buildScriptArgs).mockReturnValue(new Promise(resolve => {finishUpload = resolve;}));
    const {bridge, published} = bridgeHarness(); bridges.push(bridge);
    const draft = reactiveDraft();
    const secrets = new Proxy([{key: 'SECRET_ENV', value: 'original'}], {});
    const pending = submitRunController({
      bridge, signerPubkey: user, submissionMode: 'new', rerunCommandMode: 'regenerate',
      rerunDraft: draft, rerunArgsText: '', rerunPaymentToken: '', requiresPayment: false,
      runnerScriptTemplate: 'echo test', rerunSecrets: secrets,
    });
    draft.publishRelays.push('wss://later.example');
    draft.envVars[0]!.value = 'changed';
    secrets[0]!.key = 'LATER_SECRET';
    finishUpload(['-c', 'download-and-run']);
    await pending;
    expect(published.map(p => p.relays)).toEqual(publicationRelays);
    expect(published[1]!.event.tags).toContainEqual(['env', 'PUBLIC_ENV', 'original']);
    expect(published[1]!.event.tags).toContainEqual(['secret', 'SECRET_ENV', `encrypted-for-${worker}`]);
    expect(published[1]!.event.tags.some(t => t[1] === 'LATER_SECRET')).toBe(false);
  });
});
