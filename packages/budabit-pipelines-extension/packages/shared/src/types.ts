import { z } from 'zod';
import type { Event as NostrEvent } from 'nostr-tools';

export type { NostrEvent };

/**
 * Shared types for Flotilla Smart Widgets (kind 30033) and the Flotilla host bridge.
 *
 * Flotilla's host runtime communicates with iframe widgets via an action-based postMessage protocol:
 *   { type: 'request'|'response'|'event', action: string, payload?: any, id?: string }
 *
 * Extensions depend ONLY on nostr-tools (no welshman). All relay operations go through the bridge.
 *
 * Host Bridge Actions (request → response):
 *   nostr:publish       — sign and publish a Nostr event
 *   nostr:query          — one-shot query (returns events after EOSE)
 *   nostr:subscribe      — open a persistent relay subscription
 *   nostr:unsubscribe    — close a persistent relay subscription
 *   storage:get          — get a value from per-extension storage
 *   storage:set          — set a value in per-extension storage
 *   storage:remove       — remove a key from per-extension storage
 *   storage:keys         — list all keys in per-extension storage
 *   context:getRepo      — get the current repo context (if available)
 *   ui:toast             — show a toast notification in the host UI
 *   ui:resize            — request the host to resize the extension iframe
 *
 * Host → Extension Events (one-way):
 *   widget:init          — initial context (pubkey, relays, host version, etc.)
 *   widget:mounted       — extension iframe is fully loaded and ready
 *   widget:unmounting     — extension is about to be removed
 *   context:repoUpdate   — repo context has changed (for repo-scoped extensions)
 *   context:update       — @deprecated alias for context:repoUpdate (will be removed in v2.0)
 *   nostr:event          — a new event from a nostr:subscribe subscription
 *   nostr:eose           — end of stored events for a subscription
 *
 * Extension → Host Events (one-way):
 *   widget:ready         — extension signals it has finished initializing
 */

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Unsigned event template (before signing).
 * The host signs and adds pubkey/id/sig before publishing.
 */
export type UnsignedEvent = {
  kind: number;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey?: string;
};

export const UnsignedEventSchema = z.object({
  kind: z.number(),
  content: z.string(),
  tags: z.array(z.array(z.string())),
  created_at: z.number(),
  pubkey: z.string().optional(),
});

/**
 * Host-provided context delivered via `widget:init`.
 */
export type WidgetInitPayload = {
  pubkey?: string;
  relays?: string[];
  hostVersion?: string;
  extensionId?: string;
  repo?: RepoContext;
  [k: string]: unknown;
};

/**
 * Repo context delivered via `context:repoUpdate` for repo-scoped extensions.
 */
export type RepoContext = {
  repoPubkey: string;
  repoName: string;
  repoNaddr?: string;
  repoRelays: string[];
  maintainers?: string[];
};

/**
 * @deprecated Use WidgetInitPayload instead. Kept for backward compatibility.
 */
export type WidgetContext = {
  contextId?: string;
  userPubkey?: string;
  relays?: string[];
  [k: string]: unknown;
};

export const WidgetContextSchema = z
  .object({
    contextId: z.string().optional(),
    userPubkey: z.string().optional(),
    relays: z.array(z.string()).optional(),
  })
  .catchall(z.unknown());

// ---------------------------------------------------------------------------
// Bridge error
// ---------------------------------------------------------------------------

export type BridgeError = {
  error: string;
};

// ---------------------------------------------------------------------------
// Action payloads
// ---------------------------------------------------------------------------

// --- nostr:publish ---

export type NostrPublishRequest = UnsignedEvent;
export type NostrPublishResponse = { status: 'ok'; result?: unknown } | BridgeError;

// --- nostr:query ---

export type NostrQueryRequest = {
  relays: string[];
  filter: Record<string, unknown>;
};
export type NostrQueryResponse =
  | { status: 'ok'; events: NostrEvent[] }
  | { status: 'timeout'; events: NostrEvent[] }
  | BridgeError;

// --- nostr:subscribe ---

export type NostrSubscribeRequest = {
  subscriptionId: string;
  relays: string[];
  filter: Record<string, unknown>;
};
export type NostrSubscribeResponse = { status: 'ok'; subscriptionId: string } | BridgeError;

// --- nostr:unsubscribe ---

export type NostrUnsubscribeRequest = {
  subscriptionId: string;
};
export type NostrUnsubscribeResponse = { status: 'ok' } | BridgeError;

// --- nostr:event (host → extension push) ---

export type NostrSubscriptionEvent = {
  subscriptionId: string;
  event: NostrEvent;
};

// --- nostr:eose (host → extension push) ---

export type NostrSubscriptionEose = {
  subscriptionId: string;
  relay?: string;
};

// --- storage:get ---

export type StorageGetRequest = { key: string };
export type StorageGetResponse = { status: 'ok'; value: unknown } | BridgeError;

// --- storage:set ---

export type StorageSetRequest = { key: string; value: unknown };
export type StorageSetResponse = { status: 'ok' } | BridgeError;

// --- storage:remove ---

export type StorageRemoveRequest = { key: string };
export type StorageRemoveResponse = { status: 'ok' } | BridgeError;

// --- storage:keys ---

export type StorageKeysRequest = Record<string, never>;
export type StorageKeysResponse = { status: 'ok'; keys: string[] } | BridgeError;

// --- context:getRepo ---

export type ContextGetRepoRequest = Record<string, never>;
export type ContextGetRepoResponse = { status: 'ok'; repo: RepoContext | null } | BridgeError;

// --- ui:toast ---

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export type UiToastRequest = {
  message: string;
  type?: ToastType;
};
export type UiToastResponse = { status: 'ok' } | BridgeError;

// --- ui:resize ---

export type UiResizeRequest = { height?: number; width?: number };
export type UiResizeResponse = { status: 'ok' } | BridgeError;

// ---------------------------------------------------------------------------
// Action map (all supported bridge actions)
// ---------------------------------------------------------------------------

export interface WidgetActionMap {
  // Request → Response actions
  'nostr:publish': {
    req: NostrPublishRequest;
    res: NostrPublishResponse;
  };

  'nostr:query': {
    req: NostrQueryRequest;
    res: NostrQueryResponse;
  };

  'ui:toast': {
    req: UiToastRequest;
    res: UiToastResponse;
  };
  'ui:resize': {
    req: UiResizeRequest;
    res: UiResizeResponse;
  };

  // Host → Extension events (one-way)
  'widget:init': {
    event: WidgetInitPayload;
  };
  'widget:mounted': {
    event: { timestamp: number };
  };
  'widget:unmounting': {
    event: { timestamp: number };
  };

  // Extension → Host events (one-way)
  'widget:ready': {
    event: { timestamp: number };
  };
  'context:repoUpdate': {
    event: RepoContext & { contextId?: string; userPubkey?: string; relays?: string[] };
  };
  /** @deprecated Use context:repoUpdate instead */
  'context:update': {
    event: WidgetContext;
  };
  'nostr:event': {
    event: NostrSubscriptionEvent;
  };
  'nostr:eose': {
    event: NostrSubscriptionEose;
  };
}

export type WidgetAction = keyof WidgetActionMap;

export type WidgetRequestAction = {
  [K in WidgetAction]: 'req' extends keyof WidgetActionMap[K] ? K : never;
}[WidgetAction];

export type WidgetResponseAction = {
  [K in WidgetAction]: 'res' extends keyof WidgetActionMap[K] ? K : never;
}[WidgetAction];

export type WidgetEventAction = {
  [K in WidgetAction]: 'event' extends keyof WidgetActionMap[K] ? K : never;
}[WidgetAction];

// ---------------------------------------------------------------------------
// Wire message shapes (compatible with Flotilla host bridge)
// ---------------------------------------------------------------------------

export type WidgetRequestMessage<A extends WidgetRequestAction = WidgetRequestAction> = {
  type: 'request';
  id: string;
  action: A;
  payload?: WidgetActionMap[A]['req'];
};

export type WidgetResponseMessage<A extends WidgetResponseAction = WidgetResponseAction> = {
  type: 'response';
  id: string;
  action: A;
  payload?: WidgetActionMap[A]['res'];
};

export type WidgetEventMessage<A extends WidgetEventAction = WidgetEventAction> = {
  type: 'event';
  action: A;
  payload?: WidgetActionMap[A]['event'];
};

/**
 * Fallback wire message (for host/client extensions beyond WidgetActionMap).
 */
export type WidgetUnknownMessage =
  | {
      type: 'request' | 'response';
      action: string;
      payload?: unknown;
      id: string;
    }
  | {
      type: 'event';
      action: string;
      payload?: unknown;
      id?: never;
    };

export type WidgetWireMessage =
  | WidgetRequestMessage
  | WidgetResponseMessage
  | WidgetEventMessage
  | WidgetUnknownMessage;

export const WidgetRequestMessageSchema = z.object({
  type: z.literal('request'),
  id: z.string(),
  action: z.string(),
  payload: z.unknown().optional(),
});

export const WidgetResponseMessageSchema = z.object({
  type: z.literal('response'),
  id: z.string(),
  action: z.string(),
  payload: z.unknown().optional(),
});

export const WidgetEventMessageSchema = z.object({
  type: z.literal('event'),
  action: z.string(),
  payload: z.unknown().optional(),
});

export const WidgetWireMessageSchema = z.union([
  WidgetRequestMessageSchema,
  WidgetResponseMessageSchema,
  WidgetEventMessageSchema,
]);

// ---------------------------------------------------------------------------
// Smart Widget Nostr event (kind 30033)
// ---------------------------------------------------------------------------

export type SmartWidgetNostrEvent = {
  kind: 30033;
  content: string;
  tags: string[][];
  created_at: number;
  pubkey?: string;
  id?: string;
  sig?: string;
};

export const SmartWidgetNostrEventSchema = z.object({
  kind: z.literal(30033),
  content: z.string(),
  tags: z.array(z.array(z.string())),
  created_at: z.number(),
  pubkey: z.string().optional(),
  id: z.string().optional(),
  sig: z.string().optional(),
});

/**
 * Convenience type for permissions declared in widget tags.
 * Flotilla's host enforces these by comparing against requested actions.
 */
export type WidgetPermission = 'nostr:publish' | 'nostr:query' | 'ui:toast' | (string & {});
