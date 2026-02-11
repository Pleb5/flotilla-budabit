import {browser} from "$app/environment"
import {goto} from "$app/navigation"
import {get} from "svelte/store"
import {synced, localStorageProvider} from "@welshman/store"
import {WorkerManager} from "@nostr-git/ui"
import {pushToast, toast} from "@app/util/toast"
import {setGitWorkerConfig, terminateGitWorker} from "@lib/budabit/worker-singleton"

export const DEFAULT_GIT_CORS_PROXY = "https://corsproxy.budabit.club"
export const GIT_CORS_PROXY_STORAGE_KEY = "budabit/git/corsProxy"
const CORS_PROXY_TOAST_COOLDOWN_MS = 30_000
const CORS_PROXY_SETTINGS_PATH = "/settings/profile"

let lastCorsProxyToastAt = 0

export const gitCorsProxy = synced<string>({
  key: GIT_CORS_PROXY_STORAGE_KEY,
  defaultValue: "",
  storage: localStorageProvider,
})

export const normalizeGitCorsProxy = (value: string): string => {
  const trimmed = value.trim()
  if (!trimmed) return ""
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  return withScheme.replace(/\/+$/, "")
}

export const resolveGitCorsProxy = (value: string | null | undefined): string => {
  const normalized = normalizeGitCorsProxy(value ?? "")
  return normalized || DEFAULT_GIT_CORS_PROXY
}

export const setupGitCorsProxy = () => {
  let lastEffective: string | null = null

  return gitCorsProxy.subscribe(value => {
    const effective = resolveGitCorsProxy(value)
    const shouldRestart = lastEffective !== null && lastEffective !== effective
    lastEffective = effective
    WorkerManager.setGlobalGitConfig({defaultCorsProxy: effective})
    setGitWorkerConfig({defaultCorsProxy: effective})
    if (shouldRestart) {
      void WorkerManager.restartAll()
      terminateGitWorker()
    }
  })
}

const extractCorsProxyMessages = (error: unknown): string[] => {
  const messages = new Set<string>()
  const push = (value: unknown) => {
    if (typeof value === "string" && value.trim()) messages.add(value)
  }

  if (typeof error === "string") push(error)

  if (error && typeof error === "object") {
    const err = error as any
    push(err.message)
    push(err.error)
    push(err.code)
    if (err.cause) {
      push(err.cause.message)
      push(err.cause.error)
      push(err.cause.code)
    }
  }

  return Array.from(messages)
}

export const isCorsProxyIssue = (error: unknown): boolean => {
  if (!error) return false
  if (typeof error === "object" && "corsError" in (error as any)) {
    return Boolean((error as any).corsError)
  }

  const messages = extractCorsProxyMessages(error).join(" | ")
  return /cors|access-control|cross-origin|network error|failed to fetch/i.test(messages)
}

export const notifyCorsProxyIssue = (error?: unknown): void => {
  if (!browser) return
  if (error && !isCorsProxyIssue(error)) return
  const now = Date.now()
  if (now - lastCorsProxyToastAt < CORS_PROXY_TOAST_COOLDOWN_MS) return
  const currentToast = get(toast)
  if (currentToast?.message?.includes("CORS proxy")) return
  lastCorsProxyToastAt = now
  pushToast({
    theme: "warning",
    timeout: 0,
    message: "Git requests failed due to CORS/network restrictions. Check your CORS proxy setting.",
    action: {
      message: "Open settings",
      onclick: () => goto(CORS_PROXY_SETTINGS_PATH),
    },
  })
}
