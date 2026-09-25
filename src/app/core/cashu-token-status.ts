import {get, writable} from "svelte/store"
import {getDecodedToken, getTokenMetadata, hashToCurve, Mint, type Token} from "@cashu/cashu-ts"
import type {Manager, ReceiveOperation} from "@cashu/coco-core"
import type {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import {sha256} from "@noble/hashes/sha2.js"
import {bytesToHex} from "@noble/hashes/utils.js"
import {cashuSatsNumber} from "@app/util/cashu-amount"
import {CashuStatusCache, validCashuCheck} from "./cashu-status-cache"
import {CashuOperationLookup} from "./cashu-operation-lookup"
export {clearCashuTokenChecks} from "./cashu-status-cache"

const CHECK_INTERVAL = 60_000
export const TOKEN_MEMORY_LIMIT = 128
const TOKEN_CHARACTER_LIMIT = 500_000
const ATTEMPT_LIMIT = 256

export const canAutoCheckCashuTokens = () =>
  (typeof document === "undefined" || !document.hidden) &&
  (typeof navigator === "undefined" ||
    (navigator.onLine !== false &&
      !(navigator as Navigator & {connection?: {saveData?: boolean}}).connection?.saveData))
const hash = (value: string) => bytesToHex(sha256(new TextEncoder().encode(value)))
const mintKey = (url: string) => url.replace(/\/+$/, "")
export const cashuTokenDisplayKey = (raw: string) => hash(raw.trim().replace(/^cashu:/i, ""))

// Independent of encoding, proof order, memo, DLEQ and optional URI prefix.
export const cashuTokenIdentity = (token: Token) =>
  hash(
    JSON.stringify([
      mintKey(token.mint),
      token.unit || "sat",
      token.proofs
        .map(proof => JSON.stringify([proof.id, proof.secret, proof.C, proof.amount.toString()]))
        .sort(),
    ]),
  )

export type CashuTokenCheck = {
  state: "unspent" | "spent" | "partial" | "pending"
  checkedAt: number
  spent: number
  unspent: number
  pending: number
}
export type CashuTokenStatus = {
  id: string
  received?: {operationId: string; amount: number; at: number}
  receiving?: {operationId: string}
  outgoing?: {operationId: string; state: "created" | "spent" | "reclaimed"}
  check?: CashuTokenCheck
  checking?: boolean
  checkError?: string
}
export const cashuTokenStatuses = writable<Record<string, CashuTokenStatus>>({})

export const receiveOperationIdentity = (operation: ReceiveOperation) =>
  cashuTokenIdentity({mint: operation.mintUrl, unit: operation.unit, proofs: operation.inputProofs})

/** Wallet-scoped view of durable operations. Loading a chat card never contacts a mint. */
export class CashuTokenTracker {
  private disposed = false
  private controller = new AbortController()
  private known = new Map<string, string>()
  private knownCharacters = 0
  private attempts = new Map<string, number>()
  private observations = new Map<string, CashuTokenCheck>()
  private checks = new Map<string, Promise<void>>()
  private cache = new CashuStatusCache()
  private operations: CashuOperationLookup
  private refreshing?: Promise<void>
  private automaticTask?: Promise<void>
  private automaticGeneration = 0
  private automaticControllers = new Set<AbortController>()

  constructor(
    private manager: Manager,
    private repo: IndexedDbRepositories,
  ) {
    this.operations = new CashuOperationLookup(manager, repo, this.cache)
    if (typeof window !== "undefined") window.addEventListener("focus", this.onFocus)
    if (typeof document !== "undefined") document.addEventListener("visibilitychange", this.onFocus)
  }

  private onFocus = () => {
    if (typeof document !== "undefined" && document.hidden) return
    void this.refresh().catch(() => {})
  }
  dispose() {
    this.disposed = true
    this.controller.abort()
    this.pauseAutomaticChecks()
    this.operations.dispose()
    this.cache.close()
    this.known.clear()
    this.observations.clear()
    this.attempts.clear()
    if (typeof window !== "undefined") window.removeEventListener("focus", this.onFocus)
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.onFocus)
  }
  private assertActive() {
    if (this.disposed) throw new Error("Wallet session changed")
  }
  private update(key: string, status: CashuTokenStatus) {
    this.assertActive()
    cashuTokenStatuses.update(values => {
      const next = {...values}
      delete next[key]
      next[key] = status
      while (Object.keys(next).length > TOKEN_MEMORY_LIMIT) delete next[Object.keys(next)[0]]
      return next
    })
    return status
  }

  private remember(raw: string, key: string) {
    this.knownCharacters -= this.known.get(key)?.length || 0
    this.known.delete(key)
    if (raw.length <= TOKEN_CHARACTER_LIMIT) {
      this.known.set(key, raw)
      this.knownCharacters += raw.length
    }
    while (this.known.size > TOKEN_MEMORY_LIMIT || this.knownCharacters > TOKEN_CHARACTER_LIMIT) {
      const oldest = this.known.keys().next().value!
      this.knownCharacters -= this.known.get(oldest)!.length
      this.known.delete(oldest)
      cashuTokenStatuses.update(values => {
        const next = {...values}
        delete next[oldest]
        return next
      })
    }
  }

  findOperation(mintUrl: string, identity: string) {
    return this.operations.find(mintUrl, identity, true)
  }

  async load(raw: string): Promise<CashuTokenStatus | undefined> {
    const key = cashuTokenDisplayKey(raw)
    this.assertActive()
    this.remember(raw, key)
    const metadata = getTokenMetadata(raw)
    const mintUrl = mintKey(metadata.mint)
    const keysets = await this.repo.keysetRepository.getKeysetsByMintUrl(mintUrl)
    this.assertActive()
    // Unknown compact keysets cannot be resolved offline. Do not fetch them for a preview.
    let token: Token
    try {
      token = getDecodedToken(
        raw,
        keysets.map(k => k.id),
      )
    } catch {
      return undefined
    }
    const id = cashuTokenIdentity(token)
    const found = await this.operations.find(mintUrl, id)
    const received = found.received?.state === "finalized" ? found.received : undefined
    const receiving =
      found.received && ["prepared", "executing"].includes(found.received.state)
        ? found.received
        : undefined
    const outgoing = found.outgoing
    const persisted = await this.cache.get(id).catch(() => undefined)
    const local = this.observations.get(id)
    const check =
      local?.state === "spent" || (local && local.checkedAt > (persisted?.checkedAt || 0))
        ? local
        : persisted
    const observation = validCashuCheck(check, Date.now()) ? check : undefined
    const previous = get(cashuTokenStatuses)[key]
    const terminal = Boolean(
      received ||
      outgoing?.state === "finalized" ||
      outgoing?.state === "rolled_back" ||
      observation?.state === "spent",
    )
    return this.update(key, {
      id,
      ...(received?.state === "finalized"
        ? {
            received: {
              operationId: received.id,
              amount: cashuSatsNumber(received.amount.subtract(received.fee)),
              at: received.updatedAt,
            },
          }
        : {}),
      ...(!received && receiving ? {receiving: {operationId: receiving.id}} : {}),
      ...(outgoing
        ? {
            outgoing: {
              operationId: outgoing.id,
              state:
                outgoing.state === "finalized"
                  ? ("spent" as const)
                  : outgoing.state === "rolled_back"
                    ? ("reclaimed" as const)
                    : ("created" as const),
            },
          }
        : {}),
      check: observation,
      checking: terminal ? false : previous?.checking,
      checkError:
        terminal || (observation?.checkedAt || 0) > (previous?.check?.checkedAt || 0)
          ? undefined
          : previous?.checkError,
    })
  }

  refresh() {
    if (typeof document !== "undefined" && document.hidden) return Promise.resolve()
    if (!this.refreshing)
      this.refreshing = (async () => {
        for (const raw of [...this.known.values()]) {
          this.assertActive()
          await this.load(raw)
        }
      })().finally(() => {
        this.refreshing = undefined
      })
    return this.refreshing
  }

  /** Read-only, bounded checks. Group by mint and coalesce overlapping callers. */
  pauseAutomaticChecks() {
    this.automaticGeneration++
    for (const controller of this.automaticControllers) controller.abort()
  }

  checkMany(
    rawTokens: string[],
    mode: "automatic" | "manual" | "receive" = "automatic",
  ): Promise<void> {
    if (mode !== "automatic") return this.runChecks(rawTokens, mode)
    if (!this.automaticTask)
      this.automaticTask = this.runChecks(rawTokens.slice(0, 10), mode).finally(() => {
        this.automaticTask = undefined
      })
    return this.automaticTask
  }

  private async runChecks(rawTokens: string[], mode: "automatic" | "manual" | "receive") {
    if (mode === "automatic" && !canAutoCheckCashuTokens()) return
    const generation = this.automaticGeneration
    const groups = new Map<string, string[]>()
    for (const raw of rawTokens) {
      const mintUrl = mintKey(getTokenMetadata(raw).mint)
      groups.set(mintUrl, [...(groups.get(mintUrl) || []), raw])
    }
    // One mint at a time keeps background bursts cheap on mobile connections.
    for (const [mintUrl, tokens] of groups) {
      // Wait for an existing batch, then re-evaluate: it may cover only some of these tokens.
      const previous = this.checks.get(mintUrl)
      const task = (async () => {
        await previous
        this.assertActive()
        if (mode !== "automatic" || generation === this.automaticGeneration)
          await this.checkMint(mintUrl, tokens, mode, generation)
      })().finally(() => {
        if (this.checks.get(mintUrl) === task) this.checks.delete(mintUrl)
      })
      this.checks.set(mintUrl, task)
      await task
    }
  }

  private async checkMint(
    mintUrl: string,
    raws: string[],
    mode: "automatic" | "manual" | "receive",
    generation: number,
  ) {
    const activeView = () => generation === this.automaticGeneration && canAutoCheckCashuTokens()
    const targets = new Map<string, {raw: string; token: Token; status: CashuTokenStatus}>()
    let proofCount = 0
    for (const raw of raws) {
      if (mode === "automatic" && !activeView()) break
      const status = await this.load(raw)
      if (
        !status ||
        status.received ||
        status.check?.state === "spent" ||
        status.outgoing?.state === "spent" ||
        status.outgoing?.state === "reclaimed"
      )
        continue
      const last = Math.max(this.attempts.get(status.id) || 0, status.check?.checkedAt || 0)
      // Clicks share a just-completed check; a failed receive needs fresh evidence.
      if (Date.now() - last < (mode === "receive" ? 0 : mode === "manual" ? 1500 : CHECK_INTERVAL))
        continue
      const keysets = await this.repo.keysetRepository.getKeysetsByMintUrl(mintUrl)
      const token = getDecodedToken(
        raw,
        keysets.map(k => k.id),
      )
      if (
        token.unit !== "sat" ||
        token.proofs.length === 0 ||
        token.proofs.some(p => !/^(00|01)[a-f0-9]+$/i.test(p.id))
      )
        continue
      if (targets.has(status.id)) continue
      if (mode === "automatic" && proofCount + token.proofs.length > 1000) continue
      const interval = mode === "receive" ? 0 : mode === "manual" ? 1500 : CHECK_INTERVAL
      const claimedAt = await this.cache.claim(status.id, interval).catch(() => Date.now())
      if (claimedAt === false) continue
      this.attempts.set(status.id, claimedAt)
      if (this.attempts.size > ATTEMPT_LIMIT)
        this.attempts.delete(this.attempts.keys().next().value!)
      proofCount += token.proofs.length
      targets.set(status.id, {raw, token, status})
    }
    if (!targets.size) return
    this.assertActive()
    for (const {raw, status} of targets.values()) {
      this.update(cashuTokenDisplayKey(raw), {...status, checking: true, checkError: undefined})
    }
    const foreground = new AbortController()
    const pause = () => {
      if (!activeView()) foreground.abort()
    }
    if (mode === "automatic") this.automaticControllers.add(foreground)
    if (mode === "automatic" && typeof window !== "undefined") {
      window.addEventListener("offline", pause)
      document.addEventListener("visibilitychange", pause)
      pause()
    }
    try {
      if (!(await this.manager.mint.isTrustedMint(mintUrl))) throw new Error("Mint is not trusted")
      const yFor = (secret: string) => hashToCurve(new TextEncoder().encode(secret)).toHex(true)
      const ys = [
        ...new Set(
          [...targets.values()].flatMap(({token}) => token.proofs.map(p => yFor(p.secret))),
        ),
      ]
      const states = new Map<string, string>()
      const deadline = AbortSignal.timeout(10_000)
      const mint = new Mint(mintUrl, {
        requestFetch: (input, init) =>
          fetch(input, {
            ...init,
            signal: AbortSignal.any([
              this.controller.signal,
              deadline,
              foreground.signal,
              ...(init?.signal ? [init.signal] : []),
            ]),
          }),
      })
      for (let i = 0; i < ys.length; i += 100) {
        this.assertActive()
        if (mode === "automatic" && !activeView()) {
          foreground.abort()
          throw new Error("Check paused")
        }
        const batch = ys.slice(i, i + 100)
        const response = await mint.check({Ys: batch})
        if (response.states.length !== batch.length) throw new Error("Incomplete mint response")
        for (const state of response.states) {
          if (
            !batch.includes(state.Y) ||
            states.has(state.Y) ||
            !["UNSPENT", "SPENT", "PENDING"].includes(state.state)
          )
            throw new Error("Unexpected mint response")
          states.set(state.Y, state.state)
        }
      }
      this.assertActive()
      for (const {raw, token, status} of targets.values()) {
        const sums = {spent: 0, unspent: 0, pending: 0}
        for (const proof of token.proofs) {
          const state = states.get(yFor(proof.secret))!
          sums[state.toLowerCase() as keyof typeof sums] += cashuSatsNumber(proof.amount)
        }
        const check: CashuTokenCheck = {
          ...sums,
          checkedAt: Date.now(),
          state:
            sums.unspent === 0 && sums.pending === 0
              ? "spent"
              : sums.spent > 0
                ? "partial"
                : sums.pending > 0
                  ? "pending"
                  : "unspent",
        }
        this.observations.delete(status.id)
        this.observations.set(status.id, check)
        if (this.observations.size > TOKEN_MEMORY_LIMIT)
          this.observations.delete(this.observations.keys().next().value!)
        await this.cache.put(status.id, check).catch(() => {})
        this.update(cashuTokenDisplayKey(raw), {
          ...status,
          check,
          checking: false,
          checkError: undefined,
        })
        if (check.state === "spent" && status.outgoing?.state === "created") {
          await this.manager.ops.send.finalize(status.outgoing.operationId)
          this.assertActive()
        }
      }
    } catch {
      this.assertActive()
      for (const {raw, status} of targets.values()) {
        if (foreground.signal.aborted) {
          const at = this.attempts.get(status.id)
          if (at) await this.cache.release(status.id, at).catch(() => {})
          this.attempts.delete(status.id)
        }
        const key = cashuTokenDisplayKey(raw)
        const current = get(cashuTokenStatuses)[key]
        this.update(key, {
          ...current,
          checking: false,
          checkError: foreground.signal.aborted ? undefined : "Couldn't check status. Try again.",
        })
      }
    } finally {
      this.automaticControllers.delete(foreground)
      if (mode === "automatic" && typeof window !== "undefined") {
        window.removeEventListener("offline", pause)
        document.removeEventListener("visibilitychange", pause)
      }
    }
    await this.refresh()
  }
}
