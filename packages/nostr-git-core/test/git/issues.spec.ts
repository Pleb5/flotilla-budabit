import { describe, it, expect } from 'vitest';
import { assembleIssueThread } from '../../src/events/nip34/issues.js';

function evt(partial: Partial<any>): any {
  return {
    id: '',
    kind: 1621,
    pubkey: 'root',
    content: '',
    created_at: 1,
    tags: [],
    sig: '',
    ...partial
  };
}

describe('assembleIssueThread (NIP-22 scoped)', () => {
  it('matches comments via E/e and A/a with K/k scoping', () => {
    const root = evt({ id: 'root-id', kind: 1621, tags: [['a', '1621:root:issue-1']] });

    const c1 = evt({
      id: 'c1',
      kind: 1111,
      created_at: 2,
      tags: [
        ['E', 'root-id'],
        ['K', '1621']
      ]
    });
    const c2 = evt({
      id: 'c2',
      kind: 1111,
      created_at: 3,
      tags: [
        ['e', 'root-id'],
        ['k', '1621']
      ]
    });
    const c3 = evt({
      id: 'c3',
      kind: 1111,
      created_at: 4,
      tags: [
        ['A', '1621:root:issue-1'],
        ['K', '1621']
      ]
    });
    const c4 = evt({
      id: 'c4',
      kind: 1111,
      created_at: 5,
      tags: [
        ['a', '1621:root:issue-1'],
        ['k', '1621']
      ]
    });
    const cWrongKind = evt({
      id: 'c5',
      kind: 1111,
      created_at: 6,
      tags: [
        ['E', 'root-id'],
        ['K', '9999']
      ]
    });
    const cNoRef = evt({ id: 'c6', kind: 1111, created_at: 7, tags: [['p', 'x']] });

    const { comments } = assembleIssueThread({
      root,
      comments: [c1, c2, c3, c4, cWrongKind, cNoRef],
      statuses: []
    });

    expect(comments.map((c: any) => c.id)).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('matches statuses via e (root id) or a (address)', () => {
    const root = evt({ id: 'root-id', kind: 1621, tags: [['a', '1621:root:issue-2']] });

    const s1 = evt({ id: 's1', kind: 1630, created_at: 2, tags: [['e', 'root-id', '', 'root']] });
    const s2 = evt({ id: 's2', kind: 1631, created_at: 3, tags: [['a', '1621:root:issue-2']] });
    const sNo = evt({ id: 's3', kind: 1632, created_at: 4, tags: [['e', 'other']] });

    const { statuses } = assembleIssueThread({ root, comments: [], statuses: [s1, s2, sNo] });

    expect(statuses.map((s: any) => s.id)).toEqual(['s1', 's2']);
  });
});
