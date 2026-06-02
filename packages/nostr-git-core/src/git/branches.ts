import { getGitProvider } from '../api/git-provider.js';
import { rootDir } from './git.js';
import { parseRepoId } from '../utils/index.js';
import { parseRepoAnnouncementEvent, RepoAnnouncementEvent } from '../events/index.js';
import { assertRepoAnnouncementEvent } from '../events/index.js';

export interface Branch {
  name: string;
  oid?: string; // commit hash
  isHead: boolean;
}

export async function listBranchesFromEvent(opts: {
  repoEvent: RepoAnnouncementEvent;
}): Promise<Branch[]> {
  assertRepoAnnouncementEvent(opts.repoEvent);
  const repo = parseRepoAnnouncementEvent(opts.repoEvent);
  // Some repos announce only the name (e.g., "grasp") in tag d. Build a canonical key if needed.
  let canonicalKey: string;
  try {
    canonicalKey = parseRepoId(repo.repoId);
  } catch (_) {
    // Fallback: combine pubkey with repo name or repoId and canonicalize again
    const fallbackId = `${opts.repoEvent.pubkey}:${repo.name || repo.repoId}`;
    canonicalKey = parseRepoId(fallbackId);
  }

  const dir = `${rootDir}/${canonicalKey}`;
  const git = getGitProvider();
  const localBranches: string[] = await git.listBranches({ dir });
  let remoteBranches: string[] = [];
  try {
    // Attempt to include remote branches from origin (may not be supported in all providers)
    remoteBranches = await git.listBranches({ dir, remote: 'origin' });
  } catch {
    // Ignore if remote listing is unsupported or no remote configured
  }

  const all = new Set<string>();
  for (const b of localBranches) all.add(b);
  for (const rb of remoteBranches) {
    const name = rb.startsWith('origin/') ? rb.slice(7) : rb;
    all.add(name);
  }

  return Array.from(all).map((name) => ({ name, isHead: false }));
}

/**
 * List all branches in a repo.
 */
export async function listBranches(opts: { url: string; dir: string }): Promise<Branch[]> {
  const git = getGitProvider();
  const branches = await git.listBranches({ dir: opts.dir, url: opts.url });
  return branches.map((name: string) => ({ name }));
}

/**
 * Create a new branch.
 */
export async function createBranch(opts: {
  owner: string;
  repo: string;
  branch: string;
  checkout?: boolean;
}): Promise<void> {
  const dir = `${rootDir}/${opts.owner}/${opts.repo}`;
  const git = getGitProvider();
  await git.branch({ dir, ref: opts.branch, checkout: opts.checkout });
}

/**
 * Delete a branch.
 */
export async function deleteBranch(opts: {
  owner: string;
  repo: string;
  branch: string;
}): Promise<void> {
  const dir = `${rootDir}/${opts.owner}/${opts.repo}`;
  const git = getGitProvider();
  await git.deleteBranch({ dir, ref: opts.branch });
}

/**
 * Rename a branch.
 */
export async function renameBranch(opts: {
  owner: string;
  repo: string;
  oldBranch: string;
  newBranch: string;
}): Promise<void> {
  const dir = `${rootDir}/${opts.owner}/${opts.repo}`;
  const git = getGitProvider();
  await git.renameBranch({ dir, oldref: opts.oldBranch, ref: opts.newBranch });
}
