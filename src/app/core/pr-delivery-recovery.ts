import type {PrDeliveryIdentity, PrDeliveryRemoteStatus} from "./pr-delivery-outcome"

export const PR_DELIVERY_RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export type PrDeliveryRecoveryRemote = {
  remote: string
  url: string
  provider: string
  selected: boolean
  primary: boolean
  status: PrDeliveryRemoteStatus
  summary?: string
  error?: string
}

export type PrDeliveryRecovery = {
  savedAt: number
  identity: PrDeliveryIdentity
  commits: string[]
  remotes: PrDeliveryRecoveryRemote[]
  appliedStatusPending: boolean
  completed: boolean
}

const isFullOid = (value: unknown) => typeof value === "string" && /^[0-9a-f]{40}$/i.test(value)
const isPubkey = (value: unknown) => typeof value === "string" && /^[0-9a-f]{64}$/i.test(value)
const remoteStatuses = new Set<PrDeliveryRemoteStatus>([
  "idle",
  "pushing",
  "confirmed",
  "skipped",
  "failed",
  "unknown",
])

export const getPrDeliveryRecoveryKey = (rootId: string, actor: string) =>
  `budabit:pr-delivery:v1:${String(rootId || "").trim()}:${String(actor || "").trim()}`

export const loadPrDeliveryRecovery = (
  storage: Pick<Storage, "getItem" | "removeItem">,
  rootId: string,
  actor: string,
  now = Date.now(),
): PrDeliveryRecovery | null => {
  const key = getPrDeliveryRecoveryKey(rootId, actor)
  try {
    const parsed = JSON.parse(storage.getItem(key) || "null") as PrDeliveryRecovery | null
    const identity = parsed?.identity
    const valid = Boolean(
      parsed &&
        Number.isFinite(parsed.savedAt) &&
        parsed.savedAt <= now &&
        now - parsed.savedAt <= PR_DELIVERY_RECOVERY_MAX_AGE_MS &&
        identity?.rootId === rootId &&
        identity?.actor === actor &&
        isFullOid(identity?.tipOid) &&
        isFullOid(identity?.targetOid) &&
        isFullOid(identity?.mergeOid) &&
        isPubkey(identity?.actor) &&
        typeof identity?.targetBranch === "string" &&
        typeof identity?.announcementId === "string" &&
        typeof identity?.primaryUrl === "string" &&
        Array.isArray(parsed.commits) &&
        parsed.commits.every(isFullOid) &&
        Array.isArray(parsed.remotes) &&
        parsed.remotes.every(
          remote =>
            remote &&
            typeof remote.url === "string" &&
            typeof remote.remote === "string" &&
            typeof remote.provider === "string" &&
            typeof remote.selected === "boolean" &&
            typeof remote.primary === "boolean" &&
            remoteStatuses.has(remote.status),
        ),
    )
    if (valid) return parsed
  } catch {
    // Invalid recovery data is discarded below.
  }
  storage.removeItem(key)
  return null
}

export const savePrDeliveryRecovery = (
  storage: Pick<Storage, "setItem">,
  recovery: PrDeliveryRecovery,
) =>
  storage.setItem(
    getPrDeliveryRecoveryKey(recovery.identity.rootId, recovery.identity.actor),
    JSON.stringify(recovery),
  )

export const clearPrDeliveryRecovery = (
  storage: Pick<Storage, "removeItem">,
  rootId: string,
  actor: string,
) => storage.removeItem(getPrDeliveryRecoveryKey(rootId, actor))
