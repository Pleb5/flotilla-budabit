import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { WidgetBridge } from './bridge.js';

// Test-only type for wire messages with id
type TestWireMessage = {
  type: string;
  action: string;
  id?: string;
  payload?: unknown;
};

describe('WidgetBridge', () => {
  let targetWindow: { postMessage: ReturnType<typeof vi.fn> };
  let bridge: WidgetBridge;

  beforeEach(() => {
    targetWindow = {
      postMessage: vi.fn(),
    };

    bridge = new WidgetBridge({
      targetWindow: targetWindow as unknown as Window,
      targetOrigin: '*',
      timeoutMs: 1000,
    });
  });

  afterEach(() => {
    bridge.destroy();
  });

  describe('request()', () => {
    it('should send request message to target window', () => {
      const promise = bridge.request('ui:toast', { message: 'Hello' });

      expect(targetWindow.postMessage).toHaveBeenCalledTimes(1);

      const sentMsg = targetWindow.postMessage.mock.calls[0][0] as TestWireMessage;
      expect(sentMsg.type).toBe('request');
      expect(sentMsg.action).toBe('ui:toast');
      expect(sentMsg.payload).toEqual({ message: 'Hello' });
      expect(typeof sentMsg.id).toBe('string');

      // Clean up pending request
      promise.catch(() => {});
      bridge.destroy();
    });

    it('should resolve when response with matching id is received', async () => {
      const promise = bridge.request('nostr:publish', { kind: 1, content: 'test', tags: [], created_at: 0 });

      const sentMsg = targetWindow.postMessage.mock.calls[0][0] as TestWireMessage;
      const requestId = sentMsg.id;

      // Simulate host response
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'response',
            id: requestId,
            action: 'nostr:publish',
            payload: { status: 'ok', result: { eventId: 'abc123' } },
          },
          source: targetWindow,
          origin: window.location.origin,
        })
      );

      const result = await promise;
      expect(result).toEqual({ status: 'ok', result: { eventId: 'abc123' } });
    });

    it('should reject on timeout', async () => {
      const shortTimeoutBridge = new WidgetBridge({
        targetWindow: targetWindow as unknown as Window,
        targetOrigin: '*',
        timeoutMs: 50,
      });

      const promise = shortTimeoutBridge.request('ui:toast', { message: 'test' });

      await expect(promise).rejects.toThrow(/timed out/);

      shortTimeoutBridge.destroy();
    });
  });

  describe('onEvent()', () => {
    it('should call handler when event message is received', async () => {
      const handler = vi.fn();
      bridge.onEvent('context:update', handler);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            action: 'context:update',
            payload: { contextId: 'room-123', userPubkey: 'pk-abc' },
          },
          source: targetWindow,
          origin: window.location.origin,
        })
      );

      // Allow async handling
      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith({ contextId: 'room-123', userPubkey: 'pk-abc' });
    });

    it('should return unsubscribe function', async () => {
      const handler = vi.fn();
      const unsub = bridge.onEvent('context:update', handler);

      unsub();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            action: 'context:update',
            payload: { contextId: 'room-456' },
          },
          source: targetWindow,
          origin: window.location.origin,
        })
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('onRequest()', () => {
    it('should respond to host request with handler result', async () => {
      const handler = vi.fn().mockResolvedValue({ data: 'result' });
      bridge.onRequest('custom:action', handler);

      // Mock source window for response
      const mockSource = { postMessage: vi.fn() };

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'request',
            id: 'host-req-1',
            action: 'custom:action',
            payload: { input: 'test' },
          },
          source: mockSource as unknown as Window,
          origin: window.location.origin,
        })
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith({ input: 'test' });
      expect(mockSource.postMessage).toHaveBeenCalledWith(
        {
          type: 'response',
          id: 'host-req-1',
          action: 'custom:action',
          payload: { data: 'result' },
        },
        window.location.origin
      );
    });
  });

  describe('origin validation', () => {
    it('should reject messages from wrong origin when targetOrigin is set', async () => {
      const strictBridge = new WidgetBridge({
        targetWindow: targetWindow as unknown as Window,
        targetOrigin: 'https://trusted.example.com',
        timeoutMs: 1000,
      });

      const handler = vi.fn();
      strictBridge.onEvent('context:update', handler);

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            action: 'context:update',
            payload: { contextId: 'room-123' },
          },
          source: targetWindow,
          origin: 'https://untrusted.example.com',
        })
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();

      strictBridge.destroy();
    });
  });

  describe('destroy()', () => {
    it('should reject pending requests', async () => {
      const promise = bridge.request('ui:toast', { message: 'test' });

      bridge.destroy();

      await expect(promise).rejects.toThrow(/destroyed/);
    });

    it('should stop receiving messages after destroy', async () => {
      const handler = vi.fn();
      bridge.onEvent('context:update', handler);

      bridge.destroy();

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'event',
            action: 'context:update',
            payload: { contextId: 'room-123' },
          },
          source: targetWindow,
          origin: window.location.origin,
        })
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(handler).not.toHaveBeenCalled();
    });
  });
});
