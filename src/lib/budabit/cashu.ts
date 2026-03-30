import {writable, get} from "svelte/store"
import type {Writable} from "svelte/store"
import {Manager, initializeCoco, ConsoleLogger, getEncodedToken} from "coco-cashu-core"
import {IndexedDbRepositories} from "coco-cashu-indexeddb"
import * as bip39 from "@scure/bip39"
import {wordlist} from "@scure/bip39/wordlists/english"
import {storageGet, storageSet} from "@lib/budabit/cashu-storage"
import {randomId} from "@welshman/lib"

// Storage keys
const KEY_MNEMONIC = "budabit_cashu_mnemonic"
const KEY_BACKUP_CONFIRMED = "budabit_cashu_backup_confirmed"
const KEY_MINTS = "budabit_cashu_mints"
const KEY_HISTORY = "budabit_cashu_history"
const KEY_AUTOPAY_WHITELIST = "budabit_cashu_autopay_whitelist"
const DB_NAME = "budabit-coco-wallet"
const HISTORY_CAP = 100

export interface TokenHistoryEntry {
  id: string
  direction: "sent" | "received" | "minted"
  amount: number
  mintUrl: string
  token?: string
  createdAt: number
  label?: string
}

// Reactive stores
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
    // Load or generate mnemonic
    const existing = await storageGet(KEY_MNEMONIC)
    if (existing) {
      _mnemonic = existing
    } else {
      _mnemonic = bip39.generateMnemonic(wordlist)
      await storageSet(KEY_MNEMONIC, _mnemonic)
    }

    // Load backup confirmed flag from storage
    const backupFlag = await storageGet(KEY_BACKUP_CONFIRMED)
    cashuBackupConfirmed.set(backupFlag === "true")

    // Load saved mints
    const mintsRaw = localStorage.getItem(KEY_MINTS)
    const savedMints: string[] = mintsRaw ? JSON.parse(mintsRaw) : []
    cashuMints.set(savedMints)

    // Load token history
    const historyRaw = localStorage.getItem(KEY_HISTORY)
    const history: TokenHistoryEntry[] = historyRaw ? JSON.parse(historyRaw) : []
    cashuTokenHistory.set(history)

    // Load auto-pay whitelist
    const whitelistRaw = localStorage.getItem(KEY_AUTOPAY_WHITELIST)
    const whitelist: string[] = whitelistRaw ? JSON.parse(whitelistRaw) : []
    cashuAutoPayWhitelist.set(whitelist)

    // Initialize IndexedDB repositories
    const repo = new IndexedDbRepositories({name: DB_NAME})
    await repo.init()

    // Initialize coco manager
    const seedGetter = async () => bip39.mnemonicToSeedSync(_mnemonic!)
    manager = await initializeCoco({
      repo,
      seedGetter,
      logger: new ConsoleLogger("coco", {level: "warn" as any}),
      watchers: {
        mintQuoteWatcher: {disabled: true},
        proofStateWatcher: {disabled: true},
      },
      processors: {
        mintQuoteProcessor: {disabled: true},
      },
    })

    // Add saved mints to coco
    for (const mintUrl of savedMints) {
      try {
        await manager.mint.addMint(mintUrl, {trusted: true})
      } catch {
        // pass — mint may already be registered
      }
    }

    cashuInitialized.set(true)
    await refreshCashuBalances()
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

export const addCashuMint = async (url: string): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")
  await manager.mint.addMint(url, {trusted: true})
  const current = get(cashuMints)
  if (!current.includes(url)) {
    const updated = [...current, url]
    cashuMints.set(updated)
    localStorage.setItem(KEY_MINTS, JSON.stringify(updated))
  }
  await refreshCashuBalances()
}

export const removeCashuMint = async (url: string): Promise<void> => {
  if (!manager) throw new Error("Wallet not initialized")
  try {
    await (manager.mint as any).removeMint(url)
  } catch {
    // pass — API may differ; remove from local list regardless
  }
  const updated = get(cashuMints).filter(m => m !== url)
  cashuMints.set(updated)
  localStorage.setItem(KEY_MINTS, JSON.stringify(updated))
  await refreshCashuBalances()
}

// ─── Balance ──────────────────────────────────────────────────────────────────

export const refreshCashuBalances = async (): Promise<void> => {
  if (!manager) return
  try {
    const balances = (await manager.wallet.getBalances()) as Record<string, number>
    const map = new Map(Object.entries(balances))
    cashuBalancesByMint.set(map)
    const total = Object.values(balances).reduce((sum, b) => sum + b, 0)
    cashuTotalBalance.set(total)
  } catch (e) {
    console.error("[cashu] Failed to refresh balances:", e)
  }
}

// ─── Token Operations ─────────────────────────────────────────────────────────

export const receiveCashuToken = async (token: string): Promise<number> => {
  if (!manager) throw new Error("Wallet not initialized")
  const before = get(cashuTotalBalance)
  await manager.wallet.receive(token)
  await refreshCashuBalances()
  const after = get(cashuTotalBalance)
  const amount = after - before

  // Determine mint from token (best-effort)
  let mintUrl = ""
  try {
    const {getDecodedToken} = await import("@cashu/cashu-ts")
    mintUrl = (getDecodedToken(token) as any).mint || ""
  } catch {
    // pass
  }

  _appendHistory({
    id: randomId(),
    direction: "received",
    amount,
    mintUrl,
    createdAt: Math.floor(Date.now() / 1000),
  })

  return amount
}

export const createCashuToken = async (
  amount: number,
  mintUrl: string,
  label?: string,
): Promise<string> => {
  if (!manager) throw new Error("Wallet not initialized")
  if (!get(cashuBackupConfirmed)) {
    throw new Error("backup_required")
  }
  const tokenData = await manager.wallet.send(mintUrl, amount)
  const token = getEncodedToken(tokenData)

  _appendHistory({
    id: randomId(),
    direction: "sent",
    amount,
    mintUrl,
    token,
    createdAt: Math.floor(Date.now() / 1000),
    label,
  })

  await refreshCashuBalances()
  return token
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

  _appendHistory({
    id: randomId(),
    direction: "minted",
    amount,
    mintUrl,
    createdAt: Math.floor(Date.now() / 1000),
  })
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

const _appendHistory = (entry: TokenHistoryEntry): void => {
  const current = get(cashuTokenHistory)
  const updated = [entry, ...current].slice(0, HISTORY_CAP)
  cashuTokenHistory.set(updated)
  localStorage.setItem(KEY_HISTORY, JSON.stringify(updated))
}
