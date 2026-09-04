import {canonicalRepoKey} from "../../utils/repo-id.js"

const repoOperationLocks = new Map<string, Promise<void>>()

export async function withRepoOperationLock<T>(
  repoId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const release = await acquireRepoOperationLock(repoId)
  try {
    return await operation()
  } finally {
    release()
  }
}

export async function withRepoOperationLocks<T>(
  repoIds: string[],
  operation: () => Promise<T>,
): Promise<T> {
  const keys = Array.from(new Set(repoIds.map(repoId => canonicalRepoKey(repoId)))).sort()
  const releases: Array<() => void> = []
  try {
    for (const key of keys) releases.push(await acquireRepoOperationLock(key))
    return await operation()
  } finally {
    for (const release of releases.reverse()) release()
  }
}

export async function acquireRepoOperationLock(repoId: string): Promise<() => void> {
  const key = canonicalRepoKey(String(repoId || "").trim())
  const previous = repoOperationLocks.get(key) || Promise.resolve()
  let releaseQueued!: () => void
  const current = new Promise<void>(resolve => {
    releaseQueued = resolve
  })
  const queued = previous.then(() => current)
  repoOperationLocks.set(key, queued)

  await previous
  let released = false
  return () => {
    if (released) return
    released = true
    releaseQueued()
    if (repoOperationLocks.get(key) === queued) repoOperationLocks.delete(key)
  }
}
