export type ExpectedBuildAction = "continue" | "reload" | "recover"

export const shouldPrepareAppUpdate = ({
  remoteBuildId,
  runningBuildId,
}: {
  remoteBuildId: string
  runningBuildId: string
}) => Boolean(remoteBuildId && remoteBuildId !== runningBuildId)

export const getExpectedBuildAction = ({
  expectedBuildId,
  runningBuildId,
  controllerBuildId,
  recoveryAttempted,
}: {
  expectedBuildId: string
  runningBuildId: string
  controllerBuildId: string
  recoveryAttempted: boolean
}): ExpectedBuildAction => {
  if (!expectedBuildId || expectedBuildId === runningBuildId) return "continue"
  if (controllerBuildId === expectedBuildId && !recoveryAttempted) return "reload"
  return "recover"
}

/**
 * Cheap local reasons for a startup (auto mode) not to apply a prepared build, checked before
 * any worker messaging or network. Returns "" when none applies.
 */
export const getStartupUpdateBlocker = ({
  autoUpdate,
  visible,
  userInputSeen,
  reloadInProgress,
  broadcastPrepared,
}: {
  autoUpdate: boolean
  visible: boolean
  userInputSeen: boolean
  reloadInProgress: boolean
  broadcastPrepared: boolean
}) => {
  if (!autoUpdate) return "prompt-mode"
  if (reloadInProgress) return "reload-in-progress"
  if (!visible) return "not-visible"
  if (userInputSeen) return "user-input"
  if (broadcastPrepared) return "broadcast-prepared"
  return ""
}

/**
 * Whether a waiting worker's build may be requested at startup. The worker itself rechecks the
 * published marker and other windows at activation time. Returns "" when eligible.
 */
export const getPreparedBuildBlocker = ({
  runningBuildId,
  waitingBuildId,
  attemptedBuildId,
  startupActivation,
}: {
  runningBuildId: string
  waitingBuildId: string
  attemptedBuildId: string
  startupActivation: boolean
}) => {
  if (!waitingBuildId || waitingBuildId === runningBuildId) return "no-newer-prepared-build"
  if (!startupActivation) return "worker-without-startup-activation"
  if (attemptedBuildId === waitingBuildId) return "already-attempted"
  return ""
}

export const getErrorText = (value: unknown): string => {
  if (value instanceof Error) return `${value.message}\n${value.stack || ""}`
  if (typeof value === "string") return value

  try {
    return JSON.stringify(value) || ""
  } catch {
    return String(value)
  }
}

export const isDynamicAppShellFailure = (value: unknown) => {
  const text = getErrorText(value)
  return (
    text.includes("/_app/immutable/") &&
    /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|ChunkLoadError|Loading chunk \d+ failed/i.test(
      text,
    )
  )
}
