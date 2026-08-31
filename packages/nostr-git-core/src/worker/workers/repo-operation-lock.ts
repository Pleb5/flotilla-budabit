const repoOperationLocks = new Map<string, Promise<void>>()

export async function withRepoOperationLock<T>(
  repoId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const key = String(repoId || "").trim()
  const previous = repoOperationLocks.get(key) || Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const queued = previous.then(() => current)
  repoOperationLocks.set(key, queued)

  await previous
  try {
    return await operation()
  } finally {
    release()
    if (repoOperationLocks.get(key) === queued) repoOperationLocks.delete(key)
  }
}
