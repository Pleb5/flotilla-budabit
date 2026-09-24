import { describe, expect, it, vi } from 'vitest';
import type { WidgetBridge } from 'budabit-sdk';
import { queryAll } from './query.js';
import { signed } from './test-fixtures.js';

describe('bounded relay discovery', () => {
  it('requires explicit completeness from the host and keeps successful relay data on errors', async () => {
    const event = signed();
    const request = vi.fn(async (_: string, p: { relays: string[] }) =>
      p.relays[0]?.includes('offline') ? { error: 'offline' } : { status: 'ok', events: [event] }
    );
    const result = await queryAll(
      { request } as unknown as WidgetBridge,
      ['wss://good.example', 'wss://offline.example'],
      { kinds: [32267] }
    );
    expect(result.events).toEqual([event]);
    expect(result.complete).toBe(false);
    expect(result.errors?.[0]).toContain('offline');
  });
  it('uses inclusive per-relay cursors, deduplicates boundaries, and rejects out-of-filter events', async () => {
    const batch = Array.from({ length: 100 }, (_, index) =>
      signed({ created_at: 1000 - index, content: String(index) })
    );
    const older = signed({ created_at: 800 });
    const request = vi.fn(async (_: string, p: { filter: { until?: number } }) => ({
      status: 'ok',
      complete: true,
      events: p.filter.until === undefined ? batch : [batch[99], older, signed({ kind: 1 })],
    }));
    const result = await queryAll({ request } as unknown as WidgetBridge, ['wss://good.example'], {
      kinds: [32267],
    });
    expect(request.mock.calls[1]?.[1].filter.until).toBe(901);
    expect(result.complete).toBe(true);
    expect(result.events).toHaveLength(101);
  });
  it('does not skip an overflowing shared timestamp or exceed the page bound', async () => {
    const batch = Array.from({ length: 100 }, (_, index) => signed({ content: String(index) }));
    const request = vi.fn(async () => ({ status: 'ok', complete: true, events: batch }));
    const result = await queryAll({ request } as unknown as WidgetBridge, ['wss://good.example'], {
      kinds: [32267],
    });
    expect(result.complete).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    const controller = new AbortController();
    controller.abort();
    await expect(
      queryAll(
        { request } as unknown as WidgetBridge,
        ['wss://good.example'],
        {},
        controller.signal
      )
    ).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(2);
  });
});
