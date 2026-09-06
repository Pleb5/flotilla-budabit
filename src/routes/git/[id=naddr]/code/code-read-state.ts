export interface CodeReadIdentity {
  requestId: number
  repoEventId: string
  cloneUrlKey: string
  branch: string
}

export function isCurrentCodeRead(expected: CodeReadIdentity, current: CodeReadIdentity): boolean {
  return (
    expected.requestId === current.requestId &&
    expected.repoEventId === current.repoEventId &&
    expected.cloneUrlKey === current.cloneUrlKey &&
    expected.branch === current.branch
  )
}

export function shouldRestartCodeSnapshot(error: unknown): boolean {
  return (error as {code?: string} | null)?.code === "repository-snapshot-unavailable"
}
