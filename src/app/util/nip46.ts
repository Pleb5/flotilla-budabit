import {writable} from "svelte/store"
import type {Nip46BrokerParams, Nip46ResponseWithResult} from "@welshman/signer"
import {Nip46Broker} from "@welshman/signer"
import {makeSecret} from "@welshman/util"
import {getAppMetadata, SIGNER_RELAYS} from "@app/core/state"
import {pushToast} from "@app/util/toast"

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

export class Nip46Controller {
  url = writable("")
  bunker = writable("")
  loading = writable(false)
  clientSecret = makeSecret()
  abortController = new AbortController()
  broker = makeBudabitNip46Broker({clientSecret: this.clientSecret, relays: SIGNER_RELAYS})
  onNostrConnect: (response: Nip46ResponseWithResult) => void | Promise<void>

  constructor({onNostrConnect}: {onNostrConnect: (response: Nip46ResponseWithResult) => void | Promise<void>}) {
    this.onNostrConnect = onNostrConnect
  }

  async start() {
    const appMetadata = getAppMetadata()
    const url = await this.broker.makeNostrconnectUrl({
      url: appMetadata.url,
      name: appMetadata.name,
      image: appMetadata.logo,
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
    this.broker.cleanup()
    this.abortController.abort()
  }
}
