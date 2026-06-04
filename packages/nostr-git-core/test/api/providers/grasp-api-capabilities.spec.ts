import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraspApi } from '../../../src/api/providers/grasp-api.js';

describe('GraspApi relay capabilities', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('getCapableRelays filters by capability', async () => {
    const api = new GraspApi({ relays: ['wss://a', 'wss://b', 'wss://c'], publishEvent: async () => ({ ok: true }) as any });
    // Spy on instance method to isolate behavior
    const spy = vi.spyOn(api, 'checkRelayCapabilities');
    spy.mockResolvedValueOnce(true);
    spy.mockResolvedValueOnce(false);
    spy.mockResolvedValueOnce(true);
    const capable = await api.getCapableRelays();
    expect(capable).toEqual(['wss://a', 'wss://c']);
  });
});
