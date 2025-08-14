import { createRepoAnnouncementEvent as createAnnouncement, createRepoStateEvent as createState } from '@nostr-git/shared-types';

function ensureNoGitSuffix(url) {
  return url?.replace(/\.git$/, '') ?? '';
}

function toHttpFromWs(raw) {
  return (raw || '')
    .replace(/^ws:\/\//, 'http://')
    .replace(/^wss:\/\//, 'https://');
}

function normalizeRelayWsOrigin(u) {
  if (!u) return '';
  try {
    const url = new URL(u);
    const origin = `${url.protocol}//${url.host}`;
    return origin.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
  } catch {
    return u
      .replace(/^http:\/\//, 'ws://')
      .replace(/^https:\/\//, 'wss://')
      .replace(/(ws[s]?:\/\/[^/]+).*/, '$1');
  }
}

function buildRelays(relayUrl) {
  const baseRelay = normalizeRelayWsOrigin(relayUrl || '');
  const aliases = [];
  if (baseRelay) aliases.push(baseRelay);
  const viteAliases = (import.meta?.env?.VITE_GRASP_RELAY_ALIASES);
  if (viteAliases) viteAliases.split(',').map(s => s.trim()).filter(Boolean).forEach(a => aliases.push(a));
  const nodeAliases = (globalThis?.process?.env?.VITE_GRASP_RELAY_ALIASES);
  if (nodeAliases) nodeAliases.split(',').map(s => s.trim()).filter(Boolean).forEach(a => aliases.push(a));
  if (baseRelay) {
    const u = new URL(baseRelay);
    const port = u.port ? `:${u.port}` : '';
    aliases.push(`${u.protocol}//ngit-relay${port}`);
  }
  const seen = new Set();
  return aliases.filter(a => { if (seen.has(a)) return false; seen.add(a); return true; });
}

function verifyGrasp() {
  const config = {
    name: 'alice/example',
    provider: 'grasp',
    relayUrl: 'wss://relay.example.org',
    cloneUrl: 'wss://relay.example.org/git/alice/example.git',
    webUrl: '' ,
    defaultBranch: 'main',
    description: 'Test repo',
    maintainers: ['npub1example...'],
    tags: ['test']
  };
  const localRepo = { initialCommit: 'deadbeef' };

  const cloneUrl = toHttpFromWs(config.cloneUrl);
  const webUrl = ensureNoGitSuffix(config.webUrl || cloneUrl);
  const relays = buildRelays(config.relayUrl);

  const ann = createAnnouncement({
    repoId: config.name,
    name: config.name,
    description: config.description,
    web: webUrl ? [webUrl] : undefined,
    clone: cloneUrl ? [cloneUrl] : undefined,
    relays,
    maintainers: config.maintainers,
    hashtags: config.tags,
    earliestUniqueCommit: localRepo.initialCommit,
  });

  const refs = [{ type: 'heads', name: config.defaultBranch, commit: localRepo.initialCommit }];
  const state = createState({ repoId: config.name, refs, head: config.defaultBranch });

  return { ann, state };
}

function verifyGithub() {
  const config = {
    name: 'alice/example',
    provider: 'github',
    cloneUrl: 'https://github.com/alice/example.git',
    webUrl: 'https://github.com/alice/example',
    defaultBranch: 'main',
    description: 'Test repo',
  };
  const localRepo = { initialCommit: 'cafebabe' };

  const cloneUrl = config.cloneUrl;
  const webUrl = ensureNoGitSuffix(config.webUrl || cloneUrl);

  const ann = createAnnouncement({
    repoId: config.name,
    name: config.name,
    description: config.description,
    web: [webUrl],
    clone: [cloneUrl],
  });

  const refs = [{ type: 'heads', name: config.defaultBranch, commit: localRepo.initialCommit }];
  const state = createState({ repoId: config.name, refs, head: config.defaultBranch });

  return { ann, state };
}

function main() {
  const grasp = verifyGrasp();
  const gh = verifyGithub();
  console.log('=== GRASP Announcement ===');
  console.log(JSON.stringify(grasp.ann, null, 2));
  console.log('=== GRASP State ===');
  console.log(JSON.stringify(grasp.state, null, 2));
  console.log('=== GitHub Announcement ===');
  console.log(JSON.stringify(gh.ann, null, 2));
  console.log('=== GitHub State ===');
  console.log(JSON.stringify(gh.state, null, 2));
}

main();
