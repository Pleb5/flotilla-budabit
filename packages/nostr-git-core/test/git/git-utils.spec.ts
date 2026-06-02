import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { readCommitInfo, getAllBranches, hasOutstandingChanges, getRootCommit, doesCommitExist, getCommitParent, getCommitMessageSummary, createPatchFromCommit, areCommitsTooBigForPatches } from '../../src/git/git-utils.js';

describe('git-utils high-impact coverage', () => {
  it('covers commit info, parent, message summary, root commit, existence', async () => {
    const c1 = 'c1'.padEnd(40, '1');
    const c2 = 'c2'.padEnd(40, '2');
    const commits: Record<string, any> = {
      [c1]: {
        commit: {
          message: 'first\nmore',
          author: { name: 'Alice', email: 'alice@example.com', timestamp: 1, timezoneOffset: 0 },
          committer: { name: 'Alice', email: 'alice@example.com', timestamp: 1, timezoneOffset: 0 },
          parent: [],
          tree: 't1',
        }
      },
      [c2]: {
        commit: {
          message: 'second',
          author: { name: 'Alice', email: 'alice@example.com', timestamp: 2, timezoneOffset: 0 },
          committer: { name: 'Alice', email: 'alice@example.com', timestamp: 2, timezoneOffset: 0 },
          parent: [c1],
          tree: 't2',
        }
      }
    };
    const git: any = {
      async readCommit({ oid }: any) {
        const v = commits[oid];
        if (!v) throw new Error('NotFound');
        return v;
      },
      async log() { return [{ oid: c2 }, { oid: c1 }]; }
    };

    const info = await readCommitInfo(git, c2);
    expect(info.oid).toBe(c2);
    expect(info.parent).toEqual([c1]);

    const parent = await getCommitParent(git, c2);
    expect(parent).toBe(c1);

    const sum = await getCommitMessageSummary(git, c1);
    expect(sum).toBe('first');

    expect(await doesCommitExist(git, c2)).toBe(true);
    expect(await doesCommitExist(git, '0'.repeat(40))).toBe(false);

    const root = await getRootCommit(git);
    expect(root).toBe(c1);
  });

  it('createPatchFromCommit and areCommitsTooBigForPatches small path', async () => {
    const oid = 'p'.repeat(40);
    const git: any = {
      async readCommit({ oid: _ }: any) {
        return {
          commit: {
            message: 'patch-subject',
            author: { name: 'Bob', email: 'bob@example.com', timestamp: 1000, timezoneOffset: 0 },
          }
        };
      }
    };
    const patch = await createPatchFromCommit(git, oid);
    expect(patch).toContain('From ' + oid);
    expect(patch).toContain('Subject:');

    const tooBig = await areCommitsTooBigForPatches(git, [oid]);
    expect(tooBig).toBe(false);
  });

  it('getAllBranches and hasOutstandingChanges using mocks', async () => {
    const gitMock: any = {
      listBranches: async ({ remote }: any) => (remote ? ['origin/main'] : ['main']),
      resolveRef: async ({ ref }: any) => (ref.includes('main') ? 'abc'.padEnd(40, 'c') : 'def'.padEnd(40, 'f')),
      statusMatrix: async () => [
        // [filepath, head, workdir, stage]
        ['a.txt', 1, 1, 1],
        ['b.txt', 1, 2, 1], // working != staged => outstanding changes
      ],
    };

    const branches = await getAllBranches(gitMock);
    expect(branches.find(b => b.name === 'main' && !b.isRemote)).toBeTruthy();
    expect(branches.find(b => b.name === 'origin/main' && b.isRemote)).toBeTruthy();

    const dirty = await hasOutstandingChanges(gitMock);
    expect(dirty).toBe(true);
  });

  it('getAllBranches supports resolveRef returning object and hasOutstandingChanges returns false on error', async () => {
    const gitMock: any = {
      listBranches: async ({ remote }: any) => (remote ? ['origin/dev'] : ['dev']),
      resolveRef: async ({ ref }: any) => ({ oid: ref.includes('dev') ? 'ddd'.padEnd(40, 'd') : 'eee'.padEnd(40, 'e') }),
      statusMatrix: async () => { throw new Error('status failed'); },
    };
    const branches = await getAllBranches(gitMock);
    expect(branches).toEqual([
      { name: 'dev', oid: 'ddd'.padEnd(40, 'd'), isRemote: false },
      { name: 'origin/dev', oid: 'ddd'.padEnd(40, 'd'), isRemote: true },
    ]);
    const dirty = await hasOutstandingChanges(gitMock);
    expect(dirty).toBe(false);
  });

  it('getRootCommit throws on empty repo', async () => {
    const gitEmpty: any = {
      log: async () => [],
    };
    await expect(getRootCommit(gitEmpty)).rejects.toBeInstanceOf(Error);
  });

  it('areCommitsTooBigForPatches returns true when patch creation fails', async () => {
    const gitBad: any = {
      readCommit: async () => { throw new Error('read failed'); },
    };
    const res = await areCommitsTooBigForPatches(gitBad, ['deadbeef'.padEnd(40, '0')]);
    expect(res).toBe(true);
  });
});
