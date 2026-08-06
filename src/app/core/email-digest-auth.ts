import {AuthStateEvent, AuthStatus} from "@welshman/net"
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

type EmailDigestAuthState = {
  status: AuthStatus
  on: (event: AuthStateEvent.Status, listener: (status: AuthStatus) => void) => unknown
  off: (event: AuthStateEvent.Status, listener: (status: AuthStatus) => void) => unknown
}

export const waitForEmailDigestAuth = async (auth: EmailDigestAuthState, timeoutMs = 10_000) => {
  const pending = new Set([AuthStatus.PendingSignature, AuthStatus.PendingResponse])
  if (!pending.has(auth.status)) return auth.status

  await new Promise<void>(resolve => {
    let timeout: ReturnType<typeof setTimeout>
    const finish = () => {
      clearTimeout(timeout)
      auth.off(AuthStateEvent.Status, onStatus)
      resolve()
    }
    const onStatus = (status: AuthStatus) => {
      if (!pending.has(status)) finish()
    }

    timeout = setTimeout(finish, timeoutMs)
    auth.on(AuthStateEvent.Status, onStatus)
    if (!pending.has(auth.status)) finish()
  })

  return auth.status
}
