// Commit-related git functions for @nostr-git/core
import { getGitProvider } from '../api/git-provider.js';
import { rootDir } from './git.js';
import type { Commit } from '../types/index.js';

/**
 * Get commit log for a repo/branch.
 */
export async function logCommits(opts: {
  owner: string;
  repo: string;
  branch?: string;
  depth?: number;
}): Promise<Commit[]> {
  const dir = `${rootDir}/${opts.owner}/${opts.repo}`;
  const git = getGitProvider();
  const ref = opts.branch || 'HEAD';
  const log = await git.log({ dir, ref, depth: opts.depth });
  return log.map((entry: any) => ({
    oid: entry.oid,
    message: entry.commit.message,
    author: entry.commit.author,
    committer: entry.commit.committer,
    parent: entry.commit.parent,
    tree: entry.commit.tree,
    date: entry.commit.committer?.timestamp
  }));
}

/**
 * Read a single commit by oid.
 */
export async function readCommit(opts: {
  owner: string;
  repo: string;
  oid: string;
}): Promise<Commit> {
  const dir = `${rootDir}/${opts.owner}/${opts.repo}`;
  const git = getGitProvider();
  const { commit } = await git.readCommit({ dir, oid: opts.oid });
  return {
    oid: opts.oid,
    message: commit.message,
    author: commit.author,
    committer: commit.committer,
    parent: commit.parent,
    tree: commit.tree,
    date: commit.committer?.timestamp
  };
}

/**
 * Create a new commit.
 */
export async function createCommit(opts: {
  owner: string;
  repo: string;
  message: string;
  author: { name: string; email: string };
  committer?: { name: string; email: string };
  tree: string;
  parent: string[];
}): Promise<string> {
  const dir = `${rootDir}/${opts.owner}/${opts.repo}`;
  const git = getGitProvider();
  const oid = await git.commit({
    dir,
    message: opts.message,
    author: opts.author,
    committer: opts.committer,
    tree: opts.tree,
    parent: opts.parent
  });
  return oid;
}
