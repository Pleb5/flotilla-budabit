import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import { getMergeStatusMessage, buildMergeMetadataEventFromAnalysis, buildConflictMetadataEventFromAnalysis, type MergeAnalysisResult } from '../../src/git/merge-analysis.js';

function makeResult(partial: Partial<MergeAnalysisResult>): MergeAnalysisResult {
  return {
    canMerge: false,
    hasConflicts: false,
    conflictFiles: [],
    conflictDetails: [],
    upToDate: false,
    fastForward: false,
    patchCommits: [],
    analysis: 'clean',
    ...partial,
  } as MergeAnalysisResult;
}

describe('merge-analysis status and event builders', () => {
  it('getMergeStatusMessage covers all analysis variants', () => {
    expect(getMergeStatusMessage(makeResult({ analysis: 'clean', fastForward: true }))).toMatch(/fast-forward/);
    expect(getMergeStatusMessage(makeResult({ analysis: 'clean', fastForward: false }))).toMatch(/merged cleanly/);
    expect(getMergeStatusMessage(makeResult({ analysis: 'conflicts', hasConflicts: true, conflictFiles: ['a.txt','b.txt'] }))).toMatch(/2 file/);
    expect(getMergeStatusMessage(makeResult({ analysis: 'up-to-date', upToDate: true }))).toMatch(/already been applied/);
    expect(getMergeStatusMessage(makeResult({ analysis: 'diverged' }))).toMatch(/diverged/);
    expect(getMergeStatusMessage(makeResult({ analysis: 'error', errorMessage: 'x' }))).toMatch(/Unable to analyze merge: x/);
    // default path (should never happen): use fallback
    expect(getMergeStatusMessage({ ...makeResult({}), analysis: 'clean' })).toMatch(/merged cleanly/);
  });

  it('buildMergeMetadataEventFromAnalysis encodes outcome and content', () => {
    const result = makeResult({ analysis: 'clean', fastForward: true, canMerge: true, patchCommits: ['c1'], targetCommit: 't1', remoteCommit: 'r1' });
    const evt = buildMergeMetadataEventFromAnalysis({ repoAddr: '30617:pk:d', rootId: 'root', targetBranch: 'main', baseBranch: 'base', result });
    expect(evt.kind).toBe(30411);
    const tags: any[] = evt.tags as any;
    expect(tags.find((t: any) => t[0]==='a')?.[1]).toBe('30617:pk:d');
    expect(tags.find((t: any) => t[0]==='target-branch')?.[1]).toBe('main');
    const content = JSON.parse(evt.content);
    expect(content.fastForward).toBe(true);
    expect(content.patchCommits).toEqual(['c1']);
  });

  it('buildConflictMetadataEventFromAnalysis returns undefined when no conflicts, else includes files/details', () => {
    const no = makeResult({ analysis: 'clean', hasConflicts: false });
    expect(buildConflictMetadataEventFromAnalysis({ repoAddr: '30617:pk:d', rootId: 'root', result: no })).toBeUndefined();

    const yes = makeResult({ analysis: 'conflicts', hasConflicts: true, conflictFiles: ['x.txt'], conflictDetails: [{ file: 'x.txt', type: 'content', conflictMarkers: [] }] });
    const evt = buildConflictMetadataEventFromAnalysis({ repoAddr: '30617:pk:d', rootId: 'root', result: yes })!;
    expect(evt.kind).toBe(30412);
    expect(evt.tags.find(t => t[0]==='a')?.[1]).toBe('30617:pk:d');
    const content = JSON.parse(evt.content);
    expect(Array.isArray(content.details)).toBe(true);
  });
});
