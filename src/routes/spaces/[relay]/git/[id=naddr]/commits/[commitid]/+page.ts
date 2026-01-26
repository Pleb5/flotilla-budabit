import type { PageLoad } from './$types';
import { getInitializedGitWorker } from '@src/lib/budabit/worker-singleton';
import { pushToast } from '@src/app/util/toast';
import type { CommitMeta } from '@nostr-git/core/types';
import { parseRepoId } from '@nostr-git/core/utils';

export interface CommitChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  diffHunks: Array<{
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    patches: Array<{ line: string; type: '+' | '-' | ' ' }>;
  }>;
}


export const load: PageLoad = async ({ params, parent }) => {
  const { commitid } = params;
  
  try {
    // Get parent data for repo info
    const parentData = await parent();
    const { repoId, repoPubkey, repoName } = parentData;
    
    if (!repoId) {
      pushToast({
        message: 'Repository not found',
        theme: 'error',
        timeout: 5000
      });
      return;
    }

    // Convert repoId to canonical format (pubkey/name) that the worker expects
    // The layout provides "pubkey:name" format, but worker uses "pubkey/name"
    const canonicalRepoId = parseRepoId(repoId);

    // Get initialized git worker instance (with EventIO configured)
    const { api } = await getInitializedGitWorker();
    
    // Get detailed commit information including file changes
    const commitDetails = await api.getCommitDetails({
      repoId: canonicalRepoId,
      commitId: commitid
    });

    if (!commitDetails.success) {
      pushToast({
        message: commitDetails.error || 'Commit not found',
        theme: 'error',
        timeout: 5000
      });
      return;
    }

    // Create commit metadata from detailed commit data
    const commitMeta: CommitMeta = {
      sha: commitDetails.meta.sha,
      author: commitDetails.meta.author,
      email: commitDetails.meta.email,
      date: commitDetails.meta.date,
      message: commitDetails.meta.message,
      parents: commitDetails.meta.parents,
      // Placeholders to be populated when resolver is wired
      pubkey: undefined,
      nip05: undefined,
      nip39: undefined
    };

    // Convert git-worker changes to our CommitChange format
    const changes: CommitChange[] = commitDetails.changes.map((change: any) => ({
      path: change.path,
      status: change.status,
      diffHunks: change.diffHunks
    }));

    // Debug: log commit details and change summary
    try {
      console.debug('[commit/+page] Loaded commit', {
        repoId: canonicalRepoId,
        commitId: commitid,
        meta: commitMeta,
        changeCount: changes.length,
        firstChange: changes[0]
      });
    } catch (e) {
      console.debug('[commit/+page] Debug log failed (ignored)', e);
    }

    return {
      commitMeta,
      changes,
      commitid
    };
  } catch (err) {
    console.error('Error loading commit details:', err);
    pushToast({
      message: 'Failed to load commit details',
      theme: 'error',
      timeout: 5000
    });
    return;
  }
};
