// Dev-only fixture entrypoint. Not imported by the production bundle. Never contacts relays.
import { matchFilter, type Filter } from 'nostr-tools';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { signed, releaseFixture, testRepo, testPubkey } from '../src/lib/test-fixtures.js';
import type { NostrEvent } from 'budabit-sdk';

const iframe = document.querySelector('iframe')!;
const repo = testRepo();
const now = Math.floor(Date.now() / 1000) - 10;
const hash = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
const app = signed({ created_at: now });
const asset = signed({
  kind: 3063,
  created_at: now,
  tags: [
    ['i', 'app'],
    ['version', '1'],
    ['filename', 'fixture.bin'],
    ['m', 'application/octet-stream'],
    ['x', hash],
    ['size', '4'],
    ['f', 'linux-x86_64'],
    ['url', 'https://files.example.invalid/fixture.bin'],
  ],
});
const release = releaseFixture({
  created_at: now,
  content:
    '# Verified release\n\n[Release guide](https://files.example.invalid/guide)\n\n<img src="https://tracker.example.invalid/image" onerror="alert(1)"><script>alert(1)</script><video poster="https://tracker.example.invalid/pixel"></video><audio src="https://tracker.example.invalid/sound" preload="auto"></audio><picture><source srcset="https://tracker.example.invalid/source"></picture><svg><image href="https://tracker.example.invalid/svg" /></svg><iframe src="https://tracker.example.invalid/frame"></iframe><object data="https://tracker.example.invalid/object"></object><link rel="stylesheet" href="https://tracker.example.invalid/style"><style>p { background: url(https://tracker.example.invalid/background) }</style>',
  tags: [
    ...releaseFixture().tags.filter((t) => t[0] !== 'e'),
    ['e', asset.id],
    ['f', 'linux-x86_64'],
  ],
});
const run = signed({
  kind: 5401,
  created_at: now,
  tags: [
    ['a', repo.repoAddress],
    ['publisher', testPubkey(3)],
    ['triggered-by', testPubkey()],
    ['commit', 'a'.repeat(40)],
    ['workflow', 'Build Linux'],
    ['branch', 'master'],
  ],
});
const artifact = signed(
  {
    kind: 1063,
    created_at: now,
    tags: [
      ['e', run.id],
      ['url', 'https://files.example.invalid/fixture.bin'],
      ['filename', 'fixture.bin'],
      ['x', hash],
      ['size', '4'],
      ['m', 'application/octet-stream'],
      ['f', 'linux-x86_64'],
    ],
  },
  3
);
const attacker = releaseFixture(
  {
    created_at: now,
    content: 'ATTACKER RELEASE',
    tags: releaseFixture().tags.map((t) =>
      t[0] === 'd' ? ['d', 'app@666'] : t[0] === 'version' ? ['version', '666'] : t
    ),
  },
  2
);
const data: NostrEvent[] = [app, asset, release, run, artifact, attacker];
const subscriptions = new Map<string, Filter>();
let viewer = repo.userPubkey,
  hasRepo = true,
  partial = false,
  fail = false,
  sequence = 0;
let signatures = 0;
let assetQueries = 0;
let cacheWrites = 0;
let resolveFallback: (() => void) | undefined;
let holdAssets = false;
let failDiscard = false;
const pendingAssets: (() => void)[] = [];
const holdFallback = new URLSearchParams(location.search).has('holdFallback');
const published: string[] = JSON.parse(sessionStorage.getItem('fixture-publish-attempts') || '[]');
// A shared backend for genuinely independent fixture tabs; no personal storage.
const readStorage = () =>
  new Map<string, unknown>(JSON.parse(localStorage.getItem('fixture-journals') || '[]'));
const persistStorage = (storage: Map<string, unknown>) =>
  localStorage.setItem('fixture-journals', JSON.stringify([...storage]));
const revisionOf = (value: unknown) =>
  value == null ? null : bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(value))));
async function storageRequest(
  action: string,
  p: { key: string; data?: unknown; expectedRevision?: unknown }
) {
  return navigator.locks.request('release-fixture-storage', () => {
    const storage = readStorage();
    const data = storage.get(p.key) ?? null;
    if (action === 'storage:get')
      return { status: 'ok', data, revision: revisionOf(data), atomic: true };
    if (action === 'storage:compareAndSet' && p.expectedRevision !== revisionOf(data))
      return { status: 'conflict' };
    if (p.data === null && failDiscard) {
      failDiscard = false;
      return { error: 'Synthetic storage failure' };
    }
    if (p.data === null) storage.delete(p.key);
    else storage.set(p.key, p.data);
    if (p.key === 'verified-releases-v2') cacheWrites++;
    persistStorage(storage);
    return { status: 'ok', revision: revisionOf(p.data) };
  });
}
const push = (action: string, payload: unknown) =>
  iframe.contentWindow?.postMessage({ type: 'event', action, payload }, location.origin);
function context() {
  push(
    'context:update',
    hasRepo ? { repo: { ...repo, userPubkey: viewer }, userPubkey: viewer } : null
  );
}
function metrics() {
  document.querySelector('#metrics')!.textContent =
    `Active subscriptions: ${subscriptions.size}; signatures: ${signatures}; publish attempts: ${published.length}`;
}
window.addEventListener('message', async (event) => {
  if (event.source !== iframe.contentWindow || event.origin !== location.origin) return;
  const message = event.data;
  if (message.action === 'widget:ready') {
    context();
    push('widget:init', {
      repoContext: hasRepo ? { ...repo, userPubkey: viewer } : null,
      pubkey: viewer,
      theme: 'light',
    });
  }
  if (message.type !== 'request') return;
  if (message.action === 'context:getRepo' && holdFallback && !resolveFallback) {
    const payload = { status: 'ok', repoContext: hasRepo ? { ...repo, userPubkey: viewer } : null };
    resolveFallback = () =>
      iframe.contentWindow?.postMessage(
        { type: 'response', id: message.id, action: message.action, payload },
        location.origin
      );
    return;
  }
  const p = message.payload || {};
  let payload: unknown;
  switch (message.action) {
    case 'context:getRepo':
      payload = { status: 'ok', repoContext: hasRepo ? { ...repo, userPubkey: viewer } : null };
      break;
    case 'nostr:query':
      if (p.filter.kinds?.includes(3063)) assetQueries++;
      payload = {
        status: 'ok',
        complete: !partial,
        events: data
          .filter((e) => matchFilter(p.filter, e))
          .sort((a, b) => b.created_at - a.created_at)
          .slice(0, p.filter.limit),
      };
      break;
    case 'nostr:subscribe': {
      const id = `test-sub-${++sequence}`;
      subscriptions.set(id, p.filter);
      payload = { status: 'ok', subscriptionId: id };
      break;
    }
    case 'nostr:unsubscribe':
      subscriptions.delete(p.subscriptionId);
      payload = { status: 'ok' };
      break;
    case 'storage:get':
    case 'storage:set':
    case 'storage:compareAndSet':
      payload = await storageRequest(message.action, p);
      break;
    case 'nostr:sign':
      signatures++;
      payload =
        viewer === repo.repoPubkey
          ? { status: 'ok', event: signed(p) }
          : { error: 'Test account changed' };
      break;
    case 'nostr:publish': {
      published.push(p.event.id);
      sessionStorage.setItem('fixture-publish-attempts', JSON.stringify(published));
      if (fail) {
        fail = false;
        payload = { error: 'Synthetic relay timeout' };
      } else {
        data.push(p.event);
        payload = { status: 'ok', result: { eventId: p.event.id, successCount: 1 } };
      }
      break;
    }
    default:
      payload = { error: `Unsupported fixture action ${message.action}` };
  }
  const reply = () =>
    iframe.contentWindow?.postMessage(
      { type: 'response', action: message.action, id: message.id, payload },
      location.origin
    );
  if (message.action === 'nostr:query' && p.filter.kinds?.includes(3063) && holdAssets)
    pendingAssets.push(reply);
  else reply();
  metrics();
});
document.querySelector('#logout')!.addEventListener('click', () => {
  viewer = '';
  context();
});
document.querySelector('#login')!.addEventListener('click', () => {
  viewer = repo.userPubkey;
  hasRepo = true;
  context();
});
document.querySelector('#clear')!.addEventListener('click', () => {
  hasRepo = false;
  context();
});
document.querySelector('#partial')!.addEventListener('click', () => {
  partial = !partial;
});
document.querySelector('#fail')!.addEventListener('click', () => {
  fail = true;
});
document.querySelector('#replace')!.addEventListener('click', () => {
  const next = signed({ ...release, created_at: now + 1, content: '# Replacement notes' });
  data.push(next);
  for (const [id, filter] of subscriptions)
    if (matchFilter(filter, next))
      push('nostr:subscription:event', { subscriptionId: id, event: next });
});
document.querySelector('#revoke')!.addEventListener('click', () => {
  const next = signed({ ...app, created_at: now + 2, tags: app.tags.filter((t) => t[0] !== 'a') });
  data.push(next);
  for (const [id, filter] of subscriptions)
    if (matchFilter(filter, next))
      push('nostr:subscription:event', { subscriptionId: id, event: next });
});
Object.assign(window, {
  releaseHarness: {
    get assetQueries() {
      return assetQueries;
    },
    get cacheWrites() {
      return cacheWrites;
    },
    addUnrelated(kind: 'release' | 'application') {
      const next =
        kind === 'release'
          ? signed({
              ...release,
              created_at: now + 1,
              content: 'Unrelated release',
              tags: release.tags.map((t) =>
                t[0] === 'd'
                  ? ['d', 'app@unrelated']
                  : t[0] === 'version'
                    ? ['version', 'unrelated']
                    : t
              ),
            })
          : signed({
              ...app,
              created_at: now + 1,
              tags: app.tags.map((t) =>
                t[0] === 'd'
                  ? ['d', 'unrelated-app']
                  : t[0] === 'name'
                    ? ['name', 'Unrelated application']
                    : t
              ),
            });
      data.push(next);
      for (const [id, filter] of subscriptions)
        if (matchFilter(filter, next))
          push('nostr:subscription:event', { subscriptionId: id, event: next });
    },
    async corruptJournal() {
      await storageRequest('storage:set', {
        key: `release-publication-v1:${repo.userPubkey}`,
        data: { schema: 'corrupt' },
      });
    },
    get hasJournal() {
      return !!readStorage().get(`release-publication-v1:${repo.userPubkey}`);
    },
    get journal() {
      return readStorage().get(`release-publication-v1:${repo.userPubkey}`) ?? null;
    },
    failDiscard() {
      failDiscard = true;
    },
    holdAssets() {
      holdAssets = true;
    },
    get pendingAssets() {
      return pendingAssets.length;
    },
    resolveAssets() {
      holdAssets = false;
      pendingAssets.splice(0).forEach((reply) => reply());
    },
    get fallbackPending() {
      return !!resolveFallback;
    },
    resolveFallback() {
      resolveFallback?.();
    },
    get activeSubscriptions() {
      return subscriptions.size;
    },
    get signatures() {
      return signatures;
    },
    published,
  },
});
iframe.src = '/';
iframe.addEventListener('load', () => {
  context();
  metrics();
});
