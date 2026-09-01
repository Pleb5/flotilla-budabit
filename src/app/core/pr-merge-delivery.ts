import type {PrDeliveryIdentity, PrDeliveryOutcome} from "./pr-delivery-outcome"

export type PrRemoteDeliveryResult =
  | {status: "confirmed"; verifyMetadata?: () => Promise<void>}
  | {status: "failed"; error: unknown}
  | {status: "unknown"; error: unknown}

export const deliverPrRemote = async ({
  prepare,
  push,
  verify,
  isUnknown,
}: {
  prepare?: () => Promise<(() => Promise<void>) | undefined>
  push: () => Promise<{success: boolean; error?: unknown}>
  verify: () => Promise<void>
  isUnknown: (error: unknown) => boolean
}): Promise<PrRemoteDeliveryResult> => {
  let pushAttempted = false
  try {
    const verifyMetadata = await prepare?.()
    pushAttempted = true
    const result = await push()
    if (!result.success) throw result.error || new Error("Push failed")
    await verify()
    return {status: "confirmed", verifyMetadata}
  } catch (error) {
    if (!pushAttempted || !isUnknown(error)) return {status: "failed", error}
    try {
      await verify()
      return {status: "confirmed"}
    } catch (verificationError) {
      return isUnknown(verificationError)
        ? {status: "unknown", error}
        : {status: "failed", error: verificationError}
    }
  }
}

export const completePrDelivery = async ({
  outcome,
  identity,
  isCurrent,
  publishApplied,
  reload,
}: {
  outcome: PrDeliveryOutcome
  identity: PrDeliveryIdentity
  isCurrent: (identity: PrDeliveryIdentity) => boolean
  publishApplied: (identity: PrDeliveryIdentity) => Promise<void>
  reload: () => void
}): Promise<"skipped" | "acked" | "pending"> => {
  if (outcome !== "complete" || !isCurrent(identity)) return "skipped"
  try {
    await publishApplied(identity)
    if (!isCurrent(identity)) return "skipped"
    reload()
    return "acked"
  } catch {
    return "pending"
  }
}
