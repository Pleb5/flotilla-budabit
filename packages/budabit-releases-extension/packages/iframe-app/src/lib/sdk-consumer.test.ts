import { describe, expect, it } from 'vitest';
import type { NostrEvent, WidgetBridge } from 'budabit-sdk';
import { createMockWidgetBridge } from 'budabit-sdk/testing';
import { queryEvents, tagValue } from './releases.js';
import { releaseFixture } from './test-fixtures.js';

describe('budabit-sdk consumer integration', () => {
  it('uses the SDK testing bridge with release domain helpers', async () => {
    const bridge = createMockWidgetBridge();
    const event: NostrEvent = releaseFixture({ tags: [['version', '1.0.0']] });

    const pending = queryEvents(bridge as unknown as WidgetBridge, ['wss://relay.example'], {
      kinds: [30063],
    });
    const request = bridge.sentMessages[0];
    if (!request || request.type !== 'request') throw new Error('Expected a query request');
    bridge.respondTo(request.id, { status: 'ok', complete: true, events: [event] });

    await expect(pending).resolves.toEqual([event]);
    expect(tagValue(event, 'version')).toBe('1.0.0');
    bridge.destroy();
  });
});
