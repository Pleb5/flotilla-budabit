import {writable} from "svelte/store"
import type {Nip46BrokerParams, Nip46ResponseWithResult, WrappedSigner} from "@welshman/signer"
import {Nip46Broker, Nip46Signer} from "@welshman/signer"
import {Pool} from "@welshman/net"
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

// Give WebSocket/message tasks released with the foregrounded tab a chance
// to deliver before replacing the frozen socket.
export const RESUME_RESPONSE_GRACE_MS = 250

const receiverRestarts = new WeakMap<Nip46Broker, Promise<void>>()

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

// Remove signer relay sockets from the shared pool so a restarted receiver
// cannot attach to a socket that is still asynchronously closing. Android
// (especially Vanadium on GrapheneOS) can leave these sockets looking open
// after the tab was frozen in a signer app.
export const cycleSignerRelaySockets = (relays: string[], pool = Pool.get()) => {
  for (const url of relays) {
    try {
      if (!pool.has(url)) continue

      pool.remove(url)
    } catch (error) {
      console.warn("[nip46] Failed to cycle signer relay socket", url, error)
    }
  }
}

// Re-issue the receiver's kind-24133 REQ on fresh sockets. Relays used for
// signing briefly retain NIP-46 responses, so this recovers responses that
// arrived while the browser was frozen. Receiver emitter listeners survive.
export const restartNip46Receiver = (
  broker: Nip46Broker,
  pool: ReturnType<typeof Pool.get> = Pool.get(),
) => {
  const pending = receiverRestarts.get(broker)
  if (pending) return pending

  const restart = Promise.resolve()
    .then(async () => {
      const {receiver} = broker

      receiver.abortController?.abort()
      receiver.abortController = undefined
      cycleSignerRelaySockets(broker.params.relays, pool)

      await receiver.start()
    })
    .finally(() => {
      if (receiverRestarts.get(broker) === restart) receiverRestarts.delete(broker)
    })

  receiverRestarts.set(broker, restart)

  return restart
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
  await restartNip46Receiver(broker, pool)

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
  let resumeTimer: ReturnType<typeof setTimeout> | undefined

  const resume = () => {
    const resumedAt = now()
    if (resumedAt - lastResumeAt < RESUME_DEBOUNCE_MS) return

    lastResumeAt = resumedAt
    resumeTimer = setTimeout(() => {
      resumeTimer = undefined
      void recover().catch(error => {
        console.warn("[nip46] Failed to recover active signer receiver", error)
      })
    }, RESUME_RESPONSE_GRACE_MS)
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

  const onFocus = () => {
    if (document.visibilityState !== "hidden") resume()
  }
  const onOnline = () => {
    if (document.visibilityState !== "hidden") resume()
  }

  document.addEventListener("visibilitychange", onVisibilityChange)
  window.addEventListener("pageshow", onPageShow)
  window.addEventListener("focus", onFocus)
  window.addEventListener("online", onOnline)

  return () => {
    if (resumeTimer) clearTimeout(resumeTimer)
    document.removeEventListener("visibilitychange", onVisibilityChange)
    window.removeEventListener("pageshow", onPageShow)
    window.removeEventListener("focus", onFocus)
    window.removeEventListener("online", onOnline)
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

    if (!force) {
      await new Promise(resolve => setTimeout(resolve, RESUME_RESPONSE_GRACE_MS))
      if (!this.waiting || this.abortController.signal.aborted) return
    }

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
        this.hiddenAt = 0
        void this.resume()
      } else {
        this.hiddenAt = 0
      }
    }

    const onPageShow = (event: PageTransitionEvent) => {
      if (event.persisted) void this.resume()
    }

    const onFocus = () => {
      if (document.visibilityState !== "hidden") void this.resume()
    }
    const onOnline = () => {
      if (document.visibilityState !== "hidden") void this.resume()
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    window.addEventListener("pageshow", onPageShow)
    window.addEventListener("focus", onFocus)
    window.addEventListener("online", onOnline)

    this.removeResumeListeners = () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      window.removeEventListener("pageshow", onPageShow)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("online", onOnline)
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

    if (this.abortController.signal.aborted) return

    this.url.set(url)
    this.waiting = true
    this.attachResumeListeners()

    try {
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
    } finally {
      this.waiting = false
      this.removeResumeListeners?.()
    }
  }

  stop() {
    this.waiting = false
    this.removeResumeListeners?.()
    this.broker.cleanup()
    this.abortController.abort()
  }
}
