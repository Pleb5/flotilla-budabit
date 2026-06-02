import type { WidgetWireMessage } from '@flotilla/ext-shared';

type EventHandler = (payload: unknown) => void | Promise<void>;
type RequestHandler = (payload: unknown) => unknown | Promise<unknown>;

interface PendingRequest {
  action: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout> | null;
}

/**
 * Worker bridge for headless Smart Widget logic.
 *
 * This is intentionally a stub, but it is consistent with Flotilla's wire protocol:
 *   { type: 'request' | 'response' | 'event', action: string, payload?: unknown, id?: string }
 *
 * Use cases:
 * - background processing without DOM
 * - future service-worker integration
 * - headless coordination/testing
 */
export interface WorkerBridge {
  /**
   * Handle a message received FROM the host (parent runtime).
   */
  handleMessage(message: WidgetWireMessage): Promise<void>;

  /**
   * Send a request TO the host and await a correlated response.
   */
  request(action: string, payload?: unknown): Promise<unknown>;

  /**
   * Register a handler for host->worker one-way event messages.
   */
  onEvent(action: string, handler: EventHandler): () => void;

  /**
   * Register a handler for host->worker requests (bidirectional tool pattern).
   */
  onRequest(action: string, handler: RequestHandler): () => void;

  /**
   * Send a raw wire message TO the host.
   */
  send(message: WidgetWireMessage): void;

  /**
   * Clean up internal state and reject pending requests.
   */
  destroy(): void;
}

export interface WorkerBridgeOptions {
  timeoutMs?: number;
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `w-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function createWorkerBridge(
  postMessage: (message: WidgetWireMessage) => void,
  options: WorkerBridgeOptions = {}
): WorkerBridge {
  const timeoutMs = options.timeoutMs ?? 15000;

  const pending = new Map<string, PendingRequest>();
  const eventHandlers = new Map<string, Set<EventHandler>>();
  const requestHandlers = new Map<string, RequestHandler>();

  const send = (message: WidgetWireMessage): void => {
    postMessage(message);
  };

  const request = (action: string, payload?: unknown): Promise<unknown> => {
    const id = makeId();

    const msg: WidgetWireMessage = {
      type: 'request',
      id,
      action,
      payload,
    };

    return new Promise((resolve, reject) => {
      const timeoutId =
        timeoutMs > 0
          ? setTimeout(() => {
              pending.delete(id);
              reject(new Error(`WorkerBridge: request timed out (${action})`));
            }, timeoutMs)
          : null;

      pending.set(id, { action, resolve, reject, timeoutId });

      try {
        send(msg);
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  };

  const onEvent = (action: string, handler: EventHandler): (() => void) => {
    if (!eventHandlers.has(action)) {
      eventHandlers.set(action, new Set());
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const set = eventHandlers.get(action)!;
    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) eventHandlers.delete(action);
    };
  };

  const onRequest = (action: string, handler: RequestHandler): (() => void) => {
    requestHandlers.set(action, handler);

    return () => {
      const current = requestHandlers.get(action);
      if (current === handler) requestHandlers.delete(action);
    };
  };

  const handleMessage = async (message: WidgetWireMessage): Promise<void> => {
    // Stub-friendly logging; extension authors can customize.
    // eslint-disable-next-line no-console
    console.log('Worker received message:', message);

    if (message.type === 'response') {
      if (!message.id) return;
      const p = pending.get(message.id);
      if (!p) return;

      if (p.timeoutId) clearTimeout(p.timeoutId);
      pending.delete(message.id);
      p.resolve(message.payload);
      return;
    }

    if (message.type === 'event') {
      const handlers = eventHandlers.get(message.action);
      if (!handlers || handlers.size === 0) return;

      await Promise.all(Array.from(handlers).map((h) => Promise.resolve(h(message.payload))));
      return;
    }

    if (message.type === 'request') {
      const handler = requestHandlers.get(message.action);

      try {
        const result = handler
          ? await handler(message.payload)
          : { error: `No handler registered for action ${message.action}` };

        const response: WidgetWireMessage = {
          type: 'response',
          id: message.id,
          action: message.action,
          payload: result,
        };

        send(response);
      } catch (err) {
        const response: WidgetWireMessage = {
          type: 'response',
          id: message.id,
          action: message.action,
          payload: { error: err instanceof Error ? err.message : String(err) },
        };

        send(response);
      }
    }
  };

  const destroy = (): void => {
    for (const [id, p] of pending.entries()) {
      if (p.timeoutId) clearTimeout(p.timeoutId);
      p.reject(
        new Error(`WorkerBridge: destroyed while awaiting response (${p.action}, id: ${id})`)
      );
    }

    pending.clear();
    eventHandlers.clear();
    requestHandlers.clear();
  };

  return {
    handleMessage,
    request,
    onEvent,
    onRequest,
    send,
    destroy,
  };
}

// Example usage in a Web Worker context:
// Uncomment to enable and adapt for your project.
/*
declare const self: DedicatedWorkerGlobalScope;

const bridge = createWorkerBridge((message) => {
  self.postMessage(message);
});

self.addEventListener('message', (event) => {
  void bridge.handleMessage(event.data as WidgetWireMessage);
});

// Example: call a host action
void bridge.request('ui:toast', { message: 'Worker online', type: 'info' });
*/
