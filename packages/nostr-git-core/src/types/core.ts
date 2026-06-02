// Canonical shared types for nostr-git
import type { NostrEvent } from "nostr-tools";

/**
 * Canonical Commit type (from core)
 */
export interface Commit {
  oid: string
  message: string
  author: {name: string; email: string; timestamp?: number}
  committer?: {name: string; email: string; timestamp?: number}
  parent?: string[]
  tree?: string
  date?: number
}

/**
 * CommitMeta: describes a commit's metadata
 */
export interface CommitMeta {
  sha: string;
  author: string;
  email: string;
  date: number;
  message: string;
  parents: string[];
  // Optional Nostr identifiers if available (reserved for future resolver wiring)
  pubkey?: string;
  nip05?: string;
  nip39?: string;
}

/**
 * FileDiff: describes a single file's diff in a commit or patch
 */
export interface FileDiff {
  path: string
  status: "added" | "modified" | "deleted" | "renamed"
  diffHunks: Array<{
    oldStart: number
    oldLines: number
    newStart: number
    newLines: number
    patches: Array<{line: string; type: "+" | "-" | " "}>
  }>
}

/**
 * CommitDiff: a commit and its file changes
 */
export interface CommitDiff {
  meta: Commit
  changes: FileDiff[]
}

/**
 * Patch: describes a generic diff/patch set returned by Git service APIs.
 * This is a draft and may need refinement based on actual usage.
 */
export interface Patch {
  id: string
  repoId: string
  title: string
  description: string
  author: {pubkey: string; name?: string}
  baseBranch: string
  commitCount: number
  commitHash: string
  createdAt: string
  status: string
  raw: any
  diff: any
  commits: Commit[]
}

/**
 * Branch: describes a branch in a repository
 */
export interface Branch {
  name: string;
  oid?: string; // commit hash
  isHead: boolean;
}

/**
 * Represents a file or directory in a Git repository.
 */
export interface FileEntry {
  /**
   * The name of the file or directory.
   */
  name: string;
  /**
   * The path of the file or directory.
   */
  path: string;
  /**
   * The type of the file or directory.
   */
  type: 'file' | 'directory' | 'submodule' | 'symlink';
  /**
   * The object ID of the file or directory, if applicable.
   */
  oid?: string;
}

/**
 * IssueThread: represents a thread of events related to an issue
 */
export type IssueThread = {
  root: NostrEvent;
  comments: NostrEvent[];
  statuses: NostrEvent[];
};

/**
 * Remote: describes a remote repository
 */
export interface Remote {
  name: string;
  url: string;
}
