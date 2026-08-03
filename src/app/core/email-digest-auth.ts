import {normalizeRelayUrl} from "@welshman/util"

let selectedProviderRelay = ""

const normalizeProviderRelay = (relay?: string) => {
  if (!relay?.trim()) return ""
  try {
    const url = new URL(relay.trim())
    if (url.protocol !== "wss:" || url.username || url.password || url.hash) return ""
    return normalizeRelayUrl(url.toString())
  } catch {
    return ""
  }
}

export const setEmailDigestAuthRelay = (relay?: string) => {
  selectedProviderRelay = normalizeProviderRelay(relay)
}

export const isEmailDigestAuthRelay = (relay: string) =>
  Boolean(selectedProviderRelay && normalizeProviderRelay(relay) === selectedProviderRelay)

export const getEmailDigestAuthRelays = () => (selectedProviderRelay ? [selectedProviderRelay] : [])

export const getPersistedEmailDigestAuthRelay = (settings: {
  enabled: boolean
  provider?: {requestRelay: string}
}) => (settings.enabled ? settings.provider?.requestRelay : undefined)

export const withTemporaryEmailDigestAuthRelay = async <T>({
  relay,
  restoreRelay,
  run,
}: {
  relay: string
  restoreRelay?: string
  run: () => Promise<T>
}) => {
  setEmailDigestAuthRelay(relay)
  try {
    return await run()
  } finally {
    setEmailDigestAuthRelay(restoreRelay)
  }
}
