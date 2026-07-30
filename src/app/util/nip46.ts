import {writable} from "svelte/store"
import type {Nip46BrokerParams, Nip46ResponseWithResult, WrappedSigner} from "@welshman/signer"
import {Nip46Broker, Nip46Signer} from "@welshman/signer"
import {Pool, SocketStatus} from "@welshman/net"
import {makeSecret} from "@welshman/util"
import {
  isNip46Session,
  session as activeSession,
  signer as activeSigner,
  type Session,
} from "@welshman/app"
import {getAppMetadata, SIGNER_RELAYS} from "@app/core/state"
import {pushToast} from "@app/util/toast"

// If the tab was hidden for less than this, sockets were almost certainly not
// frozen by the OS, so skip the reconnect cycle.
export const RESUME_MIN_HIDDEN_MS = 1_000

// Don't reconnect more than once in this window, no matter how often
// visibility flaps.
export const RESUME_DEBOUNCE_MS = 3_000

export const makeBudabitNip46Broker = (params: Nip46BrokerParams) => {
  const broker = new Nip46Broker(params)
  const switchRelays = broker.switchRelays.bind(broker)

  broker.switchRelays = async () => {
    try {
      return await switchRelays()
    } catch (error) {
      console.warn("[nip46] Failed to switch relays; keeping current relay list", error)
      return broker.params.relays
    }
  }

  return broker
}

// Force-close signer relay sockets so they get re-opened with a fresh
// connection. Android (especially Vanadium on GrapheneOS) freezes WebSockets
// while the tab is backgrounded during signer approval, leaving zombie
// sockets that miss the ephemeral kind-24133 connect response.
export const cycleSignerRelaySockets = (relays: string[], pool = Pool.get()) => {
  for (const url of relays) {
    try {
      if (!pool.has(url)) continue

      const socket = pool.get(url)

      if ([SocketStatus.Open, SocketStatus.Opening].includes(socket.status)) {
        socket.close()
      }
    } catch (error) {
      console.warn("[nip46] Failed to cycle signer relay socket", url, error)
    }
  }
}

// Re-issue the receiver's kind-24133 REQ. Relays used for signing
// (e.g. relay.nsec.app, bucket.coracle.social) briefly retain nip46 responses,
// so a fresh REQ recovers a connect response that was published while the tab
// was frozen. Listeners registered on the receiver emitter are preserved.
export const restartNip46Receiver = async (broker: Nip46Broker) => {
  const {receiver} = broker

  // Aborting synchronously triggers the request's onClose, which clears
  // receiver.abortController and allows start() to create a fresh REQ.
  receiver.abortController?.abort()
  receiver.abortController = undefined

  await receiver.start()
}

export const recoverActiveNip46Receiver = async ({
  session = activeSession.get(),
  signer = activeSigner.get(),
  pool = Pool.get(),
}: {
  session?: Session
  signer?: WrappedSigner
  pool?: ReturnType<typeof Pool.get>
} = {}) => {
  if (!isNip46Session(session)) return false

  const nip46Signer = signer?.signer
  if (!(nip46Signer instanceof Nip46Signer)) return false

  const {broker} = nip46Signer
  const receiverController = broker.receiver.abortController
  if (!receiverController || receiverController.signal.aborted) return false

  cycleSignerRelaySockets(broker.params.relays, pool)
  await restartNip46Receiver(broker)

  return true
}

export const setupActiveNip46ReceiverResumeRecovery = ({
  recover = recoverActiveNip46Receiver,
  now = () => Date.now(),
}: {
  recover?: typeof recoverActiveNip46Receiver
  now?: () => number
} = {}) => {
  if (typeof document === "undefined" || typeof window === "undefined") return () => undefined

  let hiddenAt = document.visibilityState === "hidden" ? now() : 0
  let lastResumeAt = 0

  const resume = () => {
    const resumedAt = now()
    if (resumedAt - lastResumeAt < RESUME_DEBOUNCE_MS) return

    lastResumeAt = resumedAt
    void recover().catch(error => {
      console.warn("[nip46] Failed to recover active signer receiver", error)
    })
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      hiddenAt = now()
      return
    }

    if (hiddenAt && now() - hiddenAt >= RESUME_MIN_HIDDEN_MS) resume()
    hiddenAt = 0
  }

  const onPageShow = (event: PageTransitionEvent) => {
    if (event.persisted) resume()
  }

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("pageshow", onPageShow)

  return () => {
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("pageshow", onPageShow)
  }
}

export class Nip46Controller {
  url = writable("")
  bunker = writable("")
  loading = writable(false)
  resumed = writable(0)
  clientSecret = makeSecret()
  abortController = new AbortController()
  broker = makeBudabitNip46Broker({clientSecret: this.clientSecret, relays: SIGNER_RELAYS})
  onNostrConnect: (response: Nip46ResponseWithResult) => void | Promise<void>

  private waiting = false
  private hiddenAt = 0
  private lastResumeAt = 0
  private removeResumeListeners?: () => void

  constructor({
    onNostrConnect,
  }: {
    onNostrConnect: (response: Nip46ResponseWithResult) => void | Promise<void>
  }) {
    this.onNostrConnect = onNostrConnect
  }

  // Reconnect signer relay sockets and re-issue the handshake REQ. Used when
  // the tab returns to the foreground after the OS froze its sockets, and by
  // the manual "retry" affordance in the UI.
  resume = async (force = false) => {
    if (!this.waiting || this.abortController.signal.aborted) return

    const now = Date.now()

    if (!force && now - this.lastResumeAt < RESUME_DEBOUNCE_MS) return

    this.lastResumeAt = now

    cycleSignerRelaySockets(this.broker.params.relays)

    try {
      await restartNip46Receiver(this.broker)
    } catch (error) {
      console.warn("[nip46] Failed to restart signer receiver", error)
    }

    this.resumed.update(n => n + 1)
  }

  retry = () => this.resume(true)

  private attachResumeListeners() {
    if (typeof document === "undefined" || this.removeResumeListeners) return

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        this.hiddenAt = Date.now()
      } else if (this.hiddenAt && Date.now() - this.hiddenAt >= RESUME_MIN_HIDDEN_MS) {
        void this.resume()
      }
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void this.resume()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pageshow", onPageShow)

    this.removeResumeListeners = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pageshow", onPageShow)
      this.removeResumeListeners = undefined
    }
  }

  async start() {
    const appMetadata = getAppMetadata()
    const url = await this.broker.makeNostrconnectUrl({
      url: appMetadata.url,
      name: appMetadata.name,
      image: appMetadata.logo,
    })

    this.url.set(url)
    this.waiting = true
    this.attachResumeListeners()

    let response
    try {
      response = await this.broker.waitForNostrconnect(url, this.abortController.signal)
    } catch (errorResponse: any) {
      if (errorResponse?.error) {
        pushToast({
          theme: "error",
          message: `Received error from signer: ${errorResponse.error}`,
        })
      } else if (errorResponse) {
        console.error(errorResponse)
      }
    } finally {
      this.waiting = false
      this.removeResumeListeners?.()
    }

    if (response) {
      this.loading.set(true)

      try {
        await this.onNostrConnect(response)
      } catch (e) {
        console.error(e)

        pushToast({
          theme: "error",
          message: "Something went wrong, please try again!",
        })
      } finally {
        this.loading.set(false)
      }
    }
  }

  stop() {
    this.waiting = false
    this.removeResumeListeners?.()
    this.broker.cleanup()
    this.abortController.abort()
  }
}
