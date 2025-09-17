import {writable} from "svelte/store"
import type {Nip46ResponseWithResult} from "@welshman/signer"
import {Nip46Broker, makeSecret} from "@welshman/signer"
import {
  NIP46_PERMS,
  PLATFORM_URL,
  PLATFORM_NAME,
  PLATFORM_LOGO,
  SIGNER_RELAYS,
} from "@app/core/state"
import {pushToast} from "@app/util/toast"

export class Nip46Controller {
  url = writable("")
  bunker = writable("")
  loading = writable(false)
  clientSecret = makeSecret()
  abortController = new AbortController()
  broker = new Nip46Broker({clientSecret: this.clientSecret, relays: SIGNER_RELAYS})
  onNostrConnect: (response: Nip46ResponseWithResult) => void

  constructor({onNostrConnect}: {onNostrConnect: (response: Nip46ResponseWithResult) => void}) {
    this.onNostrConnect = onNostrConnect
  }

  async start() {
    const url = await this.broker.makeNostrconnectUrl({
      perms: NIP46_PERMS,
      url: PLATFORM_URL,
      name: PLATFORM_NAME,
      image: PLATFORM_LOGO,
    })

    this.url.set(url)

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
      this.onNostrConnect(response)
    }
  }

  stop() {
    this.broker.cleanup()
    this.abortController.abort()
  }
}
