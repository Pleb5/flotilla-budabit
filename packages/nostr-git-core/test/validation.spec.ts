import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertRepoAnnouncementEvent,
  assertRepoStateEvent,
  shouldValidateEvents
} from '../src/events/nip34/validation.js';

// Helper to stub env and global flags deterministically
function withEnv<K extends string>(vars: Partial<Record<K, string>>, fn: () => void) {
  const prev: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    prev[k] = (process as any).env[k];
    if (typeof v === 'undefined') delete (process as any).env[k];
    else (process as any).env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (typeof v === 'undefined') delete (process as any).env[k];
      else (process as any).env[k] = v as string;
    }
  }
}

describe('core validation guards', () => {
  const g: any = globalThis as any;
  let prevGlobalFlag: any;

  beforeEach(() => {
    prevGlobalFlag = g.NOSTR_GIT_VALIDATE_EVENTS;
    delete g.NOSTR_GIT_VALIDATE_EVENTS;
  });

  afterEach(() => {
    if (typeof prevGlobalFlag === 'undefined') delete g.NOSTR_GIT_VALIDATE_EVENTS;
    else g.NOSTR_GIT_VALIDATE_EVENTS = prevGlobalFlag;
  });

  it('shouldValidateEvents respects env flag true/false', () => {
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'true', NODE_ENV: 'production' }, () => {
      expect(shouldValidateEvents()).toBe(true);
    });
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'false', NODE_ENV: 'development' }, () => {
      expect(shouldValidateEvents()).toBe(false);
    });
  });

  it('assertRepoAnnouncementEvent passes for valid event when enabled', () => {
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'true' }, () => {
      expect(() =>
        assertRepoAnnouncementEvent({ kind: 30617, tags: [['d', 'repo-1']] })
      ).not.toThrow();
    });
  });

  it('assertRepoAnnouncementEvent throws for invalid event when enabled', () => {
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'true' }, () => {
      expect(() => assertRepoAnnouncementEvent({ kind: 30617, tags: [] })).toThrow();
    });
  });

  it('assertRepoAnnouncementEvent is a no-op when disabled', () => {
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'false' }, () => {
      expect(() => assertRepoAnnouncementEvent({ kind: 30617, tags: [] })).not.toThrow();
    });
  });

  it('assertRepoStateEvent passes for valid event when enabled', () => {
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'true' }, () => {
      expect(() => assertRepoStateEvent({ kind: 30618, tags: [['d', 'repo-1']] })).not.toThrow();
    });
  });

  it('assertRepoStateEvent throws for invalid event when enabled', () => {
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'true' }, () => {
      expect(() => assertRepoStateEvent({ kind: 30618, tags: [] })).toThrow();
    });
  });

  it('assertRepoStateEvent is a no-op when disabled', () => {
    withEnv({ NOSTR_GIT_VALIDATE_EVENTS: 'false' }, () => {
      expect(() => assertRepoStateEvent({ kind: 30618, tags: [] })).not.toThrow();
    });
  });
});
