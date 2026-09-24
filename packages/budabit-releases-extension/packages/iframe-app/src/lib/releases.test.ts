import { describe, expect, it } from 'vitest';
import {
  assetDownloadUrl,
  buildApplicationEvent,
  buildAssetEvent,
  buildReleaseEvent,
  formatBytes,
  formatDate,
  getRelays,
  loadReleaseDetail,
  parseApplication,
  parseAsset,
  parseReleaseListItem,
  platformLabel,
  shortHash,
} from './releases.js';
import { signed, testPubkey, testRepo, releaseFixture } from './test-fixtures.js';
import type { EventTemplate } from 'nostr-tools';
import type { WidgetBridge } from 'budabit-sdk';

const base = () => ({
  eventId: 'asset',
  sha256: 'a'.repeat(64),
  url: 'https://files.example/download.bin',
  filename: 'explicit.bin',
  mimeType: 'application/octet-stream',
});
describe('NIP-82 parsers, builders and display helpers', () => {
  it('round-trips the full asset metadata without replacing its commit', () => {
    const artifact = {
      ...base(),
      appId: 'asset.id',
      version: '20',
      size: 0,
      platforms: ['linux-x86_64'],
      commitId: 'b'.repeat(40),
      minPlatformVersion: '1',
      targetPlatformVersion: '2',
      variant: 'portable',
      versionCode: 0,
      apkCertificateHashes: ['c'.repeat(64)],
    };
    const event = signed(
      buildAssetEvent({
        appId: 'app',
        version: '1',
        artifact,
        commitId: 'd'.repeat(40),
      }) as unknown as EventTemplate
    );
    expect(parseAsset(event)).toMatchObject({
      appId: 'asset.id',
      version: '20',
      size: 0,
      filename: 'explicit.bin',
      commitId: 'b'.repeat(40),
      minPlatformVersion: '1',
      targetPlatformVersion: '2',
      variant: 'portable',
      versionCode: 0,
      apkCertificateHashes: ['c'.repeat(64)],
    });
    expect(
      parseAsset(signed({ ...event, tags: [...event.tags, ['url', 'javascript:bad']] }))
    ).not.toBeNull(); // first url is authoritative
  });
  it('derives filenames and refuses malformed hashes, MIME/identity and unsafe URLs', () => {
    const valid = [
      ['i', 'asset'],
      ['version', '1'],
      ['m', 'application/octet-stream'],
      ['x', 'a'.repeat(64)],
    ];
    for (const [extra, filename] of [
      [[['url', 'https://files.example/url.bin']], 'url.bin'],
      [[['variant', 'portable']], 'portable'],
      [[], 'a'.repeat(12)],
    ] as [string[][], string][]) {
      expect(parseAsset(signed({ kind: 3063, tags: [...valid, ...extra] }))?.filename).toBe(
        filename
      );
    }
    expect(
      parseAsset(
        signed({ kind: 3063, tags: [...valid, ['size', 'invalid'], ['version_code', 'invalid']] })
      )
    ).toMatchObject({ size: undefined, versionCode: undefined });
    for (const key of ['i', 'version', 'm', 'x'])
      expect(
        parseAsset(signed({ kind: 3063, tags: valid.filter((t) => t[0] !== key) }))
      ).toBeNull();
    expect(parseAsset(signed({ kind: 3063, tags: [...valid, ['url', 'not a url']] }))).toBeNull();
    expect(() =>
      buildAssetEvent({ appId: 'app', version: '1', artifact: { ...base(), size: -1 } })
    ).toThrow('size');
    expect(() =>
      buildAssetEvent({ appId: 'app', version: '1', artifact: { ...base(), mimeType: 'bad' } })
    ).toThrow('MIME');
  });
  it('builds application/release links and channel replacement coordinates', () => {
    const app = parseApplication(
      signed(
        buildApplicationEvent({
          appId: 'app',
          name: 'App',
          repoAddress: testRepo().repoAddress,
          repoRelay: 'wss://relay.example',
          summary: 'Summary',
          description: 'Notes',
          repositoryUrl: 'https://git.example/repo',
          license: 'MIT',
        }) as unknown as EventTemplate
      )
    );
    expect(app).toMatchObject({
      appId: 'app',
      name: 'App',
      summary: 'Summary',
      description: 'Notes',
      license: 'MIT',
      repositoryUrl: 'https://git.example/repo',
    });
    const options = {
      appId: 'app',
      appPubkey: testPubkey(),
      version: '1',
      channel: 'main',
      assetEventIds: ['a'.repeat(64)],
      releaseNotes: '',
    };
    const a = signed(buildReleaseEvent(options) as unknown as EventTemplate);
    const b = signed(
      buildReleaseEvent({ ...options, channel: 'beta' }) as unknown as EventTemplate
    );
    expect(a.tags.find((t) => t[0] === 'd')).toEqual(b.tags.find((t) => t[0] === 'd'));
    expect(parseReleaseListItem(a)).toMatchObject({ version: '1', assetCount: 1, channel: 'main' });
    expect(parseReleaseListItem(signed({ tags: [] }))).toMatchObject({
      version: 'unknown',
      channel: 'main',
      appId: '',
    });
    expect(() => buildReleaseEvent({ ...options, appPubkey: 'bad' })).toThrow('coordinate');
  });
  it('formats honest labels and resolves only safe download URLs', () => {
    expect([0, 1024, 1024 * 1024].map(formatBytes)).toEqual(['0 B', '1.0 KB', '1.0 MB']);
    expect(formatDate(100)).toContain('1970');
    expect(shortHash('a'.repeat(64))).toBe('a'.repeat(12) + '…');
    expect(platformLabel(['linux-x86_64', 'wasm32'])).toBe('linux (x86_64), wasm32');
    expect(getRelays(Array.from({ length: 20 }, (_, i) => `wss://relay${i}.example`))).toHaveLength(
      8
    );
    const asset = parseAsset(
      signed(
        buildAssetEvent({
          appId: 'app',
          version: '1',
          artifact: base(),
        }) as unknown as EventTemplate
      )
    )!;
    expect(assetDownloadUrl(asset)).toBe(base().url);
    expect(assetDownloadUrl({ ...asset, url: undefined })).toBe(
      `https://blossom.primal.net/${base().sha256}`
    );
    expect(assetDownloadUrl({ ...asset, url: 'javascript:bad' })).toBe('');
    expect(assetDownloadUrl({ ...asset, url: undefined, sha256: 'bad' })).toBe('');
    expect(assetDownloadUrl({ ...asset, url: undefined }, 'http://unsafe.example')).toBe('');
  });
  it('rejects outsider and empty declarations even when supplied as the current selection', async () => {
    const bridge = {
      request: async () => ({ status: 'ok', complete: true, events: [] }),
    } as unknown as WidgetBridge;
    for (const event of [releaseFixture({}, 2), releaseFixture({ tags: [] })])
      await expect(
        loadReleaseDetail(bridge, testRepo(), event, () => ({
          apps: [parseApplication(signed())],
          events: [event],
        }))
      ).rejects.toThrow('current authorized');
  });
});
