import {browser, dev} from "$app/environment"

const CHII_QUERY_KEY = "chii"
const CHII_STORAGE_KEY = "budabit.dev.chii.enabled"
const CHII_SCRIPT_ID = "budabit-chii-target"
const DEFAULT_CHII_TARGET_URL = "https://debug.budabit.club/target.js"

const getConfiguredTargetUrl = () => {
  const configured = import.meta.env.VITE_DEV_CHII_TARGET_URL?.trim()

  return configured || DEFAULT_CHII_TARGET_URL
}

const parseChiiState = (value: string | null): boolean | undefined => {
  if (!value) return

  const normalized = value.trim().toLowerCase()

  if (["1", "true", "on", "enable", "enabled", "yes"].includes(normalized)) {
    return true
  }

  if (["0", "false", "off", "disable", "disabled", "no"].includes(normalized)) {
    return false
  }
}

const readStoredState = () => {
  try {
    return localStorage.getItem(CHII_STORAGE_KEY) === "1"
  } catch {
    return false
  }
}

const writeStoredState = (enabled: boolean) => {
  try {
    localStorage.setItem(CHII_STORAGE_KEY, enabled ? "1" : "0")
  } catch {
    // pass
  }
}

const removeTargetScript = () => {
  document.getElementById(CHII_SCRIPT_ID)?.remove()
}

const injectTargetScript = () => {
  if (document.getElementById(CHII_SCRIPT_ID)) return

  const targetUrl = getConfiguredTargetUrl()
  const script = document.createElement("script")

  script.id = CHII_SCRIPT_ID
  script.src = targetUrl
  script.async = true
  script.onerror = () => {
    console.warn("[chii-dev] Failed to load Chii target", targetUrl)
  }

  document.head.appendChild(script)
}

export const setupChiiDevInjection = () => {
  if (!browser || !dev) return

  const url = new URL(window.location.href)
  const queryState = parseChiiState(url.searchParams.get(CHII_QUERY_KEY))

  if (queryState !== undefined) {
    writeStoredState(queryState)
  }

  const enabled = queryState ?? readStoredState()

  if (!enabled) {
    removeTargetScript()
    return
  }

  injectTargetScript()
}
