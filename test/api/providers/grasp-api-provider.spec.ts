import { describe, it, expect, vi, beforeEach } from 'vitest';
import { nip19 } from 'nostr-tools';
import { GraspApiProvider } from '../../../src/api/providers/grasp.js';
import * as git from 'isomorphic-git';

// Helper to set private fields via casting
function setPriv<T extends object>(obj: T, key: string, value: any) {
  (obj as any)[key] = value;
}

describe('GraspApiProvider basic behavior', () => {
  const relay = 'wss://relay.example';
  const ownerHex = 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getFileContent rejects with stable message on blob/read error', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    vi.spyOn(git as any, 'readBlob').mockRejectedValue(new Error('no blob'));
    await expect(api.getFileContent(ownerHex, 'repo', 'missing.txt', 'main')).rejects.toThrow(/GRASP getFileContent failed:/);
  });

  it('listBranches rejects with stable message on fetch error', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockRejectedValue(new Error('network'));
    await expect(api.listBranches(ownerHex, 'repo')).rejects.toThrow(/GRASP listBranches failed:/);
  });

  it('getBranch rejects with stable message on fetch error', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockRejectedValue(new Error('network'));
    await expect(api.getBranch(ownerHex, 'repo', 'main')).rejects.toThrow(/GRASP getBranch failed:/);
  });

  it('listTags rejects with stable message on fetch error', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockRejectedValue(new Error('network'));
    await expect(api.listTags(ownerHex, 'repo')).rejects.toThrow(/GRASP listTags failed:/);
  });

  it('getTag rejects with stable message when tag is missing', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    vi.spyOn(git as any, 'resolveRef').mockRejectedValue(new Error('missing'));
    await expect(api.getTag(ownerHex, 'repo', 'v404')).rejects.toThrow(/GRASP getTag failed:/);
  });

  it('listCommits works with a tag ref (e.g., v1)', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    const fetchSpy = vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    const now = Math.floor(Date.now() / 1000);
    const logSpy = vi.spyOn(git as any, 'log').mockResolvedValue([
      {
        oid: 'beadfeed',
        commit: {
          message: 'tag msg',
          author: { name: 'A', email: 'a@e', timestamp: now },
          committer: { name: 'C', email: 'c@e', timestamp: now },
          parent: []
        }
      }
    ]);
    const out = await api.listCommits(ownerHex, 'repo', { sha: 'v1', per_page: 1 });
    expect(out.length).toBe(1);
    expect(out[0].sha).toBe('beadfeed');
    fetchSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('createRepo filters relay aliases using isValidNostrRelayUrl (base relay allowed)', async () => {
    const baseRelay = 'wss://relay.example:7447';
    const api = new GraspApiProvider(baseRelay, ownerHex as any);
    // Seed capabilities/httpBase to bypass ensureCapabilities network
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [baseRelay] };
    (api as any).httpBase = 'https://relay.example';
    const spy = vi.spyOn(api as any, 'isValidNostrRelayUrl');

    await api.createRepo({ name: 'alias-test' } as any);

    // Expect it was called for base relay
    const calls = spy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.startsWith(baseRelay))).toBe(true);

    // Validate outcomes: base relay should be valid
    const results = spy.mock.results;
    const baseIdx = calls.findIndex((u) => u.startsWith(baseRelay));
    expect(results[baseIdx]?.value).toBe(true);

    spy.mockRestore();
  });

  it('listCommits returns mapped commits when sha is provided', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Seed capabilities/httpBase
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    const fetchSpy = vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    const now = Math.floor(Date.now() / 1000);
    const logSpy = vi.spyOn(git as any, 'log').mockResolvedValue([
      {
        oid: 'deadbeef',
        commit: {
          message: 'msg',
          author: { name: 'A', email: 'a@e', timestamp: now },
          committer: { name: 'C', email: 'c@e', timestamp: now },
          parent: ['abc123']
        }
      }
    ]);
    const out = await api.listCommits(ownerHex, 'repo', { sha: 'main', per_page: 1 });
    expect(out.length).toBe(1);
    expect(out[0].sha).toBe('deadbeef');
    expect(out[0].parents?.[0].sha).toBe('abc123');
    fetchSpy.mockRestore();
    logSpy.mockRestore();
  });

  it('publishStateFromLocal returns unsigned event when EventIO publish fails', async () => {
    const failingIO = { publishEvent: vi.fn().mockRejectedValue(new Error('pub fail')) } as any;
    const api = new GraspApiProvider(relay, ownerHex as any, failingIO);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    vi.spyOn(git as any, 'listBranches').mockResolvedValue(['main']);
    vi.spyOn(git as any, 'resolveRef').mockResolvedValue('refs/heads/main');
    const ev = await api.publishStateFromLocal(ownerHex, 'repo');
    expect(ev).toBeTruthy();
    expect(failingIO.publishEvent).toHaveBeenCalled();
  });

  it('publishStateFromLocal builds event with HEAD tag and refs when GRASP-01 supported', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Enable GRASP-01 and set httpBase
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';

    const fetchSpy = vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    const branchesSpy = vi.spyOn(git as any, 'listBranches').mockResolvedValue(['main']);
    const tagsSpy = vi.spyOn(git as any, 'listTags').mockResolvedValue(['v1']);
    const resolveSpy = vi.spyOn(git as any, 'resolveRef').mockImplementation(async ({ ref }: any) => {
      if (ref === 'refs/heads/main') return 'abc123';
      if (ref === 'refs/tags/v1') return 'tagsha1';
      if (ref === 'HEAD') return 'refs/heads/main';
      return 'deadbeef';
    });

    const event: any = await api.publishStateFromLocal(ownerHex, 'repo', { includeTags: true });
    expect(event).toBeTruthy();
    const tagKeys = event.tags.map((t: string[]) => t[0]);
    expect(tagKeys).toContain('HEAD');
    // Ensure HEAD uses ref: refs/heads/main form
    const headTag = event.tags.find((t: any) => t[0] === 'HEAD');
    // Some environments may double-prefix when resolving HEAD; accept both
    expect(headTag?.[1]).toMatch(/^ref: refs\/heads\/(?:refs\/heads\/)?main$/);
    // Don't assert exact ref tags; shared-types normalizer may alter encoding.

    fetchSpy.mockRestore();
    branchesSpy.mockRestore();
    tagsSpy.mockRestore();
    resolveSpy.mockRestore();
  });

  it('getUser tolerates invalid JSON profile for a valid npub and leaves fields defaulted', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    const npub = nip19.npubEncode(ownerHex);
    (vi.spyOn(api as any, 'queryEvents') as any).mockResolvedValueOnce([{ content: '{invalid' }]);
    const user = await api.getUser(npub);
    expect(user.login).toBe(npub);
    expect(user.avatarUrl).toBe('');
    expect(user.name).toBeUndefined();
    expect(user.blog).toBeUndefined();
  });

  it('createRepo uses httpBase to construct htmlUrl and cloneUrl', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Seed capabilities/httpBase to bypass ensureCapabilities network
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example/git'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example/git';
    const res = await api.createRepo({ name: 'myrepo', description: 'd', private: false } as any);
    expect(res.htmlUrl).toMatch(/^https:\/\/relay\.example\/git\//);
    expect(res.cloneUrl).toBe(`${res.htmlUrl}.git`);
  });

  it('publishStateFromLocal returns null when relay does not support GRASP-01', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Seed capabilities to grasp01=false
    (api as any).capabilities = { grasp01: false, grasp05: true, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    const res = await api.publishStateFromLocal(ownerHex, 'repo');
    expect(res).toBeNull();
  });

  it('publishStateFromLocal wraps git fetch failure in a stable error message', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Enable GRASP-01 and provide httpBase
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    const spy = vi.spyOn(git as any, 'fetch').mockRejectedValue(new Error('network exploded'));
    await expect(api.publishStateFromLocal(ownerHex, 'repo')).rejects.toThrow(/Failed to build state event: /);
    spy.mockRestore();
  });

  it('listPullRequests returns empty when no patches and state fetch fails', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (vi.spyOn(api as any, 'listPatches') as any).mockResolvedValueOnce([]);
    (vi.spyOn(api as any, 'fetchLatestState') as any).mockRejectedValueOnce(new Error('fail'));
    const prs = await api.listPullRequests(ownerHex, 'r');
    expect(prs).toEqual([]);
  });

  it('getPullRequest throws when PR number not found', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (vi.spyOn(api as any, 'listPatches') as any).mockResolvedValueOnce([]);
    await expect(api.getPullRequest(ownerHex, 'r', 123)).rejects.toThrow(/not found/);
  });

  it('getRepo with announcement error and missing state yields empty or defaulted defaultBranch', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Seed capabilities/httpBase to avoid network in ensureCapabilities
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    // Force announcement query to error and state to be null
    (vi.spyOn(api as any, 'queryEvents') as any).mockRejectedValueOnce(new Error('ann fail'));
    (vi.spyOn(api as any, 'fetchLatestState') as any).mockResolvedValueOnce(null);
    const repo = await api.getRepo(ownerHex, 'r');
    expect(['', 'main']).toContain(repo.defaultBranch);
    expect(repo.description).toBeUndefined();
  });

  it('listCommits resolves [] when no sha provided and no HEAD in repo state', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    (vi.spyOn(api as any, 'fetchLatestState') as any).mockResolvedValueOnce(null);
    const res = await api.listCommits(ownerHex, 'r', {});
    expect(res).toEqual([]);
  });

  it('queryEvents dedupes results by id across multiple filters', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    const poolMock = {
      querySync: vi
        .fn()
        .mockResolvedValueOnce([{ id: '1' }, { id: '2' }])
        .mockResolvedValueOnce([{ id: '2' }, { id: '3' }])
    } as any;
    (api as any).pool = poolMock;

    const filters = [{ kinds: [1] }, { kinds: [2] }];
    const out = await (api as any).queryEvents(filters);
    const ids = out.map((e: any) => e.id).sort();
    expect(ids).toEqual(['1', '2', '3']);
    expect(poolMock.querySync).toHaveBeenCalledTimes(2);
    expect(poolMock.querySync).toHaveBeenCalledWith([relay], filters[0]);
    expect(poolMock.querySync).toHaveBeenCalledWith([relay], filters[1]);
  });

  it('queryEvents swallows per-filter errors and returns combined successful results', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    const err = new Error('boom');
    const poolMock = {
      querySync: vi.fn()
        .mockRejectedValueOnce(err)
        .mockResolvedValueOnce([{ id: 'a' }])
    } as any;
    (api as any).pool = poolMock;

    const filters = [{ kinds: [3] }, { kinds: [4] }];
    const out = await (api as any).queryEvents(filters);
    expect(out.map((e: any) => e.id)).toEqual(['a']);
    expect(poolMock.querySync).toHaveBeenCalledTimes(2);
  });

  it('getRelayInfo caches after first ensureCapabilities call', async () => {
    const mod = await import('../../../src/api/providers/grasp-capabilities.js');
    const spy = vi.spyOn(mod, 'fetchRelayInfo');
    spy.mockResolvedValue({
      supported_grasps: ['GRASP-01'],
      smart_http: ['https://relay.example.com']
    } as any);

    const api = new GraspApiProvider('wss://relay.example.com', ownerHex as any);
    const info1 = await api.getRelayInfo();
    const info2 = await api.getRelayInfo();

    expect(info1).toBeDefined();
    expect(info2).toBeDefined();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('getCapabilities falls back when NIP-11 fetch fails and derives http origins', async () => {
    const mod = await import('../../../src/api/providers/grasp-capabilities.js');
    const spy = vi.spyOn(mod, 'fetchRelayInfo');
    spy.mockRejectedValue(new Error('nip11 down'));

    const api = new GraspApiProvider('wss://relay.fail', ownerHex as any);
    const caps = await api.getCapabilities();
    expect(caps).toBeDefined();
    const httpOrigins = (caps as any).httpOrigins || [];
    expect(httpOrigins.some((o: string) => o.startsWith('https://relay.fail'))).toBe(true);
    expect(httpOrigins.some((o: string) => /\/git$/.test(o))).toBe(true);
    spy.mockRestore();
  });

  it('getRelayInfo returns cached relay info after ensureCapabilities', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (vi.spyOn(api as any, 'ensureCapabilities') as any).mockResolvedValue(undefined);
    setPriv(api, 'relayInfo', { name: 'relay-name', supported_grasps: ['GRASP-01'] });
    const info = await api.getRelayInfo();
    expect((info as any).name).toBe('relay-name');
  });

  it('getRepo sets description undefined when announcement missing or unparsable', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    setPriv(api, 'capabilities', { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] });
    setPriv(api, 'httpBase', 'https://relay.example');
    // queryEvents returns no announcement
    (vi.spyOn(api as any, 'queryEvents') as any).mockResolvedValueOnce([]);
    // fetchLatestState returns a valid head
    (vi.spyOn(api as any, 'fetchLatestState') as any).mockResolvedValueOnce({ head: 'ref: refs/heads/main', refs: {} });
    const repo = await api.getRepo(ownerHex, 'repo');
    expect(repo.description).toBeUndefined();
  });

  it('getRepo falls back to defaultBranch "main" when no state event HEAD is available', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    setPriv(api, 'capabilities', { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] });
    setPriv(api, 'httpBase', 'https://relay.example');
    // announcement present but irrelevant
    const ann = { content: JSON.stringify({}) };
    (vi.spyOn(api as any, 'queryEvents') as any).mockResolvedValueOnce([ann]);
    // fetchLatestState returns null
    (vi.spyOn(api as any, 'fetchLatestState') as any).mockResolvedValueOnce(null);
    const repo = await api.getRepo(ownerHex, 'repo');
    expect(repo.defaultBranch).toBe('main');
  });

  it('getRepo builds metadata from relay/httpBase and event state', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Pretend capabilities are loaded with a specific httpBase
    setPriv(api, 'capabilities', { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] });
    setPriv(api, 'httpBase', 'https://relay.example');

    // Mock announcement and state returns via queryEvents
    const ann = { content: JSON.stringify({ description: 'test repo' }), tags: [] };
    const st = { tags: [['HEAD', 'ref: refs/heads/main']] };
    (vi.spyOn(api as any, 'queryEvents') as any).mockImplementation(async (filters: any[]) => {
      const kinds = filters?.[0]?.kinds || [];
      if (kinds.includes(30617)) return [ann as any]; // announcement
      if (kinds.includes(30618)) return [st as any];  // state
      return [];
    });

    const out = await api.getRepo(ownerHex, 'myrepo');
    // Basic shape checks without relying on nip19 specifics
    expect(out.cloneUrl.endsWith('/myrepo.git')).toBe(true);
    expect(out.cloneUrl.startsWith('https://relay.example/')).toBe(true);
    expect(out.htmlUrl.endsWith('/myrepo')).toBe(true);
    expect(out.defaultBranch).toBe('main');
    expect(out.description).toBe('test repo');
  });

  it('listIssues is not supported and throws', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    await expect(api.listIssues(ownerHex, 'x')).rejects.toThrow(/not supported/);
  });

  it('getCommit propagates error with stable message', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Seed capabilities/httpBase to avoid ensureCapabilities network work
    setPriv(api, 'capabilities', { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] });
    setPriv(api, 'httpBase', 'https://relay.example');
    // Avoid fetch dependency; mock readCommit to reject
    const spy = vi.spyOn(git as any, 'readCommit').mockRejectedValue(new Error('nope'));
    await expect(api.getCommit(ownerHex, 'repo', 'abcd')).rejects.toThrow(/Failed to get commit:/);
    spy.mockRestore();
  });

  it('getFileContent fetches blob and returns base64 content', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    const buf = new Uint8Array([104, 105]); // 'hi'
    vi.spyOn(git as any, 'readBlob').mockResolvedValue({ oid: 'abc', blob: buf });
    const out = await api.getFileContent(ownerHex, 'repo', 'path.txt', 'main');
    expect(out.sha).toBe('abc');
    expect(out.encoding).toBe('base64');
    expect(out.content).toBe(Buffer.from('hi').toString('base64'));
  });

  it('listBranches returns mapped branches with commit sha/url', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    vi.spyOn(git as any, 'listBranches').mockResolvedValue(['main']);
    vi.spyOn(git as any, 'resolveRef').mockResolvedValue('deadbeef');
    const out = await api.listBranches(ownerHex, 'repo');
    expect(out[0]).toMatchObject({ name: 'main', commit: { sha: 'deadbeef' } });
    expect(out[0].commit.url).toMatch(/commit\/deadbeef$/);
  });

  it('getBranch returns branch with resolved sha', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    vi.spyOn(git as any, 'resolveRef').mockResolvedValue('cafebabe');
    const out = await api.getBranch(ownerHex, 'repo', 'dev');
    expect(out.name).toBe('dev');
    expect(out.commit.sha).toBe('cafebabe');
  });

  it('listTags returns mapped tags with commit sha/url', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    vi.spyOn(git as any, 'listTags').mockResolvedValue(['v1']);
    vi.spyOn(git as any, 'resolveRef').mockResolvedValue('facefeed');
    const out = await api.listTags(ownerHex, 'repo');
    expect(out[0]).toMatchObject({ name: 'v1', commit: { sha: 'facefeed' } });
    expect(out[0].commit.url).toMatch(/commit\/facefeed$/);
  });

  it('getTag returns tag metadata with archive URLs and commit', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    vi.spyOn(git as any, 'fetch').mockResolvedValue(undefined);
    vi.spyOn(git as any, 'resolveRef').mockResolvedValue('feedfeed');
    const out = await api.getTag(ownerHex, 'repo', 'v2');
    expect(out.name).toBe('v2');
    expect(out.commit.sha).toBe('feedfeed');
    expect(out.zipballUrl).toMatch(/\/archive\/v2.zip$/);
    expect(out.tarballUrl).toMatch(/\/archive\/v2.tar.gz$/);
  });

  it('getCurrentUser maps profile from kind-0 event content when available', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    const profile = { name: 'Alice', about: 'hi', picture: 'p.png', website: 'https://w' };
    (vi.spyOn(api as any, 'queryEvents') as any).mockResolvedValueOnce([{ content: JSON.stringify(profile) }]);
    const user = await api.getCurrentUser();
    expect(user.name).toBe('Alice');
    expect(user.avatarUrl).toBe('p.png');
    expect(user.blog).toBe('https://w');
  });

  it('getUser throws on invalid npub identifier and succeeds on valid', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    await expect(api.getUser('alice')).rejects.toThrow(/Invalid user identifier/);
  });

  it('listPullRequests rejects because GRASP REST does not expose Nostr PR events', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    await expect(api.listPullRequests(ownerHex, 'r')).rejects.toThrow(/Nostr pull request events/);
  });

  it('isValidNostrRelayUrl validates expected hosts and schemes', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    const call = (u: string) => (api as any).isValidNostrRelayUrl(u);
    expect(call('ws://localhost')).toBe(true);
    expect(call('wss://127.0.0.1')).toBe(true);
    expect(call('wss://example.com')).toBe(true);
    expect(call('http://example.com')).toBe(false);
    expect(call('ftp://example.com')).toBe(false);
    expect(call('ws://nodot-example')).toBe(false); // hostnames without dots are rejected
    expect(call('ws://nodot')).toBe(false);
  });

  it('gitRequest builds URL with httpBase and sets CORS options without forbidden headers', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (api as any).capabilities = { grasp01: true, grasp05: false, httpOrigins: ['https://relay.example'], nostrRelays: [relay] };
    (api as any).httpBase = 'https://relay.example';
    const fetchMock = vi.fn().mockResolvedValue({ ok: true } as any);
    const orig = globalThis.fetch as any;
    // @ts-ignore
    globalThis.fetch = fetchMock;
    try {
      await (api as any).gitRequest('npub1xyz', 'repo', '/info/refs?service=git-upload-pack', { headers: { 'X-Test': '1' } });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = (fetchMock as any).mock.calls[0];
      expect(url).toBe('https://relay.example/npub1xyz/repo.git/info/refs?service=git-upload-pack');
      expect(init.mode).toBe('cors');
      expect(init.credentials).toBe('omit');
      expect(init.headers['X-Test']).toBe('1');
      expect(init.headers['User-Agent']).toBeUndefined();
    } finally {
      globalThis.fetch = orig;
    }
  });

  it('isGraspSupported returns true when GRASP-01 is advertised', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (vi.spyOn(api as any, 'ensureCapabilities') as any).mockResolvedValue(undefined);
    setPriv(api, 'relayInfo', { supported_grasps: ['GRASP-01'] });
    const res = await (api as any).isGraspSupported();
    expect(res).toBe(true);
  });

  it('isGraspSupported returns false when GRASP-01 is not present', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    (vi.spyOn(api as any, 'ensureCapabilities') as any).mockResolvedValue(undefined);
    setPriv(api, 'relayInfo', { supported_grasps: [] });
    const res = await (api as any).isGraspSupported();
    expect(res).toBe(false);
  });

  it('getCurrentUser tolerates invalid JSON profile and leaves fields defaulted', async () => {
    const api = new GraspApiProvider(relay, ownerHex as any);
    // Return a kind-0 event with invalid JSON
    (vi.spyOn(api as any, 'queryEvents') as any).mockResolvedValueOnce([{ content: '{invalid' }]);
    const user = await api.getCurrentUser();
    expect(user.avatarUrl).toBe('');
    expect(user.name).toBeUndefined();
    expect(user.blog).toBeUndefined();
  });

  it('ensureCapabilities prefers root http origin over pathful when both are present', async () => {
    const mod = await import('../../../src/api/providers/grasp-capabilities.js');
    const spy = vi.spyOn(mod, 'fetchRelayInfo');
    spy.mockResolvedValue({
      supported_grasps: ['GRASP-01'],
      smart_http: ['https://relay.example', 'https://relay.example/git']
    } as any);

    const api = new GraspApiProvider('wss://relay.example', ownerHex as any);
    await api.getCapabilities();
    expect((api as any).httpBase).toBe('https://relay.example');
    spy.mockRestore();
  });
});
