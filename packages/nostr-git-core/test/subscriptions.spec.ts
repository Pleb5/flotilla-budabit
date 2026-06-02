import { describe, it, expect } from 'vitest';
import { buildRepoSubscriptions } from '../src/git/subscriptions.js';

function keysOf(obj: Record<string, unknown>): string[] {
  return Object.keys(obj);
}

describe('buildRepoSubscriptions dedupe and ordering', () => {
  it('builds expected filters and notes for full args', () => {
    const res = buildRepoSubscriptions({
      addressA: 'git:npub1xyz:repo',
      rootEventId: 'root123',
      euc: 'euc://relay.example/repo'
    });

    const enableStack = process.env.ENABLE_STACKING_FILTERS === 'true';
    const shapes = res.filters.map((f) => keysOf(f as any)[0]);
    if (enableStack) {
      // Extra stacking-focused filters for #e and #a when flag is on
      expect(res.filters.length).toBe(6);
      expect(shapes).toEqual(['ids', '#e', '#e', '#a', '#a', '#r']);
    } else {
      // Default: ids, #e, #a, #r (stable order)
      expect(res.filters.length).toBe(4);
      expect(shapes).toEqual(['ids', '#e', '#a', '#r']);
    }

    // No exact duplicates
    const serialized = res.filters.map((f) => JSON.stringify(f)).sort();
    const unique = Array.from(new Set(serialized));
    expect(unique.length).toBe(serialized.length);

    // Notes should mention each subscription strategy
    expect(res.notes.join(' ')).toMatch(/repo address/i);
    expect(res.notes.join(' ')).toMatch(/root id/i);
    expect(res.notes.join(' ')).toMatch(/euc/i);
  });

  it('handles partial args and avoids duplicates', () => {
    const res = buildRepoSubscriptions({ rootEventId: 'root-only' });
    const enableStack = process.env.ENABLE_STACKING_FILTERS === 'true';
    const shapes = res.filters.map((f) => keysOf(f as any)[0]);
    if (enableStack) {
      expect(res.filters.length).toBe(3); // ids + #e + #e (kinds)
      expect(shapes).toEqual(['ids', '#e', '#e']);
    } else {
      expect(res.filters.length).toBe(2); // ids + #e
      expect(shapes).toEqual(['ids', '#e']);
    }
  });
});
