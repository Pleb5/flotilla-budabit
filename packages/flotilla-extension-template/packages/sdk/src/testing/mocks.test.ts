import { describe, it, expect } from 'vitest';
import { MockWidgetBridge, createMockWidgetBridge, waitForMessage } from './mocks.js';

describe('MockWidgetBridge', () => {
  describe('request()', () => {
    it('should record sent messages', () => {
      const bridge = createMockWidgetBridge();

      bridge.request('nostr:publish', { kind: 1, content: 'test', tags: [], created_at: 0 });

      expect(bridge.sentMessages).toHaveLength(1);
      expect(bridge.sentMessages[0].type).toBe('request');
      expect(bridge.sentMessages[0].action).toBe('nostr:publish');
    });

    it('should resolve when respondTo is called', async () => {
      const bridge = createMockWidgetBridge();

      const promise = bridge.request('ui:toast', { message: 'Hello' });
      const msg = bridge.sentMessages[0];

      bridge.respondTo(msg.id!, { status: 'ok' });

      const result = await promise;
      expect(result).toEqual({ status: 'ok' });
    });

    it('should reject when rejectTo is called', async () => {
      const bridge = createMockWidgetBridge();

      const promise = bridge.request('nostr:publish', { kind: 1, content: '', tags: [], created_at: 0 });
      const msg = bridge.sentMessages[0];

      bridge.rejectTo(msg.id!, new Error('Permission denied'));

      await expect(promise).rejects.toThrow('Permission denied');
    });
  });

  describe('onEvent()', () => {
    it('should dispatch events to handlers', () => {
      const bridge = createMockWidgetBridge();
      const payloads: unknown[] = [];

      bridge.onEvent('widget:init', (p) => { payloads.push(p); });

      bridge.emitFromHost({
        type: 'event',
        action: 'widget:init',
        payload: { pubkey: 'abc', relays: [] },
      });

      expect(payloads).toHaveLength(1);
      expect(payloads[0]).toEqual({ pubkey: 'abc', relays: [] });
    });

    it('should return unsubscribe function', () => {
      const bridge = createMockWidgetBridge();
      const payloads: unknown[] = [];

      const unsub = bridge.onEvent('widget:init', (p) => { payloads.push(p); });
      unsub();

      bridge.emitFromHost({
        type: 'event',
        action: 'widget:init',
        payload: {},
      });

      expect(payloads).toHaveLength(0);
    });
  });

  describe('onRequest()', () => {
    it('should handle host-to-widget requests', async () => {
      const bridge = createMockWidgetBridge();

      bridge.onRequest('custom:action', (payload) => {
        return { echo: payload };
      });

      bridge.emitFromHost({
        type: 'request',
        id: 'host-1',
        action: 'custom:action',
        payload: { input: 'test' },
      });

      // Wait for async handler
      await new Promise((r) => setTimeout(r, 10));

      const response = bridge.sentMessages.find(
        (m) => m.type === 'response' && m.id === 'host-1'
      );
      expect(response).toBeDefined();
      expect(response!.payload).toEqual({ echo: { input: 'test' } });
    });

    it('should respond with error for unhandled actions', async () => {
      const bridge = createMockWidgetBridge();

      bridge.emitFromHost({
        type: 'request',
        id: 'host-2',
        action: 'unknown:action',
        payload: {},
      });

      await new Promise((r) => setTimeout(r, 10));

      const response = bridge.sentMessages.find(
        (m) => m.type === 'response' && m.id === 'host-2'
      );
      expect(response).toBeDefined();
      expect((response!.payload as { error: string }).error).toContain('No handler');
    });
  });

  describe('emitFromHost() response handling', () => {
    it('should resolve pending requests when response arrives', async () => {
      const bridge = createMockWidgetBridge();

      const promise = bridge.request('nostr:query', { relays: [], filter: {} });
      const sentMsg = bridge.sentMessages[0];

      bridge.emitFromHost({
        type: 'response',
        id: sentMsg.id!,
        action: 'nostr:query',
        payload: { status: 'ok', events: [] },
      });

      const result = await promise;
      expect(result).toEqual({ status: 'ok', events: [] });
    });
  });

  describe('destroy()', () => {
    it('should reject all pending requests', async () => {
      const bridge = createMockWidgetBridge();

      const p1 = bridge.request('nostr:publish', { kind: 1, content: '', tags: [], created_at: 0 });
      const p2 = bridge.request('ui:toast', { message: 'test' });

      bridge.destroy();

      await expect(p1).rejects.toThrow(/destroyed/);
      await expect(p2).rejects.toThrow(/destroyed/);
    });

    it('should clear sent messages', async () => {
      const bridge = createMockWidgetBridge();
      const pending = bridge.request('ui:toast', { message: 'test' }).catch(() => {});
      expect(bridge.sentMessages).toHaveLength(1);

      bridge.destroy();
      await pending;
      expect(bridge.sentMessages).toHaveLength(0);
    });
  });

  describe('clearSent()', () => {
    it('should clear only sent messages', () => {
      const bridge = createMockWidgetBridge();
      bridge.request('ui:toast', { message: 'test' });
      expect(bridge.sentMessages).toHaveLength(1);

      bridge.clearSent();
      expect(bridge.sentMessages).toHaveLength(0);
    });
  });
});

describe('waitForMessage()', () => {
  it('should resolve immediately if message already sent', async () => {
    const bridge = createMockWidgetBridge();
    bridge.request('ui:toast', { message: 'test' });

    const msg = await waitForMessage(bridge, { type: 'request', action: 'ui:toast' });
    expect(msg.action).toBe('ui:toast');
  });

  it('should wait for a matching message', async () => {
    const bridge = createMockWidgetBridge();

    const promise = waitForMessage(bridge, { type: 'request', action: 'nostr:publish' }, 500);

    // Send after a small delay
    setTimeout(() => {
      bridge.request('nostr:publish', { kind: 1, content: '', tags: [], created_at: 0 });
    }, 20);

    const msg = await promise;
    expect(msg.action).toBe('nostr:publish');
  });

  it('should timeout if no matching message', async () => {
    const bridge = createMockWidgetBridge();

    await expect(
      waitForMessage(bridge, { type: 'request', action: 'nonexistent' }, 50)
    ).rejects.toThrow(/Timeout/);
  });
});
