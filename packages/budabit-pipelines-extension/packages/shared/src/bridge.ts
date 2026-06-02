import {
  type WidgetActionMap,
  type WidgetEventAction,
  type WidgetRequestAction,
  type WidgetWireMessage,
  WidgetWireMessageSchema,
} from './types.js';

interface PendingRequest {
  action: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

type EventHandler = (payload: unknown) => void | Promise<void>;
type RequestHandler = (payload: unknown) => unknown | Promise<unknown>;

export interface WidgetBridgeOptions {
  targetWindow?: Window | null;
  targetOrigin?: string;
  validateOrigin?: (origin: string) => boolean;
  timeoutMs?: number;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Deep copy that unwraps Proxy values (e.g. Svelte 5 `$state`) while preserving
 * structured-clone-friendly types: Date, ArrayBuffer, typed arrays, Map, Set.
 * Used as a fallback when `postMessage` rejects the original value.
 */
function deepSnapshot(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value);
  if (value instanceof ArrayBuffer) return value.slice(0);
  if (ArrayBuffer.isView(value)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const view = value as any;
    return new view.constructor(view.buffer.slice(0), view.byteOffset, view.length);
  }
  if (Array.isArray(value)) return value.map(deepSnapshot);
  if (value instanceof Map) {
    const out = new Map();
    for (const [k, v] of value) out.set(deepSnapshot(k), deepSnapshot(v));
    return out;
  }
  if (value instanceof Set) {
    const out = new Set();
    for (const v of value) out.add(deepSnapshot(v));
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(value as Record<string, unknown>)) {
    out[k] = deepSnapshot((value as Record<string, unknown>)[k]);
  }
  return out;
}

/**
 * Wraps `postMessage` with a fallback for `DataCloneError` (commonly caused by
 * Svelte 5 `$state` proxies). On failure, retries with a deep-snapshotted copy
 * and warns so the offending call site can be tracked down.
 */
function safePostMessage(target: Window, message: unknown, origin: string): void {
  try {
    target.postMessage(message, origin);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'DataCloneError') {
      console.warn(
        '[WidgetBridge] postMessage payload not cloneable, retrying with snapshot:',
        err.message,
        message,
      );
      target.postMessage(deepSnapshot(message), origin);
    } else {
      throw err;
    }
  }
}

export class WidgetBridge {
  /** Whether `signalReady()` has been called. */
  private _readySent = false;
  private targetWindow: Window;
  private targetOrigin: string;
  private validateOrigin?: (origin: string) => boolean;
  private timeoutMs: number;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private requestHandlers = new Map<string, RequestHandler>();
  private listener: ((event: MessageEvent) => void) | null = null;
  private subscriptions = new Set<string>();

  constructor(options: WidgetBridgeOptions = {}) {
    const targetWindow = options.targetWindow ?? window.parent;

    if (!targetWindow) {
      throw new Error('WidgetBridge: targetWindow is not available');
    }

    this.targetWindow = targetWindow;
    this.targetOrigin = options.targetOrigin ?? '*';
    this.validateOrigin = options.validateOrigin;
    this.timeoutMs = options.timeoutMs ?? 15000;

    this.listener = (event: MessageEvent) => {
      void this.handleMessage(event);
    };

    window.addEventListener('message', this.listener);
  }

  /**
   * Send a request to the host and await a correlated response.
   */
  request<A extends WidgetRequestAction>(
    action: A,
    payload: WidgetActionMap[A]['req']
  ): Promise<WidgetActionMap[A]['res']>;
  request(action: string, payload?: unknown): Promise<unknown>;
  request(action: string, payload?: unknown): Promise<unknown> {
    const id = makeId();

    const msg: WidgetWireMessage = {
      type: 'request',
      id,
      action,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timeoutId =
        this.timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`WidgetBridge: request timed out (${action})`));
            }, this.timeoutMs)
          : null;

      this.pending.set(id, { action, resolve, reject, timeoutId });

      try {
        safePostMessage(this.targetWindow, msg, this.targetOrigin);
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  /**
   * Register a handler for host->widget event messages (one-way).
   *
   * Returns an unsubscribe function.
   */
  onEvent<A extends WidgetEventAction>(
    action: A,
    handler: (payload: WidgetActionMap[A]['event']) => void | Promise<void>
  ): () => void;
  onEvent(action: string, handler: (payload: unknown) => void | Promise<void>): () => void;
  onEvent(action: string, handler: (payload: unknown) => void | Promise<void>): () => void {
    if (!this.eventHandlers.has(action)) {
      this.eventHandlers.set(action, new Set());
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const set = this.eventHandlers.get(action)!;
    const wrapped: EventHandler = (payload) => handler(payload);

    set.add(wrapped);

    return () => {
      set.delete(wrapped);
      if (set.size === 0) this.eventHandlers.delete(action);
    };
  }

  /**
   * Register a handler for host->widget request messages (bidirectional tool widgets).
   *
   * Returns an unsubscribe function.
   */
  onRequest<A extends WidgetRequestAction>(
    action: A,
    handler: (
      payload: WidgetActionMap[A]['req']
    ) => WidgetActionMap[A]['res'] | Promise<WidgetActionMap[A]['res']>
  ): () => void;
  onRequest(action: string, handler: (payload: unknown) => unknown | Promise<unknown>): () => void;
  onRequest(action: string, handler: (payload: unknown) => unknown | Promise<unknown>): () => void {
    const wrapped: RequestHandler = (payload) => handler(payload);
    this.requestHandlers.set(action, wrapped);

    return () => {
      const current = this.requestHandlers.get(action);
      if (current === wrapped) {
        this.requestHandlers.delete(action);
      }
    };
  }

  /**
   * Signal to the host that this extension has finished initializing.
   * The host waits for this (with a 5s fallback) before sending `widget:mounted`.
   * Call this ONCE after your initial setup is complete.
   */
  signalReady(): void {
    if (this._readySent) return;
    this._readySent = true;
    const msg: WidgetWireMessage = {
      type: 'event',
      action: 'widget:ready',
      payload: { timestamp: Date.now() },
    };
    try {
      safePostMessage(this.targetWindow, msg, this.targetOrigin);
    } catch {
      // Ignore — host may not be listening yet
    }
  }

  /**
   * Open a persistent Nostr subscription through the host bridge.
   * Returns a handle with an unsubscribe function and the subscription ID.
   *
   * @example
   * ```ts
   * const sub = await bridge.subscribe({
   *   subscriptionId: 'my-feed',
   *   relays: ['wss://relay.example.com'],
   *   filter: { kinds: [1], limit: 50 },
   * });
   *
   * bridge.onEvent('nostr:event', ({ subscriptionId, event }) => {
   *   if (subscriptionId === 'my-feed') console.log('New event:', event);
   * });
   *
   * // Later:
   * await sub.unsubscribe();
   * ```
   */
  async subscribe(payload: {
    subscriptionId: string;
    relays: string[];
    filter: Record<string, unknown>;
  }): Promise<{ subscriptionId: string; unsubscribe: () => Promise<unknown> }> {
    const res = await this.request('nostr:subscribe', payload);
    
    if (!res || typeof res !== 'object') {
      throw new Error('Invalid response from nostr:subscribe');
    }
    
    if ('error' in res) {
      throw new Error((res as { error: string }).error);
    }
    
    if (!('status' in res) || res.status !== 'ok') {
      throw new Error('Subscription failed with unknown error');
    }
    
    this.subscriptions.add(payload.subscriptionId);
    
    return {
      subscriptionId: payload.subscriptionId,
      unsubscribe: async () => {
        this.subscriptions.delete(payload.subscriptionId);
        return this.request('nostr:unsubscribe', { subscriptionId: payload.subscriptionId });
      },
    };
  }

  /**
   * Clean up event listeners and reject all pending requests.
   */
  destroy(): void {
    // Unsubscribe from all active subscriptions
    for (const subId of this.subscriptions) {
      this.request('nostr:unsubscribe', { subscriptionId: subId }).catch(() => {
        // Ignore errors during cleanup
      });
    }
    this.subscriptions.clear();

    if (this.listener) {
      window.removeEventListener('message', this.listener);
      this.listener = null;
    }

    for (const pending of this.pending.values()) {
      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      pending.reject(
        new Error(`WidgetBridge: destroyed while awaiting response (${pending.action})`)
      );
    }

    this.pending.clear();
    this.eventHandlers.clear();
    this.requestHandlers.clear();
  }

  private shouldAcceptMessage(event: MessageEvent): boolean {
    // When possible, require that the message source is our target window.
    // (This aligns with Flotilla sending from iframe.contentWindow / parent window.)
    if (event.source && event.source !== this.targetWindow) {
      return false;
    }

    // Enforce explicit origin if configured.
    if (this.targetOrigin !== '*' && event.origin !== this.targetOrigin) {
      return false;
    }

    // Allow caller-provided predicate to further restrict.
    if (this.validateOrigin && !this.validateOrigin(event.origin)) {
      return false;
    }

    return true;
  }

  private async handleMessage(event: MessageEvent): Promise<void> {
    if (!this.shouldAcceptMessage(event)) return;

    const parsed = WidgetWireMessageSchema.safeParse(event.data);
    if (!parsed.success) return;

    const msg = parsed.data as WidgetWireMessage;

    if (msg.type === 'response') {
      if (!msg.id) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;

      if (pending.timeoutId) clearTimeout(pending.timeoutId);
      this.pending.delete(msg.id);
      pending.resolve(msg.payload);
      return;
    }

    if (msg.type === 'event') {
      const handlers = this.eventHandlers.get(msg.action);
      if (!handlers || handlers.size === 0) return;

      await Promise.all(
        Array.from(handlers).map(async (h) => {
          await h(msg.payload);
        })
      );
      return;
    }

    if (msg.type === 'request') {
      const handler = this.requestHandlers.get(msg.action);
      const source = event.source as Window | null;

      if (!source) return;

      try {
        const result = handler
          ? await handler(msg.payload)
          : { error: `No handler registered for action ${msg.action}` };

        const response: WidgetWireMessage = {
          type: 'response',
          id: msg.id,
          action: msg.action,
          payload: result,
        };

        safePostMessage(source, response, event.origin);
      } catch (err) {
        const response: WidgetWireMessage = {
          type: 'response',
          id: msg.id,
          action: msg.action,
          payload: { error: err instanceof Error ? err.message : String(err) },
        };

        safePostMessage(source, response, event.origin);
      }
    }
  }
}

/**
 * Convenience factory for iframe widget usage.
 */
export function createWidgetBridge(options: WidgetBridgeOptions = {}): WidgetBridge {
  return new WidgetBridge(options);
}
