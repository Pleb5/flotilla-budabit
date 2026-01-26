import type { PageLoad } from './$types';
import { getInitializedGitWorker } from '@src/lib/budabit/worker-singleton';
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

// Note: This loader attempts to pre-load commit data, but may fail if the repo
// isn't cloned yet. The component handles loading the data itself as a fallback,
// so we don't show toasts here - just return undefined and let the component handle it.
export const load: PageLoad = async ({ params, parent }) => {
  const { commitid } = params;
  
  try {
    // Get parent data for repo info
    const parentData = await parent();
    const { repoId } = parentData;
    
    if (!repoId) {
      // No toast - component will handle this
      return { commitid };
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
      // No toast - component will handle loading the data itself
      return { commitid };
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

    return {
      commitMeta,
      changes,
      commitid
    };
  } catch (err) {
    // No toast - component will handle loading the data itself
    console.debug('[commit/+page.ts] Loader failed (component will retry):', err);
    return { commitid };
  }
};
