import { describe, it, expect } from 'vitest';
import { assembleIssueThread } from '../../src/events/nip34/issues.js';

function mkEvent(overrides: Partial<any> = {}): any {
  return {
    id: overrides.id ?? Math.random().toString(36).slice(2),
    kind: overrides.kind ?? 1111,
    pubkey: overrides.pubkey ?? 'npub1x',
    created_at: overrides.created_at ?? 0,
    tags: overrides.tags ?? [],
    content: overrides.content ?? '',
    sig: overrides.sig ?? ''
  };
}

describe('NIP-22 threading', () => {
  it('threads comments by uppercase E/a + kind scoping', () => {
    const root = mkEvent({
      id: 'root1',
      kind: 1621,
      pubkey: 'npubRoot',
      tags: [['a', '30621:npubRoot:issue-1']]
    });

    const c1 = mkEvent({
      id: 'c1',
      tags: [
        ['E', 'root1'],
        ['K', String(root.kind)]
      ],
      created_at: 1
    });
    const c2 = mkEvent({
      id: 'c2',
      tags: [
        ['a', '30621:npubRoot:issue-1'],
        ['K', String(root.kind)]
      ],
      created_at: 2
    });
    const cWrongKind = mkEvent({
      id: 'c3',
      tags: [
        ['E', 'root1'],
        ['K', '9999']
      ],
      created_at: 3
    });

    const thread = assembleIssueThread({ root, comments: [c1, c2, cWrongKind], statuses: [] });
    expect(thread.comments.map((c) => c.id)).toEqual(['c1', 'c2']);
  });
});
