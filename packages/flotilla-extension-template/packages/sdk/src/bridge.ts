import {
  type WidgetActionMap,
  type WidgetEventAction,
  type WidgetRequestAction,
  type WidgetWireMessage,
  type CommunityWidgetContext,
  type WidgetVisibility,
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
        this.targetWindow.postMessage(msg, this.targetOrigin);
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
      this.targetWindow.postMessage(msg, this.targetOrigin);
    } catch {
      // Ignore — host may not be listening yet
    }
  }

  /**
   * Report a visibility decision for the exact context used to make it.
   * Check init.capabilities.surface.visibility before calling. Only inline
   * community surfaces declaring visibility=widget accept this action.
   * This does not grant access, resize the iframe, or signal content readiness.
   */
  setVisibility(visibility: WidgetVisibility, context: CommunityWidgetContext) {
    return this.request('ui:setVisibility', {
      visibility,
      contextSessionId: context.contextSessionId,
      contextVersion: context.contextVersion,
    });
  }

  /**
   * Open a persistent Nostr subscription through the host bridge.
   * Returns a handle with an unsubscribe function and the subscription ID.
   *
   * @example
   * ```ts
   * const sub = await bridge.subscribe({
   *   relays: ['wss://relay.example.com'],
   *   filter: { kinds: [1], limit: 50 },
   * });
   *
   * bridge.onEvent('nostr:subscription:event', ({ subscriptionId, event }) => {
   *   if (subscriptionId === sub.subscriptionId) console.log('New event:', event);
   * });
   *
   * // Later:
   * await sub.unsubscribe();
   * ```
   */
  async subscribe(
    payload: WidgetActionMap['nostr:subscribe']['req']
  ): Promise<{ subscriptionId: string; unsubscribe: () => Promise<unknown> }> {
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
    if (!('subscriptionId' in res) || typeof res.subscriptionId !== 'string') {
      throw new Error('Invalid response from nostr:subscribe');
    }

    const subscriptionId = res.subscriptionId;
    this.subscriptions.add(subscriptionId);

    return {
      subscriptionId,
      unsubscribe: async () => {
        this.subscriptions.delete(subscriptionId);
        return this.request('nostr:unsubscribe', { subscriptionId });
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
    // (This aligns with BudaBit sending from iframe.contentWindow / parent window.)
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

        source.postMessage(response, event.origin);
      } catch (err) {
        const response: WidgetWireMessage = {
          type: 'response',
          id: msg.id,
          action: msg.action,
          payload: { error: err instanceof Error ? err.message : String(err) },
        };

        source.postMessage(response, event.origin);
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
