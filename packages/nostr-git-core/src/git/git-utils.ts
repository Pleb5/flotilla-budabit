import {
  createInvalidInputError,
  createUnknownError,
  wrapError,
  type GitErrorContext,
} from '../errors/index.js';

/**
 * Git utilities mirroring ngit functionality
 * Provides additional Git operations and helpers
 */

export interface CommitInfo {
  oid: string
  message: string
  author: {
    name: string
    email: string
    timestamp: number
    timezoneOffset: number
  }
  committer: {
    name: string
    email: string
    timestamp: number
    timezoneOffset: number
  }
  parent: string[]
  tree: string
}

export interface BranchInfo {
  name: string
  oid: string
  isRemote: boolean
}

/**
 * Read commit information in ngit format (low-level git operation)
 */
export async function readCommitInfo(git: any, oid: string): Promise<CommitInfo> {
  const commit = await git.readCommit({ oid })
  const c = commit.commit || commit
  
  return {
    oid,
    message: c.message || "",
    author: {
      name: c.author?.name || "",
      email: c.author?.email || "",
      timestamp: c.author?.timestamp || 0,
      timezoneOffset: c.author?.timezoneOffset || 0
    },
    committer: {
      name: c.committer?.name || "",
      email: c.committer?.email || "",
      timestamp: c.committer?.timestamp || 0,
      timezoneOffset: c.committer?.timezoneOffset || 0
    },
    parent: c.parent || [],
    tree: c.tree || ""
  }
}

/**
 * Get all branch information (local and remote)
 */
export async function getAllBranches(git: any): Promise<BranchInfo[]> {
  const branches: BranchInfo[] = []
  
  // Get local branches
  const localBranches = await git.listBranches({ remote: false })
  for (const branch of localBranches) {
    const oid = await git.resolveRef({ ref: branch })
    branches.push({
      name: branch,
      oid: typeof oid === "string" ? oid : oid.oid,
      isRemote: false
    })
  }
  
  // Get remote branches
  const remoteBranches = await git.listBranches({ remote: true })
  for (const branch of remoteBranches) {
    const oid = await git.resolveRef({ ref: branch })
    branches.push({
      name: branch,
      oid: typeof oid === "string" ? oid : oid.oid,
      isRemote: true
    })
  }
  
  return branches
}

/**
 * Check if repository has outstanding changes (ngit style)
 */
export async function hasOutstandingChanges(git: any): Promise<boolean> {
  try {
    const status = await git.statusMatrix()
    return status.some((row: any[]) => row[2] !== row[3]) // working !== staged
  } catch {
    return false
  }
}

/**
 * Get the root commit of a repository
 */
export async function getRootCommit(git: any, context?: GitErrorContext): Promise<string> {
  const ctx = { operation: 'getRootCommit', ...context };
  const log = await git.log({ depth: Infinity }).catch((error: unknown) => {
    throw wrapError(error, ctx);
  });
  if (log.length === 0) {
    throw createInvalidInputError('Repository has no commits', ctx);
  }
  const lastCommit = log[log.length - 1]
  return typeof lastCommit === "string" ? lastCommit : lastCommit.oid
}

/**
 * Check if a commit exists in the repository
 */
export async function doesCommitExist(git: any, oid: string): Promise<boolean> {
  try {
    await git.readCommit({ oid })
    return true
  } catch {
    return false
  }
}

/**
 * Get commit parent (first parent)
 */
export async function getCommitParent(git: any, oid: string): Promise<string | null> {
  try {
    const commit = await git.readCommit({ oid })
    const c = commit.commit || commit
    const parents = c.parent || []
    return parents.length > 0 ? parents[0] : null
  } catch {
    return null
  }
}

/**
 * Get commit message summary (first line)
 */
export async function getCommitMessageSummary(git: any, oid: string): Promise<string> {
  try {
    const commit = await git.readCommit({ oid })
    const c = commit.commit || commit
    const message = c.message || ""
    return message.split("\n")[0].trim()
  } catch {
    return ""
  }
}

/**
 * Create a patch from a commit (ngit style)
 */
export async function createPatchFromCommit(git: any, oid: string, seriesCount?: {n: number, total: number}): Promise<string> {
  const ctx: GitErrorContext = {
    operation: 'createPatchFromCommit',
    ref: oid,
  };
  try {
    const commit = await git.readCommit({ oid })
    const c = commit.commit || commit

    const subjectPrefix = seriesCount ? `PATCH ${seriesCount.n}/${seriesCount.total}` : "PATCH"
    const summary = await getCommitMessageSummary(git, oid)
    const subject = `[${subjectPrefix}] ${summary}`
    
    // Simple patch format (in a real implementation, this would use git format-patch)
    const patch = `From ${oid} Mon Sep 17 00:00:00 2001
From: ${c.author?.name || "Unknown"} <${c.author?.email || "unknown@example.com"}>
Date: ${new Date((c.author?.timestamp || 0) * 1000).toUTCString()}
Subject: ${subject}

${c.message || ""}

---\n`
    
    return patch
  } catch (error) {
    throw createUnknownError(
      `Failed to create patch from commit ${oid}: ${error instanceof Error ? error.message : String(error)}`,
      ctx,
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Check if commits are too big for patches (ngit style)
 */
export async function areCommitsTooBigForPatches(git: any, commits: string[]): Promise<boolean> {
  const maxSize = 64 * 1024 // 64KB limit as per NIP-34
  
  for (const oid of commits) {
    try {
      const patch = await createPatchFromCommit(git, oid)
      if (patch.length > maxSize) {
        return true
      }
    } catch {
      return true
    }
  }
  
  return false
}