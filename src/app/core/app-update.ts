export type ExpectedBuildAction = "continue" | "reload" | "recover"

export const shouldPrepareAppUpdate = ({
  remoteBuildId,
  runningBuildId,
  readyBuildId,
}: {
  remoteBuildId: string
  runningBuildId: string
  readyBuildId: string
}) => Boolean(remoteBuildId && remoteBuildId !== runningBuildId && remoteBuildId !== readyBuildId)

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
