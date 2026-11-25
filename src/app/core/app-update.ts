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

export type StartupUpdateDecision = {apply: boolean; reason: string}

/**
 * Decide whether an already prepared (installed and waiting) build may replace the running
 * build before the app renders. Missing or uncertain signals keep the running build. The
 * service worker separately rechecks, at activation, that the requester is its only window.
 */
export const getStartupUpdateDecision = ({
  autoUpdate,
  visible,
  userInputSeen,
  reloadInProgress,
  broadcastPrepared,
  attemptedBuildId,
  runningBuildId,
  waitingBuildId,
  publishedBuildId,
}: {
  autoUpdate: boolean
  visible: boolean
  userInputSeen: boolean
  reloadInProgress: boolean
  broadcastPrepared: boolean
  attemptedBuildId: string
  runningBuildId: string
  waitingBuildId: string
  publishedBuildId: string
}): StartupUpdateDecision => {
  if (!autoUpdate) return {apply: false, reason: "prompt-mode"}
  if (reloadInProgress) return {apply: false, reason: "reload-in-progress"}
  if (!visible) return {apply: false, reason: "not-visible"}
  if (userInputSeen) return {apply: false, reason: "user-input"}
  if (broadcastPrepared) return {apply: false, reason: "broadcast-prepared"}
  if (!waitingBuildId || waitingBuildId === runningBuildId) {
    return {apply: false, reason: "no-newer-prepared-build"}
  }
  if (!publishedBuildId || waitingBuildId !== publishedBuildId) {
    return {apply: false, reason: "prepared-build-not-published"}
  }
  if (attemptedBuildId === waitingBuildId) return {apply: false, reason: "already-attempted"}
  return {apply: true, reason: "prepared-build-at-startup"}
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
