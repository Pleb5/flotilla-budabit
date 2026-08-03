export const REPO_OPERATION_NAVIGATION_TIMEOUT_MS = 15_000

export const isSameRepoCoordinate = ({
  currentOwner,
  currentIdentifier,
  nextOwner,
  nextIdentifier,
}: {
  currentOwner: string
  currentIdentifier: string
  nextOwner: string
  nextIdentifier: string
}) => currentOwner === nextOwner && currentIdentifier === nextIdentifier

export const waitForRepoNavigation = async (
  navigate: () => Promise<unknown>,
  timeoutMs = REPO_OPERATION_NAVIGATION_TIMEOUT_MS,
  onLateSuccess?: () => void,
) => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      reject(new Error(`Repository navigation timed out after ${Math.ceil(timeoutMs / 1000)}s`))
    }, timeoutMs)
  })
  const navigation = navigate()
  void navigation.then(
    () => {
      if (timedOut) onLateSuccess?.()
    },
    () => undefined,
  )

  try {
    await Promise.race([navigation, timeout])
  } finally {
    if (timeoutId) clearTimeout(timeoutId)
  }
}
