import type { RepoAnnouncementEvent, RepoStateEvent } from './nip34.js';
import { validateRepoAnnouncementEvent, validateRepoStateEvent } from '../../utils/validation.js';

/**
 * Feature flag for runtime event validation.
 * - Node: reads process.env.NOSTR_GIT_VALIDATE_EVENTS
 * - Browser: reads (globalThis as any).NOSTR_GIT_VALIDATE_EVENTS
 * Defaults to true in development, false in production if unset.
 */
export function shouldValidateEvents(): boolean {
  // Explicit boolean override on globalThis for browser contexts
  const g: any = globalThis as any;
  if (typeof g.NOSTR_GIT_VALIDATE_EVENTS !== 'undefined') {
    return !!g.NOSTR_GIT_VALIDATE_EVENTS;
  }
  // Node/process env if present
  const env =
    typeof process !== 'undefined' && (process as any)?.env ? (process as any).env : undefined;
  if (env && typeof env.NOSTR_GIT_VALIDATE_EVENTS !== 'undefined') {
    const v = String(env.NOSTR_GIT_VALIDATE_EVENTS).toLowerCase();
    return v === '1' || v === 'true' || v === 'yes';
  }
  // Default heuristic: enable in non-production environments
  const nodeEnv = env?.NODE_ENV || g.NODE_ENV;
  return nodeEnv !== 'production';
}

export function assertRepoAnnouncementEvent(evt: unknown): asserts evt is RepoAnnouncementEvent {
  if (!shouldValidateEvents()) return;
  const res = validateRepoAnnouncementEvent(evt);
  if (!res.success) {
    throw new Error(`Invalid RepoAnnouncementEvent: ${res.error.message}`);
  }
}

export function assertRepoStateEvent(evt: unknown): asserts evt is RepoStateEvent {
  if (!shouldValidateEvents()) return;
  const res = validateRepoStateEvent(evt);
  if (!res.success) {
    throw new Error(`Invalid RepoStateEvent: ${res.error.message}`);
  }
}
