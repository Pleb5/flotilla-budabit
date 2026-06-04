import { describe, it, expect } from 'vitest';
import {
  createCommentEvent,
  createGitCommentEvent,
  createGitInlineCommentEvent,
  type CommentEvent,
  type CommentTag
} from '../../src/events/nip22/nip22.js';
import { parseCommentEvent } from '../../src/events/nip22/nip22-utils.js';

describe('NIP-22: comments (create + parse)', () => {
  it('creates a comment with root-only tags (A/E/I + K/P/R)', () => {
    const evt = createCommentEvent({
      content: 'Hello world',
      root: {
        type: 'A',
        value: '30023:pubkey:identifier',
        kind: '30023',
        pubkey: 'abcdef',
        relay: 'wss://relay.example.com'
      },
      authorPubkey: 'pubkey-author',
      created_at: 1700000000,
      id: 'id-1'
    });

    expect(evt.kind).toBe(1111);
    expect(evt.content).toBe('Hello world');
    expect(evt.pubkey).toBe('pubkey-author');
    expect(evt.created_at).toBe(1700000000);
    expect(evt.id).toBe('id-1');

    // Root tags
    expect(evt.tags).toContainEqual(['A', '30023:pubkey:identifier']);
    expect(evt.tags).toContainEqual(['K', '30023']);
    expect(evt.tags).toContainEqual(['P', 'abcdef']);
    expect(evt.tags).toContainEqual(['R', 'wss://relay.example.com']);

    // No parent tags unless provided
    expect(evt.tags.some((t) => t[0] === 'a' || t[0] === 'e' || t[0] === 'i')).toBe(false);
  });

  it('creates a comment with root + parent tags (a/e/i + k/p/r)', () => {
    const evt = createCommentEvent({
      content: 'Reply comment',
      root: { type: 'E', value: 'root-event-id', kind: '1621' },
      parent: {
        type: 'e',
        value: 'parent-event-id',
        kind: '1621',
        pubkey: 'parent-author',
        relay: 'wss://relay.parent'
      },
      authorPubkey: 'author',
      created_at: 1700000001
    });

    expect(evt.tags).toContainEqual(['E', 'root-event-id']);
    expect(evt.tags).toContainEqual(['K', '1621']);

    expect(evt.tags).toContainEqual(['e', 'parent-event-id']);
    expect(evt.tags).toContainEqual(['k', '1621']);
    expect(evt.tags).toContainEqual(['p', 'parent-author']);
    expect(evt.tags).toContainEqual(['r', 'wss://relay.parent']);
  });

  it('propagates extraTags after root/parent tags', () => {
    const extraTags: CommentTag[] = [
      ['q', 'cited-id', 'wss://relay.cited', 'mention'],
      ['p', 'mentioned-pubkey', 'wss://relay.mention']
    ];

    const evt = createCommentEvent({
      content: 'With extras',
      root: { type: 'I', value: 'https://example.com/post/1', kind: '1' },
      extraTags,
      created_at: 1700000002
    });

    for (const t of extraTags) {
      expect(evt.tags).toContainEqual(t);
    }
  });

  it('parses a comment event into developer-friendly Comment object', () => {
    const evt = createCommentEvent({
      content: 'Parse me',
      root: { type: 'A', value: '30617:pk:repo', kind: '30617', pubkey: 'pk', relay: 'wss://r' },
      authorPubkey: 'author-pub',
      created_at: 1700001000,
      id: 'evt-id'
    });

    const parsed = parseCommentEvent(evt);
    expect(parsed.id).toBe('evt-id');
    expect(parsed.content).toBe('Parse me');
    expect(parsed.author.pubkey).toBe('author-pub');
    expect(parsed.tags).toEqual(evt.tags);
    expect(parsed.createdAt).toBe(new Date(1700001000 * 1000).toISOString());
    expect(parsed.raw).toBe(evt);
  });

  it('falls back to empty string for missing id/pubkey in parseCommentEvent', () => {
    const raw: any = {
      kind: 1111,
      content: 'No id/pubkey',
      tags: [['E', 'root-event']] as CommentTag[],
      created_at: 1700002000
      // id missing
      // pubkey missing
    } satisfies Partial<CommentEvent>;

    const parsed = parseCommentEvent(raw as CommentEvent);
    expect(parsed.id).toBe('');
    expect(parsed.author.pubkey).toBe('');
    expect(parsed.content).toBe('No id/pubkey');
    expect(parsed.createdAt).toBe(new Date(1700002000 * 1000).toISOString());
  });

  it('creates a NIP-34 PR comment with root, parent, and repo q tags', () => {
    const evt = createGitCommentEvent({
      content: 'Review note',
      root: {
        id: 'pr-id',
        kind: 1618,
        pubkey: 'pr-author',
        relay: 'wss://relay.root'
      },
      parent: {
        id: 'parent-comment-id',
        kind: 1111,
        pubkey: 'parent-author',
        relay: 'wss://relay.parent'
      },
      authorPubkey: 'reviewer',
      repoRefs: ['30617:maintainer:repo'],
      relayHint: 'wss://relay.repo',
      created_at: 1700003000
    });

    expect(evt.kind).toBe(1111);
    expect(evt.content).toBe('Review note');
    expect(evt.pubkey).toBe('reviewer');
    expect(evt.created_at).toBe(1700003000);
    expect(evt.tags).toContainEqual(['E', 'pr-id', 'wss://relay.root', 'pr-author']);
    expect(evt.tags).toContainEqual(['K', '1618']);
    expect(evt.tags).toContainEqual(['P', 'pr-author', 'wss://relay.root']);
    expect(evt.tags).toContainEqual(['e', 'parent-comment-id', 'wss://relay.parent', 'parent-author']);
    expect(evt.tags).toContainEqual(['k', '1111']);
    expect(evt.tags).toContainEqual(['p', 'parent-author', 'wss://relay.parent']);
    expect(evt.tags).toContainEqual(['q', '30617:maintainer:repo', 'wss://relay.repo']);
    expect(evt.tags.some((tag) => tag[0] === 'repo')).toBe(false);
  });

  it('preserves rich editor extra tags on NIP-34 comments', () => {
    const extraTags: CommentTag[] = [
      ['p', 'mentioned-pubkey', 'wss://relay.mention'],
      ['q', 'quoted-event-id', 'wss://relay.quote'],
      ['imeta', 'url https://cdn.example/file.png', 'm image/png']
    ];

    const evt = createGitCommentEvent({
      content: 'Comment with rich tags',
      root: { id: 'issue-id', kind: 1621, pubkey: 'issue-author' },
      relayHint: 'wss://relay.example',
      extraTags,
      created_at: 1700003001
    });

    expect(evt.tags).toContainEqual(['E', 'issue-id', 'wss://relay.example', 'issue-author']);
    for (const tag of extraTags) {
      expect(evt.tags).toContainEqual(tag);
    }
  });

  it('creates a NIP-34 inline comment with file, commit, and deleted-line tags', () => {
    const evt = createGitInlineCommentEvent({
      content: 'This removed line needs explanation',
      root: { id: 'pr-id', kind: 1618, pubkey: 'pr-author' },
      authorPubkey: 'reviewer',
      relayHint: 'wss://relay.example',
      repoRefs: ['30617:maintainer:repo'],
      filePath: 'src/example.ts',
      commitId: 'abc123',
      line: '42',
      lineSide: 'del'
    });

    expect(evt.content).toBe('This removed line needs explanation');
    expect(evt.tags).toContainEqual(['E', 'pr-id', 'wss://relay.example', 'pr-author']);
    expect(evt.tags).toContainEqual(['e', 'pr-id', 'wss://relay.example', 'pr-author']);
    expect(evt.tags).toContainEqual(['f', 'src/example.ts']);
    expect(evt.tags).toContainEqual(['c', 'abc123']);
    expect(evt.tags).toContainEqual(['line', '42', 'del']);
    expect(evt.tags).toContainEqual(['q', '30617:maintainer:repo', 'wss://relay.example']);
    expect(evt.content).not.toContain('File:');
  });
});
