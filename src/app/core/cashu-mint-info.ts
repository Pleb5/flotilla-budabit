import {get, writable} from "svelte/store"

const MINT_INFO_TIMEOUT_MS = 5000

export type CashuMintContact = {
  method: string
  info: string
}

export type CashuMintInfo = {
  name?: string
  pubkey?: string
  version?: string
  description?: string
  description_long?: string
  contact?: CashuMintContact[]
  motd?: string
  icon_url?: string
  urls?: string[]
  time?: number
  tos_url?: string
  nuts?: Record<string, unknown>
}

export type CashuMintInfoState = {
  status: "idle" | "loading" | "ready" | "error"
  info?: CashuMintInfo
  error?: string
}

export const cashuMintInfoByUrl = writable<Record<string, CashuMintInfoState>>({})

const pendingMintInfoLoads = new Map<string, Promise<CashuMintInfoState>>()

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === "object" && !Array.isArray(value))

const getString = (value: unknown) => (typeof value === "string" ? value.trim() : "")

export const normalizeCashuMintInfoUrl = (value: string | undefined) => {
  const trimmed = (value || "").trim()
  if (!trimmed) return ""

  try {
    const url = new URL(trimmed)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""

    url.hash = ""
    url.search = ""
    const pathname = url.pathname.replace(/\/+$/, "")

    return `${url.protocol}//${url.host}${pathname}`
  } catch {
    return ""
  }
}

export const getCashuMintInfoKey = (mintUrl: string) => normalizeCashuMintInfoUrl(mintUrl) || mintUrl

const normalizeHttpUrl = (value: unknown, baseUrl: string) => {
  const raw = getString(value)
  if (!raw) return ""

  try {
    const url = new URL(raw, baseUrl)
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""

    return url.toString()
  } catch {
    return ""
  }
}

const normalizeContact = (value: unknown): CashuMintContact[] => {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map(contact => ({method: getString(contact.method), info: getString(contact.info)}))
    .filter(contact => contact.method && contact.info)
}

const normalizeUrls = (value: unknown, baseUrl: string) => {
  if (!Array.isArray(value)) return []

  return value.map(url => normalizeHttpUrl(url, baseUrl)).filter(Boolean)
}

const normalizeMintInfo = (raw: unknown, mintUrl: string): CashuMintInfo => {
  if (!isRecord(raw)) return {}

  const iconUrl = normalizeHttpUrl(raw.icon_url, mintUrl)
  const tosUrl = normalizeHttpUrl(raw.tos_url, mintUrl)
  const contact = normalizeContact(raw.contact)
  const urls = normalizeUrls(raw.urls, mintUrl)
  const time = typeof raw.time === "number" && Number.isFinite(raw.time) ? raw.time : undefined

  return {
    name: getString(raw.name) || undefined,
    pubkey: getString(raw.pubkey) || undefined,
    version: getString(raw.version) || undefined,
    description: getString(raw.description) || undefined,
    description_long: getString(raw.description_long) || undefined,
    contact: contact.length ? contact : undefined,
    motd: getString(raw.motd) || undefined,
    icon_url: iconUrl || undefined,
    urls: urls.length ? Array.from(new Set(urls)) : undefined,
    time,
    tos_url: tosUrl || undefined,
    nuts: isRecord(raw.nuts) ? raw.nuts : undefined,
  }
}

const getMintInfoError = (error: unknown) => {
  if (error instanceof Error && error.name === "AbortError") {
    return "Mint info request timed out"
  }

  return error instanceof Error ? error.message : "Could not load mint info"
}

const fetchMintInfo = async (mintUrl: string): Promise<CashuMintInfoState> => {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MINT_INFO_TIMEOUT_MS)

  try {
    const response = await fetch(`${mintUrl}/v1/info`, {
      signal: controller.signal,
      headers: {accept: "application/json"},
    })

    if (!response.ok) throw new Error(`Mint info request failed with ${response.status}`)

    const raw = await response.json()

    return {status: "ready", info: normalizeMintInfo(raw, mintUrl)}
  } catch (error) {
    return {status: "error", error: getMintInfoError(error)}
  } finally {
    clearTimeout(timeout)
  }
}

export const loadCashuMintInfo = async (mintUrl: string): Promise<CashuMintInfoState> => {
  const key = getCashuMintInfoKey(mintUrl)
  if (!key) return {status: "error", error: "Invalid mint URL"}

  const current = get(cashuMintInfoByUrl)[key]
  if (current?.status === "ready") {
    return current
  }

  const pending = pendingMintInfoLoads.get(key)
  if (pending) return pending

  cashuMintInfoByUrl.update(state => ({...state, [key]: {status: "loading"}}))

  const request = fetchMintInfo(key).then(result => {
    cashuMintInfoByUrl.update(state => ({...state, [key]: result}))
    pendingMintInfoLoads.delete(key)

    return result
  })

  pendingMintInfoLoads.set(key, request)

  return request
}
