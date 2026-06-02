import { vi } from 'vitest';
import type { WidgetWireMessage } from '@flotilla/ext-shared';

/**
 * Mock iframe environment for testing bridge communication
 */
export interface MockIframeEnvironment {
  iframe: HTMLIFrameElement;
  iframeWindow: Window;
  hostWindow: Window;
  cleanup: () => void;
}

/**
 * Create a mock iframe environment for testing
 */
export function createMockIframeEnvironment(): MockIframeEnvironment {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const iframeWindow = iframe.contentWindow!;
  const hostWindow = window;

  const cleanup = () => {
    document.body.removeChild(iframe);
  };

  return {
    iframe,
    iframeWindow,
    hostWindow,
    cleanup,
  };
}

/**
 * Mock MessageChannel for testing postMessage communication
 */
export function createMockMessageChannel() {
  const port1Messages: MessageEvent[] = [];
  const port2Messages: MessageEvent[] = [];

  const port1 = {
    postMessage: vi.fn((data: unknown) => {
      const event = new MessageEvent('message', { data });
      port2Messages.push(event);
      port2.onmessage?.(event);
    }),
    onmessage: null as ((event: MessageEvent) => void) | null,
    addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
      if (type === 'message') {
        port1.onmessage = handler;
      }
    }),
    removeEventListener: vi.fn(),
  };

  const port2 = {
    postMessage: vi.fn((data: unknown) => {
      const event = new MessageEvent('message', { data });
      port1Messages.push(event);
      port1.onmessage?.(event);
    }),
    onmessage: null as ((event: MessageEvent) => void) | null,
    addEventListener: vi.fn((type: string, handler: (event: MessageEvent) => void) => {
      if (type === 'message') {
        port2.onmessage = handler;
      }
    }),
    removeEventListener: vi.fn(),
  };

  return {
    port1,
    port2,
    getPort1Messages: () => port1Messages,
    getPort2Messages: () => port2Messages,
  };
}

type EventHandler = (payload: unknown) => void | Promise<void>;
type RequestHandler = (payload: unknown) => unknown | Promise<unknown>;

interface PendingRequest {
  action: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * Mock Smart Widget bridge for testing action-based request/response/event protocol.
 *
 * Matches Flotilla's wire messages:
 *   { type: 'request'|'response'|'event', action: string, payload?: any, id?: string }
 */
export class MockWidgetBridge {
  private counter = 0;
  private eventHandlers = new Map<string, Set<EventHandler>>();
  private requestHandlers = new Map<string, RequestHandler>();
  private pending = new Map<string, PendingRequest>();

  public sentMessages: WidgetWireMessage[] = [];

  request(action: string, payload?: unknown): Promise<unknown> {
    const id = `mock-${Date.now()}-${this.counter++}`;

    const msg: WidgetWireMessage = {
      type: 'request',
      id,
      action,
      payload,
    };

    this.sentMessages.push(msg);

    return new Promise((resolve, reject) => {
      this.pending.set(id, {
        action,
        resolve,
        reject,
      });
    });
  }

  onEvent(action: string, handler: (payload: unknown) => void | Promise<void>): () => void {
    if (!this.eventHandlers.has(action)) {
      this.eventHandlers.set(action, new Set());
    }

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const set = this.eventHandlers.get(action)!;

    set.add(handler);

    return () => {
      set.delete(handler);
      if (set.size === 0) this.eventHandlers.delete(action);
    };
  }

  onRequest(action: string, handler: (payload: unknown) => unknown | Promise<unknown>): () => void {
    this.requestHandlers.set(action, handler);

    return () => {
      const current = this.requestHandlers.get(action);
      if (current === handler) {
        this.requestHandlers.delete(action);
      }
    };
  }

  /**
   * Simulate receiving a host-originated message.
   *
   * - response: resolves a pending request promise.
   * - event: dispatches to onEvent handlers.
   * - request: dispatches to onRequest handlers and pushes a response into sentMessages.
   */
  emitFromHost(msg: WidgetWireMessage): void {
    if (msg.type === 'response') {
      if (!msg.id) return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;

      this.pending.delete(msg.id);
      pending.resolve(msg.payload);
      return;
    }

    if (msg.type === 'event') {
      const handlers = this.eventHandlers.get(msg.action);
      if (!handlers || handlers.size === 0) return;

      for (const handler of handlers) {
        void handler(msg.payload);
      }
      return;
    }

    if (msg.type === 'request') {
      const handler = this.requestHandlers.get(msg.action);

      const respond = async () => {
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

          this.sentMessages.push(response);
        } catch (err) {
          const response: WidgetWireMessage = {
            type: 'response',
            id: msg.id,
            action: msg.action,
            payload: { error: err instanceof Error ? err.message : String(err) },
          };

          this.sentMessages.push(response);
        }
      };

      void respond();
    }
  }

  /**
   * Resolve a pending request created by `request()`.
   *
   * This is convenient when you want to simulate the host responding without crafting a full
   * `{type:'response'}` wire message.
   */
  respondTo(id: string, payload?: unknown): void {
    const pending = this.pending.get(id);
    if (!pending) {
      throw new Error(`No pending request with id: ${id}`);
    }

    this.pending.delete(id);
    pending.resolve(payload);
  }

  /**
   * Reject a pending request created by `request()`.
   */
  rejectTo(id: string, error: Error): void {
    const pending = this.pending.get(id);
    if (!pending) {
      throw new Error(`No pending request with id: ${id}`);
    }

    this.pending.delete(id);
    pending.reject(error);
  }

  clearSent(): void {
    this.sentMessages = [];
  }

  destroy(): void {
    for (const [id, pending] of this.pending.entries()) {
      pending.reject(new Error(`MockWidgetBridge destroyed (pending request: ${pending.action}, id: ${id})`));
    }

    this.pending.clear();
    this.eventHandlers.clear();
    this.requestHandlers.clear();
    this.sentMessages = [];
  }
}

/**
 * Create a mock widget bridge for testing
 */
export function createMockWidgetBridge(): MockWidgetBridge {
  return new MockWidgetBridge();
}

export type WaitForMessageMatch = {
  type: WidgetWireMessage['type'];
  action?: string;
};

/**
 * Wait for a specific sent message (by type + optional action).
 */
export function waitForMessage(
  bridge: MockWidgetBridge,
  match: WaitForMessageMatch,
  timeout = 1000
): Promise<WidgetWireMessage> {
  return new Promise((resolve, reject) => {
    const matches = (m: WidgetWireMessage): boolean => {
      if (m.type !== match.type) return false;
      if (match.action && m.action !== match.action) return false;
      return true;
    };

    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(
        new Error(
          `Timeout waiting for message: type=${match.type}${match.action ? ` action=${match.action}` : ''}`
        )
      );
    }, timeout);

    const existing = bridge.sentMessages.find(matches);
    if (existing) {
      clearTimeout(timer);
      resolve(existing);
      return;
    }

    const interval = setInterval(() => {
      const found = bridge.sentMessages.find(matches);
      if (found) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(found);
      }
    }, 10);
  });
}
