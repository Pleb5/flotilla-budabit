import {writable, get} from "svelte/store"
import type {Writable} from "svelte/store"
import {
  Manager,
  initializeCoco,
  ConsoleLogger,
  getEncodedToken,
  getDecodedToken,
} from "@cashu/coco-core"
import type {HistoryEntry} from "@cashu/coco-core"
import {IndexedDbRepositories} from "@cashu/coco-indexeddb"
import * as bip39 from "@scure/bip39"
import {wordlist} from "@scure/bip39/wordlists/english"
import {storageGet, storageSet} from "@lib/budabit/cashu-storage"

const KEY_MNEMONIC = "budabit_cashu_mnemonic"
const KEY_BACKUP_CONFIRMED = "budabit_cashu_backup_confirmed"
const KEY_AUTOPAY_WHITELIST = "budabit_cashu_autopay_whitelist"
const DB_NAME = "budabit-coco-wallet"
const HISTORY_PAGE_SIZE = 100

export interface TokenHistoryEntry {
  id: string
  direction: "sent" | "received" | "minted"
  amount: number
  mintUrl: string
  token?: string
  createdAt: number
}

export const cashuInitialized: Writable<boolean> = writable(false)
export const cashuBackupConfirmed: Writable<boolean> = writable(false)
export const cashuTotalBalance: Writable<number> = writable(0)
export const cashuBalancesByMint: Writable<Map<string, number>> = writable(new Map())
export const cashuMints: Writable<string[]> = writable([])
export const cashuTokenHistory: Writable<TokenHistoryEntry[]> = writable([])
export const cashuAutoPayWhitelist: Writable<string[]> = writable([])

// Internal manager reference
let manager: Manager | null = null
let _mnemonic: string | null = null

// ─── Initialization ───────────────────────────────────────────────────────────

let _initPromise: Promise<void> | null = null

export const initializeCashuWallet = (): Promise<void> => {
  if (_initPromise) return _initPromise
  _initPromise = _doInitialize()
  return _initPromise
}

const _doInitialize = async (): Promise<void> => {
  try {
    const existing = await storageGet(KEY_MNEMONIC)
    if (existing) {
      _mnemonic = existing
    } else {
      _mnemonic = bip39.generateMnemonic(wordlist)
      await storageSet(KEY_MNEMONIC, _mnemonic)
    }

    const backupFlag = await storageGet(KEY_BACKUP_CONFIRMED)
    cashuBackupConfirmed.set(backupFlag === "true")

    const whitelistRaw = localStorage.getItem(KEY_AUTOPAY_WHITELIST)
    const whitelist: string[] = whitelistRaw ? JSON.parse(whitelistRaw) : []
    cashuAutoPayWhitelist.set(whitelist)

    const repo = new IndexedDbRepositories({name: DB_NAME})
    await repo.init()

    const seedGetter = async () => bip39.mnemonicToSeedSync(_mnemonic!)
    manager = await initializeCoco({
      repo,
      seedGetter,
      logger: new ConsoleLogger("coco", {level: "warn" as any}),
      watchers: {
        mintOperationWatcher: {disabled: true},
        proofStateWatcher: {disabled: true},
      },
      processors: {
        mintOperationProcessor: {disabled: true},
      },
    })

    manager.on("mint:added", refreshCashuMints)
    manager.on("mint:trusted", refreshCashuMints)
    manager.on("mint:untrusted", refreshCashuMints)
    manager.on("mint:updated", refreshCashuMints)
    manager.on("history:updated", refreshCashuHistory)
    manager.on("proofs:saved", refreshCashuBalances)
    manager.on("proofs:deleted", refreshCashuBalances)
    manager.on("proofs:wiped", refreshCashuBalances)

    cashuInitialized.set(true)
    await Promise.all([refreshCashuMints(), refreshCashuHistory(), refreshCashuBalances()])
  } catch (e) {
    console.error("[cashu] Failed to initialize wallet:", e)
  }
}

// ─── Mnemonic / Backup ────────────────────────────────────────────────────────

export const getCashuMnemonic = (): string => {
  if (!_mnemonic) throw new Error("Wallet not initialized")
  return _mnemonic
}

export const confirmCashuBackup = async (): Promise<void> => {
  await storageSet(KEY_BACKUP_CONFIRMED, "true")
  cashuBackupConfirmed.set(true)
}

// ─── Mint Management ──────────────────────────────────────────────────────────

const refreshCashuMints = async (): Promise<void> => {
  if (!manager) return
  try {
    const mints = await manager.mint.getAllTrustedMints()
    cashuMints.set(mints.map(m => m.mintUrl))
  } catch (e) {
    console.error("[cashu] Failed to refresh mints:", e)
  }
}

export const addCashuMint = async (url: string): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")
  await manager.mint.addMint(url, {trusted: true})
  // mint:added / mint:trusted events drive the store refresh
}

export class UntrustedMintError extends Error {
  readonly code = "untrusted_mint" as const
  constructor(public readonly mintUrl: string) {
    super(`Mint ${mintUrl} is not trusted`)
    this.name = "UntrustedMintError"
  }
}

/**
 * Cancels any in-flight receive operations for the mint and runs a deterministic
 * restore. Use after the mint returns "outputs already signed" — the wallet's
 * counter has drifted past proofs the mint signed, and restore reclaims them.
 */
export const recoverCashuMint = async (mintUrl: string): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")
  const inFlight = await manager.ops.receive.listInFlight()
  for (const op of inFlight) {
    if (op.mintUrl === mintUrl) {
      try {
        await manager.ops.receive.cancel(op.id)
      } catch (e) {
        console.warn("[cashu] Failed to cancel stuck receive op:", e)
      }
    }
  }
  await manager.wallet.restore(mintUrl)
  await refreshCashuBalances()
}

export const trustCashuMint = async (url: string): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")
  await manager.mint.addMint(url, {trusted: true})
  // mint:added / mint:trusted events drive the store refresh
}

export const removeCashuMint = async (url: string): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")
  await manager.mint.untrustMint(url)
  // mint:untrusted event drops it from the trusted-mints store
}

// ─── Balance ──────────────────────────────────────────────────────────────────

export const refreshCashuBalances = async (): Promise<void> => {
  if (!manager) return
  try {
    const byMint = await manager.wallet.balances.byMint()
    const map = new Map(Object.entries(byMint).map(([url, snap]) => [url, snap.total]))
    cashuBalancesByMint.set(map)
    const {total} = await manager.wallet.balances.total()
    cashuTotalBalance.set(total)
  } catch (e) {
    console.error("[cashu] Failed to refresh balances:", e)
  }
}

// ─── Token Operations ─────────────────────────────────────────────────────────

export const receiveCashuToken = async (token: string): Promise<number> => {
  if (!manager) throw new Error("Wallet not initialized")

  let mintUrl = ""
  try {
    mintUrl = (getDecodedToken(token) as any).mint || ""
  } catch {
    // pass — let manager.wallet.receive surface the decode error
  }

  if (mintUrl && !(await manager.mint.isTrustedMint(mintUrl))) {
    throw new UntrustedMintError(mintUrl)
  }

  const before = get(cashuTotalBalance)
  await manager.wallet.receive(token)
  await refreshCashuBalances()
  const after = get(cashuTotalBalance)
  return after - before
}

export const createCashuToken = async (amount: number, mintUrl: string): Promise<string> => {
  if (!manager) throw new Error("Wallet not initialized")
  if (!get(cashuBackupConfirmed)) {
    throw new Error("backup_required")
  }
  const prepared = await manager.ops.send.prepare({mintUrl, amount})
  const {token: tokenData} = await manager.ops.send.execute(prepared)
  await refreshCashuBalances()
  return getEncodedToken(tokenData)
}

// ─── Lightning Top-up ─────────────────────────────────────────────────────────

export const requestMintQuote = async (
  mintUrl: string,
  amount: number,
): Promise<{quote: string; request: string}> => {
  const {Wallet} = await import("@cashu/cashu-ts")
  const wallet = new Wallet(mintUrl)
  await wallet.loadMint()
  const quoteResponse = await wallet.createMintQuote(amount)
  return {quote: quoteResponse.quote, request: quoteResponse.request}
}

export const checkMintQuote = async (
  mintUrl: string,
  quote: string,
): Promise<"paid" | "unpaid" | "expired"> => {
  const {Wallet} = await import("@cashu/cashu-ts")
  const wallet = new Wallet(mintUrl)
  const status = await wallet.checkMintQuote(quote)
  if (status.state === "PAID" || status.state === "ISSUED") return "paid"
  return "unpaid"
}

export const mintTokensFromQuote = async (
  mintUrl: string,
  quote: string,
  amount: number,
): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")
  if (!get(cashuBackupConfirmed)) {
    throw new Error("backup_required")
  }
  const {Wallet, getEncodedToken: encodeToken} = await import("@cashu/cashu-ts")
  const wallet = new Wallet(mintUrl)
  await wallet.loadMint()
  const proofs = await wallet.mintProofs(amount, quote)
  const token = encodeToken({mint: mintUrl, proofs})
  await manager.wallet.receive(token)
  await refreshCashuBalances()
}

// ─── Auto-pay Whitelist ───────────────────────────────────────────────────────

export const addAutoPayWhitelist = (extensionId: string): void => {
  const current = get(cashuAutoPayWhitelist)
  if (!current.includes(extensionId)) {
    const updated = [...current, extensionId]
    cashuAutoPayWhitelist.set(updated)
    localStorage.setItem(KEY_AUTOPAY_WHITELIST, JSON.stringify(updated))
  }
}

export const removeAutoPayWhitelist = (extensionId: string): void => {
  const updated = get(cashuAutoPayWhitelist).filter(id => id !== extensionId)
  cashuAutoPayWhitelist.set(updated)
  localStorage.setItem(KEY_AUTOPAY_WHITELIST, JSON.stringify(updated))
}

// ─── History ──────────────────────────────────────────────────────────────────

const mapHistoryEntry = (entry: HistoryEntry): TokenHistoryEntry | null => {
  const base = {
    id: entry.id,
    mintUrl: entry.mintUrl,
    amount: (entry as any).amount ?? 0,
    createdAt: entry.createdAt,
  }
  switch (entry.type) {
    case "send":
      return {
        ...base,
        direction: "sent",
        token: entry.token ? getEncodedToken(entry.token) : undefined,
      }
    case "receive":
      return {...base, direction: "received"}
    case "mint":
      return {...base, direction: "minted"}
    case "melt":
      return {...base, direction: "sent"}
    default:
      return null
  }
}

const refreshCashuHistory = async (): Promise<void> => {
  if (!manager) return
  try {
    const entries = await manager.history.getPaginatedHistory(0, HISTORY_PAGE_SIZE)
    cashuTokenHistory.set(entries.map(mapHistoryEntry).filter((e): e is TokenHistoryEntry => !!e))
  } catch (e) {
    console.error("[cashu] Failed to refresh history:", e)
  }
}
