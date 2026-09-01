export type PrDeliveryRemoteStatus =
  | "idle"
  | "pushing"
  | "confirmed"
  | "skipped"
  | "failed"
  | "unknown"

export type PrDeliveryOutcome = "pending" | "complete" | "partial" | "failed" | "unknown"

export const reducePrDeliveryOutcome = (
  remotes: Array<{primary: boolean; selected: boolean; status: PrDeliveryRemoteStatus}>,
): PrDeliveryOutcome => {
  const primary = remotes.find(remote => remote.primary)
  if (!primary || !primary.selected || primary.status === "idle" || primary.status === "pushing") {
    return "pending"
  }
  if (primary.status === "confirmed") return "complete"
  if (primary.status === "unknown") return "unknown"

  return remotes.some(remote => !remote.primary && remote.status === "confirmed")
    ? "partial"
    : "failed"
}

export const orderPrimaryFirst = <T extends {primary: boolean}>(remotes: T[]): T[] => [
  ...remotes.filter(remote => remote.primary),
  ...remotes.filter(remote => !remote.primary),
]
