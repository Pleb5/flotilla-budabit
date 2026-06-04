import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { isPermalink, parsePermalink } from '../../src/git/permalink.js';

describe('git/permalink utils', () => {
  it('isPermalink detects github/gitlab/gitea patterns', () => {
    expect(isPermalink('https://github.com/owner/repo/blob/main/README.md#L10-L12')).toBe(true);
    expect(isPermalink('https://gitlab.com/owner/repo/-/blob/main/src/index.ts#L5-10')).toBe(true);
    expect(isPermalink('https://gitea.example.com/owner/repo/src/commit/abcdef/path/file.ts')).toBe(true);
    expect(isPermalink('not a url')).toBe(false);
  });

  it('parsePermalink extracts github blob with line range', () => {
    const url = 'https://github.com/owner/repo/blob/main/src/a.ts#L10-L20';
    const p = parsePermalink(url)!;
    expect(p.platform).toBe('github');
    expect(p.owner).toBe('owner');
    expect(p.repo).toBe('repo');
    expect(p.branch).toBe('main');
    expect(p.filePath).toBe('src/a.ts');
    expect(p.startLine).toBe(10);
    expect(p.endLine).toBe(20);
  });

  it('parsePermalink extracts github commit diff fragment', () => {
    const url = 'https://github.com/owner/repo/commit/0123456#diff-deadbeefL19-L22';
    const p = parsePermalink(url)!;
    expect(p.platform).toBe('github');
    expect(p.branch).toBe('0123456');
    expect(p.isDiff).toBe(true);
    expect(p.diffFileHash).toMatch(/deadbeef/);
    expect(p.diffSide).toBe('L');
    expect(p.startLine).toBe(19);
    expect(p.endLine).toBe(22);
  });

  it('parsePermalink extracts gitlab blob with line range', () => {
    const url = 'https://gitlab.com/owner/repo/-/blob/main/src/b.ts#L1-3';
    const p = parsePermalink(url)!;
    expect(p.platform).toBe('gitlab');
    expect(p.owner).toBe('owner');
    expect(p.repo).toBe('repo');
    expect(p.branch).toBe('main');
    expect(p.filePath).toBe('src/b.ts');
  });

  it('parsePermalink extracts gitea commit style path', () => {
    const url = 'https://gitea.example.com/owner/repo/src/commit/abcdef/path/to/c.ts#L7';
    const p = parsePermalink(url)!;
    expect(p.platform).toBe('gitea');
    expect(p.owner).toBe('owner');
    expect(p.repo).toBe('repo');
    expect(p.branch).toBe('abcdef');
    expect(p.filePath).toBe('path/to/c.ts');
    expect(p.startLine).toBe(7);
  });

  it('parsePermalink returns null on unknown hosts or malformed paths', () => {
    expect(parsePermalink('https://unknown.local/owner/repo/blob/main/a.ts')).toBeNull();
    expect(parsePermalink('not a url')).toBeNull();
  });
});
