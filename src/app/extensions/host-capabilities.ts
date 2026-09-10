import type {LoadedExtension, SmartWidgetEvent} from "./types"
import {
  MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION,
  MAX_EXTENSION_EVENTS_PER_FILTER,
  MAX_EXTENSION_SUBSCRIPTIONS,
  MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY,
} from "./extension-subscriptions"

export const HOST_CAPABILITY_SCHEMA_VERSION = 1
export const HOST_BRIDGE_PROTOCOL_VERSION = 1
export const MAX_NOSTR_QUERY_LIMIT = MAX_EXTENSION_EVENTS_PER_FILTER
export const MAX_STORAGE_KEY_LENGTH = 256
export const MAX_STORAGE_VALUE_SIZE = 1024 * 1024
export const MAX_WIDGET_RESIZE_HEIGHT = 2_400

export type BridgeHandler = (payload: any, ext: LoadedExtension) => Promise<any> | any

const bridgeHandlers = new Map<string, BridgeHandler>()

export const registerBridgeHandler = (action: string, handler: BridgeHandler) => {
  bridgeHandlers.set(action, handler)
}

export const removeBridgeHandler = (action: string) => {
  bridgeHandlers.delete(action)
}

export const getBridgeHandler = (action: string) => bridgeHandlers.get(action)

export const getRegisteredBridgeActions = () => Array.from(bridgeHandlers.keys()).sort()

export type HostCapabilitySnapshot = {
  schemaVersion: number
  protocolVersion: number
  actions: string[]
  features: Record<string, boolean | string | number>
  limits: Record<string, number>
  surface: {
    kind: "widget"
    resize: boolean
    slot?: string
  }
  media: {
    camera: boolean
    microphone: boolean
    displayCapture: boolean
  }
}

export const getHostCapabilitySnapshot = ({
  widget,
  resize = false,
  media = false,
  slot,
}: {
  widget: SmartWidgetEvent
  resize?: boolean
  media?: boolean
  slot?: string
}): HostCapabilitySnapshot => {
  const permissions = new Set(widget.permissions || [])

  return {
    schemaVersion: HOST_CAPABILITY_SCHEMA_VERSION,
    protocolVersion: HOST_BRIDGE_PROTOCOL_VERSION,
    actions: getRegisteredBridgeActions(),
    features: {
      "nostr.subscriptionBackfill": "finite-live",
      "nostr.subscriptionEose": "per-relay",
      "nostr.queryCompleteness": true,
      "nostr.expectedSigner": true,
      "nostr.declaredWriteKinds": true,
      "community.sharedConfigRefresh": true,
      "widget.theme": true,
    },
    limits: {
      nostrQueryEventsPerFilter: MAX_NOSTR_QUERY_LIMIT,
      nostrSubscriptionsPerWidget: MAX_EXTENSION_SUBSCRIPTIONS,
      nostrRelaysPerSubscription: MAX_EXTENSION_RELAYS_PER_SUBSCRIPTION,
      nostrSubscriptionsPerRelay: MAX_EXTENSION_SUBSCRIPTIONS_PER_RELAY,
      storageKeyLength: MAX_STORAGE_KEY_LENGTH,
      storageValueBytes: MAX_STORAGE_VALUE_SIZE,
      widgetResizeHeight: MAX_WIDGET_RESIZE_HEIGHT,
    },
    surface: {
      kind: "widget",
      resize,
      ...(slot ? {slot} : {}),
    },
    media: {
      camera: media && permissions.has("media:camera"),
      microphone: media && permissions.has("media:microphone"),
      displayCapture: media && permissions.has("media:display-capture"),
    },
  }
}
