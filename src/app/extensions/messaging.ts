import {get} from "svelte/store"
import {
  forceLoadMessagingRelayList,
  getMessagingRelayList,
  pubkey,
  publishThunk,
  repository,
  waitForAnyRelayAck,
} from "@welshman/app"
import {makeEvent, MESSAGING_RELAYS, type SignedEvent} from "@welshman/util"
import {verifyEvent} from "nostr-tools/pure"
import {getDmRelayUrls, getMessagingRelayHints, normalizeRelayUrls} from "@app/core/dm"
import {getUserDataPublishRelays} from "@app/core/community-relays"
import {signEventForPublication} from "@app/core/publication"
import type {
  CommunityWidgetContext,
  CommunityWidgetRuntimeContext,
  MessagingCheckRequest,
  MessagingCheckResponse,
  MessagingRelayStatus,
  MessagingUseCommunityRelayRequest,
} from "./types"

const scopeKey = (context?: CommunityWidgetContext) =>
  JSON.stringify([
    context?.definitionAddress,
    context?.viewer.pubkey,
    context?.contextSessionId,
    context?.contextVersion,
  ])
const hex = /^[0-9a-f]{64}$/
const LOAD_TIMEOUT = 8_000
const CACHE_TIME = 30_000

/** Uses the same DM lists/discovery as Chat; never substitutes a NIP-65 read/write list. */
export class ExtensionMessaging {
  private generation = 0
  private key = ""
  private loads = new Map<string, {at: number; promise: Promise<boolean>}>()
  private setup?: Promise<MessagingCheckResponse>

  constructor(
    private context: () => CommunityWidgetContext | undefined,
    private runtime: () => CommunityWidgetRuntimeContext | undefined,
  ) {}

  contextChanged() {
    if (this.key !== scopeKey(this.context())) this.close()
  }

  close() {
    this.generation++
    this.loads.clear()
    this.setup = undefined
  }

  private snapshot(payload: MessagingCheckRequest) {
    const context = this.context()
    const runtime = this.runtime()
    if (
      !context ||
      !hex.test(payload?.expectedPubkey || "") ||
      get(pubkey) !== payload.expectedPubkey ||
      context.viewer.pubkey !== payload.expectedPubkey ||
      payload.contextSessionId !== context.contextSessionId ||
      payload.contextVersion !== context.contextVersion
    ) {
      throw new Error("Account or community changed. Reopen the action.")
    }
    if (payload.recipient !== undefined && !hex.test(payload.recipient))
      throw new Error("Invalid messaging recipient.")
    const key = scopeKey(context)
    if (this.key !== key) {
      this.close()
      this.key = key
    }
    const generation = this.generation
    const current = () => {
      if (
        generation !== this.generation ||
        scopeKey(this.context()) !== key ||
        get(pubkey) !== payload.expectedPubkey
      ) {
        throw new Error("Widget closed, or account or community changed. Reopen the action.")
      }
    }
    // Only the host's exact signed definition supplies inline setup choices.
    const communityRelays =
      runtime?.definition.pointer.address === context.definitionAddress
        ? normalizeRelayUrls(runtime.definition.relays)
        : []
    return {context, communityRelays, current}
  }

  private async load(
    author: string,
    hints: string[],
    refresh = false,
  ): Promise<MessagingRelayStatus> {
    const relays = () => getDmRelayUrls(getMessagingRelayList(author))
    if (!refresh && relays().length) return {pubkey: author, status: "ready", relays: relays()}
    const key = JSON.stringify([author, hints])
    let pending = this.loads.get(key)
    if (refresh || !pending || Date.now() - pending.at > CACHE_TIME) {
      let timer: ReturnType<typeof setTimeout>
      const promise = Promise.race([
        forceLoadMessagingRelayList(author, hints).then(
          () => true,
          () => false,
        ),
        new Promise<boolean>(resolve => {
          timer = setTimeout(() => resolve(false), LOAD_TIMEOUT)
        }),
      ]).finally(() => clearTimeout(timer))
      pending = {at: Date.now(), promise}
      this.loads.set(key, pending)
    }
    const loaded = await pending.promise
    const urls = relays()
    return {
      pubkey: author,
      status: urls.length ? "ready" : loaded ? "missing" : "unavailable",
      relays: urls,
    }
  }

  async check(payload: MessagingCheckRequest): Promise<MessagingCheckResponse> {
    const {context, communityRelays, current} = this.snapshot(payload)
    const hints = normalizeRelayUrls([
      ...communityRelays,
      ...context.relays,
      ...getMessagingRelayHints(),
    ])
    const [self, recipient] = await Promise.all([
      this.load(payload.expectedPubkey, hints, payload.refresh),
      payload.recipient ? this.load(payload.recipient, hints, payload.refresh) : undefined,
    ])
    current()
    return {
      status: "ok",
      self,
      ...(recipient ? {recipient} : {}),
      communityRelays,
      contextSessionId: context.contextSessionId,
      contextVersion: context.contextVersion,
    }
  }

  useCommunityRelay(payload: MessagingUseCommunityRelayRequest) {
    this.snapshot(payload)
    if (this.setup) return this.setup
    const pending = this.configure(payload).finally(() => {
      if (this.setup === pending) this.setup = undefined
    })
    this.setup = pending
    return pending
  }

  private async configure(
    payload: MessagingUseCommunityRelayRequest,
  ): Promise<MessagingCheckResponse> {
    const {current, communityRelays} = this.snapshot(payload)
    const relay = normalizeRelayUrls([payload.relay])[0]
    if (!relay || !communityRelays.includes(relay))
      throw new Error("Choose a relay from this community's current definition.")
    const state = await this.check(payload)
    current()
    if (state.self.status === "ready") return state
    if (state.self.status !== "missing")
      throw new Error("Your DM relay list could not be checked. Retry or open messaging settings.")
    const previous = getMessagingRelayList(payload.expectedPubkey)?.event
    const template = makeEvent(MESSAGING_RELAYS, {
      content: previous?.content || "",
      tags: [...(previous?.tags || []).map(tag => [...tag]), ["relay", relay]],
      created_at: Math.max(Math.floor(Date.now() / 1000), (previous?.created_at || 0) + 1),
    })
    const event = await signEventForPublication(template)
    current()
    if (getMessagingRelayList(payload.expectedPubkey)?.event.id !== previous?.id) {
      throw new Error(
        "Your DM relay list changed while signing. Try again to use the latest settings.",
      )
    }
    if (
      !verifyEvent(event as Parameters<typeof verifyEvent>[0]) ||
      event.pubkey !== payload.expectedPubkey ||
      event.kind !== MESSAGING_RELAYS ||
      event.content !== template.content ||
      event.created_at !== template.created_at ||
      JSON.stringify(event.tags) !== JSON.stringify(template.tags)
    )
      throw new Error("The signed DM relay list did not match your request.")
    const relays = getUserDataPublishRelays([...communityRelays, ...getMessagingRelayHints()])
    // Keep failed settings out of Chat's shared store. Only resume after a real ACK.
    const thunk = publishThunk({event, relays, optimistic: false, presentation: "private"})
    try {
      await waitForAnyRelayAck(thunk, relays, {signal: AbortSignal.timeout(10_000)})
    } catch {
      thunk.controller.abort()
      throw new Error("No relay confirmed your DM settings. Try again or open messaging settings.")
    }
    current()
    repository.publish(event as SignedEvent)
    return {...state, self: {pubkey: payload.expectedPubkey, status: "ready", relays: [relay]}}
  }
}
