import { describe, it, expect, vi } from 'vitest';
import { createWorkerBridge } from './index.js';

describe('WorkerBridge', () => {
  describe('request()', () => {
    it('should send a request message via postMessage', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage);

      const pending = bridge.request('ui:toast', { message: 'Hello' }).catch(() => {});

      expect(postMessage).toHaveBeenCalledTimes(1);
      const msg = postMessage.mock.calls[0][0];
      expect(msg.type).toBe('request');
      expect(msg.action).toBe('ui:toast');
      expect(msg.payload).toEqual({ message: 'Hello' });
      expect(typeof msg.id).toBe('string');

      bridge.destroy();
      await pending;
    });

    it('should resolve when correlated response is received', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage, { timeoutMs: 5000 });

      const promise = bridge.request('nostr:publish', { kind: 1, content: '', tags: [], created_at: 0 });
      const sentMsg = postMessage.mock.calls[0][0];

      await bridge.handleMessage({
        type: 'response',
        id: sentMsg.id,
        action: 'nostr:publish',
        payload: { status: 'ok' },
      });

      const result = await promise;
      expect(result).toEqual({ status: 'ok' });

      bridge.destroy();
    });

    it('should reject on timeout', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage, { timeoutMs: 50 });

      const promise = bridge.request('ui:toast', { message: 'test' });

      await expect(promise).rejects.toThrow(/timed out/);

      bridge.destroy();
    });
  });

  describe('onEvent()', () => {
    it('should dispatch events to handlers', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage);
      const payloads: unknown[] = [];

      bridge.onEvent('widget:init', (p) => { payloads.push(p); });

      await bridge.handleMessage({
        type: 'event',
        action: 'widget:init',
        payload: { pubkey: 'abc' },
      });

      expect(payloads).toEqual([{ pubkey: 'abc' }]);

      bridge.destroy();
    });

    it('should support unsubscribe', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage);
      const payloads: unknown[] = [];

      const unsub = bridge.onEvent('widget:init', (p) => { payloads.push(p); });
      unsub();

      await bridge.handleMessage({
        type: 'event',
        action: 'widget:init',
        payload: {},
      });

      expect(payloads).toHaveLength(0);

      bridge.destroy();
    });
  });

  describe('onRequest()', () => {
    it('should handle incoming requests and send response', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage);

      bridge.onRequest('custom:action', (payload) => {
        return { processed: true, input: payload };
      });

      await bridge.handleMessage({
        type: 'request',
        id: 'req-1',
        action: 'custom:action',
        payload: { data: 'test' },
      });

      // Find the response (not the original request)
      const response = postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'response'
      );
      expect(response).toBeDefined();
      expect(response![0]).toEqual({
        type: 'response',
        id: 'req-1',
        action: 'custom:action',
        payload: { processed: true, input: { data: 'test' } },
      });

      bridge.destroy();
    });

    it('should send error response for unhandled actions', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage);

      await bridge.handleMessage({
        type: 'request',
        id: 'req-2',
        action: 'unknown:action',
        payload: {},
      });

      const response = postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string }).type === 'response'
      );
      expect(response).toBeDefined();
      expect((response![0].payload as { error: string }).error).toContain('No handler');

      bridge.destroy();
    });

    it('should send error response when handler throws', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage);

      bridge.onRequest('failing:action', () => {
        throw new Error('Handler failed');
      });

      await bridge.handleMessage({
        type: 'request',
        id: 'req-3',
        action: 'failing:action',
        payload: {},
      });

      const response = postMessage.mock.calls.find(
        (c: unknown[]) => (c[0] as { type: string; id: string }).id === 'req-3'
      );
      expect(response).toBeDefined();
      expect((response![0].payload as { error: string }).error).toBe('Handler failed');

      bridge.destroy();
    });
  });

  describe('destroy()', () => {
    it('should reject all pending requests', async () => {
      const postMessage = vi.fn();
      const bridge = createWorkerBridge(postMessage, { timeoutMs: 0 });

      const p1 = bridge.request('nostr:publish', {});
      const p2 = bridge.request('ui:toast', {});

      bridge.destroy();

      await expect(p1).rejects.toThrow(/destroyed/);
      await expect(p2).rejects.toThrow(/destroyed/);
    });
  });
});
