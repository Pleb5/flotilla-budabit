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
      const promise = bridge.request('nostr:publish', {
        kind: 1,
        content: 'test',
        tags: [],
        created_at: 0,
      });

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

    it('should send descriptor-scoped live stream queries', () => {
      const promise = bridge.request('community:queryLiveStreams', {
        descriptors: [{ kind: 31923 }],
        since: 10,
        until: 20,
        limit: 5,
      });

      expect(targetWindow.postMessage.mock.calls[0][0]).toMatchObject({
        type: 'request',
        action: 'community:queryLiveStreams',
        payload: {
          descriptors: [{ kind: 31923 }],
          since: 10,
          until: 20,
          limit: 5,
        },
      });

      promise.catch(() => {});
      bridge.destroy();
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

  describe('subscribe()', () => {
    it('uses the host-owned subscription ID for events and unsubscribe', async () => {
      const subscriptionPromise = bridge.subscribe({
        relays: ['wss://relay.example.com'],
        filter: { kinds: [1] },
      });
      const subscribeMessage = targetWindow.postMessage.mock.calls[0][0] as TestWireMessage;

      expect(subscribeMessage).toMatchObject({
        type: 'request',
        action: 'nostr:subscribe',
        payload: { relays: ['wss://relay.example.com'], filter: { kinds: [1] } },
      });
      expect(subscribeMessage.payload).not.toHaveProperty('subscriptionId');

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'response',
            id: subscribeMessage.id,
            action: 'nostr:subscribe',
            payload: { status: 'ok', subscriptionId: 'host-sub-1' },
          },
          source: targetWindow,
          origin: window.location.origin,
        })
      );
      const subscription = await subscriptionPromise;
      expect(subscription.subscriptionId).toBe('host-sub-1');

      const unsubscribePromise = subscription.unsubscribe();
      const unsubscribeMessage = targetWindow.postMessage.mock.calls[1][0] as TestWireMessage;
      expect(unsubscribeMessage).toMatchObject({
        action: 'nostr:unsubscribe',
        payload: { subscriptionId: 'host-sub-1' },
      });
      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'response',
            id: unsubscribeMessage.id,
            action: 'nostr:unsubscribe',
            payload: { status: 'ok' },
          },
          source: targetWindow,
          origin: window.location.origin,
        })
      );
      await expect(unsubscribePromise).resolves.toEqual({ status: 'ok' });
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

    it('handles canonical subscription events and old or per-relay EOSE payloads', async () => {
      const onSubscriptionEvent = vi.fn();
      const onEose = vi.fn();
      bridge.onEvent('nostr:subscription:event', onSubscriptionEvent);
      bridge.onEvent('nostr:eose', onEose);

      for (const [action, payload] of [
        ['nostr:subscription:event', { subscriptionId: 'host-sub-1', event: { id: 'event-1' } }],
        ['nostr:eose', { subscriptionId: 'host-sub-1' }],
        ['nostr:eose', { subscriptionId: 'host-sub-1', relay: 'wss://relay.example/' }],
      ] as const) {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'event', action, payload },
            source: targetWindow,
            origin: window.location.origin,
          })
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(onSubscriptionEvent).toHaveBeenCalledWith({
        subscriptionId: 'host-sub-1',
        event: { id: 'event-1' },
      });
      expect(onEose).toHaveBeenNthCalledWith(1, { subscriptionId: 'host-sub-1' });
      expect(onEose).toHaveBeenNthCalledWith(2, {
        subscriptionId: 'host-sub-1',
        relay: 'wss://relay.example/',
      });
    });
  });

  describe('onRequest()', () => {
    it('should respond to host request with handler result', async () => {
      // Create a bridge that uses window.parent as targetWindow so source checks pass
      const reqBridge = new WidgetBridge({
        targetWindow: window.parent,
        targetOrigin: '*',
        timeoutMs: 1000,
      });

      const handler = vi.fn().mockResolvedValue({ data: 'result' });
      reqBridge.onRequest('custom:action', handler);

      // Spy on window.parent.postMessage to capture response
      const postSpy = vi.spyOn(window.parent, 'postMessage');

      window.dispatchEvent(
        new MessageEvent('message', {
          data: {
            type: 'request',
            id: 'host-req-1',
            action: 'custom:action',
            payload: { input: 'test' },
          },
          source: window.parent,
          origin: 'http://localhost',
        })
      );

      await new Promise((r) => setTimeout(r, 10));

      expect(handler).toHaveBeenCalledWith({ input: 'test' });
      expect(postSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'response',
          id: 'host-req-1',
          action: 'custom:action',
          payload: { data: 'result' },
        }),
        expect.any(String)
      );

      postSpy.mockRestore();
      reqBridge.destroy();
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
