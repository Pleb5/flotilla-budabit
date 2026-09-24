import { describe, expect, it, vi } from 'vitest';
import type { WidgetBridge } from 'budabit-sdk';
import { loadReleaseDetail, parseApplication, parseAsset, platformLabel } from './releases.js';
import { releaseNotesHtml } from './markdown.js';
import { releaseFixture, signed, testRepo } from './test-fixtures.js';

describe('release detail', () => {
  it('rejects revoked or superseded detail on entry and after a delayed asset response', async () => {
    const release = releaseFixture();
    let state = { apps: [parseApplication(signed())], events: [release] };
    const request = vi.fn(async () => ({ status: 'ok', complete: true, events: [] }));
    const bridge = { request } as unknown as WidgetBridge;
    state = { ...state, events: [releaseFixture({ created_at: 101 })] };
    await expect(loadReleaseDetail(bridge, testRepo(), release, () => state)).rejects.toThrow(
      'current authorized'
    );
    expect(request).not.toHaveBeenCalled();
    state = { apps: [], events: [release] };
    await expect(loadReleaseDetail(bridge, testRepo(), release, () => state)).rejects.toThrow(
      'current authorized'
    );
    state = { apps: [parseApplication(signed())], events: [release] };
    const pending = loadReleaseDetail(bridge, testRepo(), release, () => state);
    state = { apps: [], events: [] };
    await expect(pending).rejects.toThrow('current authorized');
  });
  it('preserves independent asset identity, explicit filename, relay hints and unresolved IDs', async () => {
    const asset = signed(
      {
        kind: 3063,
        tags: [
          ['i', 'independent'],
          ['version', '2'],
          ['x', 'b'.repeat(64)],
          ['m', 'application/octet-stream'],
          ['filename', 'declared.bin'],
        ],
      },
      2
    );
    const release = releaseFixture({
      tags: [
        ...releaseFixture().tags,
        ['e', asset.id, 'wss://hint.example/'],
        ['e', 'c'.repeat(64), 'javascript:bad'],
      ],
    });
    const request = vi.fn(async () => ({ status: 'ok', complete: false, events: [asset] }));
    const detail = await loadReleaseDetail(
      { request } as unknown as WidgetBridge,
      testRepo(),
      release,
      () => ({ apps: [parseApplication(signed())], events: [release] })
    );
    expect(detail.assets[0]).toMatchObject({
      appId: 'independent',
      version: '2',
      filename: 'declared.bin',
    });
    expect(detail.unresolvedAssetIds).toEqual(['a'.repeat(64), 'c'.repeat(64)]);
    expect(detail.complete).toBe(false);
    expect(request).toHaveBeenCalledWith(
      'nostr:query',
      expect.objectContaining({ relays: ['wss://hint.example'] })
    );
    expect(platformLabel([])).toBe('Not declared');
    expect(
      parseAsset(signed({ ...asset, tags: [...asset.tags, ['url', 'javascript:bad']] }))
    ).toBeNull();
  });
  it('sanitizes notes without accumulating global hooks or making tracking requests', () => {
    const notes =
      '# Notes\n[download](https://files.example/app)\n<img src="https://tracker.example" onerror="alert(1)"><script>alert(1)</script><a href="javascript:bad">bad</a>';
    const first = releaseNotesHtml(notes),
      second = releaseNotesHtml(notes);
    expect(first).toBe(second);
    const root = document.createElement('div');
    root.innerHTML = first;
    expect(root.querySelector('h1')?.textContent).toBe('Notes');
    expect(root.querySelector('a')?.getAttribute('target')).toBe('_blank');
    expect(root.querySelector('a')?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(root.querySelector('img, script, [onerror], [href^="javascript:"]')).toBeNull();
  });
  it('allows only passive Markdown, never media, embeds, styles or resource attributes', () => {
    const html = releaseNotesHtml(
      `## Passive notes\n\n**Bold** and *emphasis*\n\n- item\n\n\`code\`\n\n| Key | Value |\n| --- | --- |\n| A | B |\n\n<video poster="https://tracker.example/pixel"></video><audio src="https://tracker.example/sound" preload="auto"></audio><picture><source srcset="https://tracker.example/source"><img src="https://tracker.example/img"></picture><svg><image href="https://tracker.example/svg"/></svg><iframe src="https://tracker.example/frame"></iframe><object data="https://tracker.example/object"></object><link rel="stylesheet" href="https://tracker.example/style"><style>p{background:url(https://tracker.example/bg)}</style><p style="background:url(https://tracker.example/bg)" background="https://tracker.example/bg">Safe</p><a href="https://files.example/guide" ping="https://tracker.example/ping" style="color:red">Guide</a>`
    );
    const root = document.createElement('div');
    root.innerHTML = html;
    expect(
      root.querySelector(
        'video,audio,source,picture,img,svg,iframe,object,embed,link,style,[src],[srcset],[poster],[style],[background],[ping]'
      )
    ).toBeNull();
    for (const tag of ['h2', 'strong', 'em', 'ul', 'li', 'code', 'table', 'th', 'td'])
      expect(root.querySelector(tag)).not.toBeNull();
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://files.example/guide');
  });
});
