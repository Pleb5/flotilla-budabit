import type {WidgetBridge} from '@flotilla/ext-shared'
import {eventTagValue} from './workflows'
import type {WorkflowRun} from './types'

/**
 * 72h matches the inferred-failure threshold the run list already uses to
 * hide stale pending runs from view. Reclaim eligibility for stale-pending
 * runs reuses the same predicate so the two paths stay in lockstep —
 * filtered out of view AND money returned to the wallet.
 */
export const STALE_PENDING_MS = 72 * 60 * 60 * 1000

export type ReclaimKind = 'change' | 'original'

export interface ReclaimCandidate {
  runId: string
  kind: ReclaimKind
  token: string
}

export type ReclaimFailureReason =
  | 'rate_limited'
  | 'p2pk_unsupported'
  | 'already_spent'
  | 'unknown'

export interface RedeemedEntry {
  kind: ReclaimKind
  /** sha256(token) hex — fingerprint for forensic checks; not used as a lookup key. */
  tokenHash: string
  /** Amount actually credited (omitted for already-spent dry runs). */
  amount?: number
  redeemedAt: number
}

export type RedeemedMap = Record<string, RedeemedEntry>

export interface RateLimitState {
  /** Unix ms when the cooldown lifts. 0 = not currently limited. */
  until: number
  reason?: string
}

export const STORAGE_KEY_REDEEMED = 'reclaim:redeemed'
export const STORAGE_KEY_RATE_LIMIT = 'reclaim:rateLimit'

/** Default cooldown when the mint says we're rate-limited. */
export const RATE_LIMIT_COOLDOWN_MS = 5 * 60 * 1000

export class RateLimitError extends Error {
  readonly until: number
  constructor(message: string, until: number) {
    super(message)
    this.name = 'RateLimitError'
    this.until = until
  }
}

export class P2PKUnsupportedError extends Error {
  constructor() {
    super('Token is P2PK-locked; host wallet cannot unlock without a keyring entry.')
    this.name = 'P2PKUnsupportedError'
  }
}

function isBridgeError(value: unknown): value is {error: string} {
  return !!value && typeof value === 'object' && 'error' in value && typeof (value as any).error === 'string'
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/**
 * Decide what (if anything) is reclaimable for a run.
 *
 * Pure, synchronous — safe to call from a reactive derivation. Returns null
 * when nothing is reclaimable, when the run isn't ours, or when the redeemed
 * log already covers it.
 */
export function getReclaimCandidate(
  run: WorkflowRun,
  userPubkey: string | undefined,
  redeemed: RedeemedMap,
  now: number = Date.now(),
): ReclaimCandidate | null {
  if (!userPubkey) return null
  if (run.actor !== userPubkey) return null
  if (redeemed[run.id]) return null

  const changeToken = eventTagValue(run.loomResultEvent, 'change')
  if (changeToken) {
    return {runId: run.id, kind: 'change', token: changeToken}
  }

  const paymentToken = eventTagValue(run.loomJobEvent, 'payment')
  if (!paymentToken) return null

  if (isTerminalFailure(run) || isStalePending(run, now)) {
    return {runId: run.id, kind: 'original', token: paymentToken}
  }

  return null
}

function isTerminalFailure(run: WorkflowRun): boolean {
  if (run.status !== 'failure') return false
  if (!run.loomResultEvent) return true
  const success = eventTagValue(run.loomResultEvent, 'success')
  const change = eventTagValue(run.loomResultEvent, 'change')
  return success !== 'true' && !change
}

function isStalePending(run: WorkflowRun, now: number): boolean {
  return run.status === 'pending' && now - run.createdAt > STALE_PENDING_MS
}

/**
 * Detect whether the token contains any P2PK-locked proof. Phase 1 has no
 * keyring bootstrap, so we cannot unlock these and must skip them — calling
 * the mint just produces a swap failure that wastes a request.
 */
export async function isP2PKLocked(token: string): Promise<boolean> {
  try {
    const mod = await import('@cashu/cashu-ts')
    const decoded = mod.getDecodedToken(token)
    return decoded.proofs.some(proof => {
      if (typeof proof.secret !== 'string') return false
      let parsed: unknown
      try {
        parsed = JSON.parse(proof.secret)
      } catch {
        return false
      }
      return Array.isArray(parsed) && parsed[0] === 'P2PK'
    })
  } catch {
    // If decoding fails, let the receive path produce the canonical error.
    return false
  }
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

// ─── Storage ──────────────────────────────────────────────────────────────────
// Uses the iframe's own localStorage rather than the host bridge:
//   - the host's `storage:get`/`storage:set` actions are not wired up for this
//     widget (calls were timing out / destroying the bridge).
//   - the iframe runs at a stable per-extension origin, so its localStorage
//     is naturally scoped per-user, per-extension.
//   - synchronous access keeps the read path simple; the async signatures are
//     kept so the call sites don't need to know.

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') return parsed as T
    return fallback
  } catch {
    return fallback
  }
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (err) {
    console.warn(`[reclaim] failed to persist ${key}; reclaim state will not survive a reload.`, err)
  }
}

export async function loadRedeemed(): Promise<RedeemedMap> {
  return readJSON<RedeemedMap>(STORAGE_KEY_REDEEMED, {})
}

export async function saveRedeemed(redeemed: RedeemedMap): Promise<void> {
  writeJSON(STORAGE_KEY_REDEEMED, redeemed)
}

export async function markRedeemed(
  redeemed: RedeemedMap,
  runId: string,
  entry: RedeemedEntry,
): Promise<RedeemedMap> {
  const next = {...redeemed, [runId]: entry}
  await saveRedeemed(next)
  return next
}

export async function loadRateLimit(): Promise<RateLimitState> {
  const value = readJSON<RateLimitState>(STORAGE_KEY_RATE_LIMIT, {until: 0})
  if (typeof value.until !== 'number') return {until: 0}
  return value
}

export async function saveRateLimit(state: RateLimitState): Promise<void> {
  writeJSON(STORAGE_KEY_RATE_LIMIT, state)
}

// ─── Error classification ─────────────────────────────────────────────────────

const RATE_LIMIT_PATTERN = /(429|too\s*many\s*requests|rate[\s_-]?limit)/i
const ALREADY_SPENT_PATTERN =
  /(already\s*spent|already_redeemed|TOKEN_ALREADY_SPENT|outputs\s*already\s*signed)/i

export type ClassifiedError =
  | {kind: 'rate_limit'; message: string}
  | {kind: 'already_spent'; message: string}
  | {kind: 'unknown'; message: string}

export function classifyReclaimError(error: unknown): ClassifiedError {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error'

  if (RATE_LIMIT_PATTERN.test(message)) return {kind: 'rate_limit', message}
  if (ALREADY_SPENT_PATTERN.test(message)) return {kind: 'already_spent', message}
  return {kind: 'unknown', message}
}

// ─── Receive ──────────────────────────────────────────────────────────────────

export type ReclaimReceiveResult =
  | {kind: 'redeemed'; amount: number}
  | {kind: 'already_spent'; message: string}

/**
 * Hand the token to the host wallet. Throws RateLimitError on 429-shaped
 * errors so the caller can update the global cooldown; throws the original
 * error on anything else. "Already-spent" returns rather than throws so the
 * caller can still mark the run as redeemed locally and stop attempting it.
 */
export async function receiveReclaimToken(
  bridge: WidgetBridge,
  token: string,
): Promise<ReclaimReceiveResult> {
  const result = await bridge.request('cashu:receiveToken', {token})
  if (isBridgeError(result)) {
    const classified = classifyReclaimError(result.error)
    if (classified.kind === 'rate_limit') {
      throw new RateLimitError(classified.message, Date.now() + RATE_LIMIT_COOLDOWN_MS)
    }
    if (classified.kind === 'already_spent') {
      return {kind: 'already_spent', message: classified.message}
    }
    throw new Error(classified.message)
  }

  if (result && typeof result === 'object') {
    const status = asString((result as any).status)
    const amount = (result as any).amount
    if (status === 'ok' && typeof amount === 'number') {
      return {kind: 'redeemed', amount}
    }
  }
  throw new Error('Unexpected response from cashu:receiveToken')
}
