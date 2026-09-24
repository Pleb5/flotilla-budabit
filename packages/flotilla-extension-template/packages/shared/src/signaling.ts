import type { UnsignedEvent } from './types.js';

/**
 * Signaling helpers for creating Nostr events
 *
 * TODO: Customize these helpers for your extension's specific event kinds
 * This is a placeholder implementation - replace with your own logic
 */

/**
 * Create a basic unsigned event template
 *
 * @example
 * ```ts
 * const event = createEvent(1, 'Hello, Nostr!', [['p', recipientPubkey]]);
 * // Sign and publish via bridge
 * await bridge.request('nostr:publish', event);
 * ```
 */
export function createEvent(
  kind: number,
  content: string,
  tags: string[][] = []
): UnsignedEvent {
  return {
    kind,
    content,
    tags,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/**
 * Create a text note event (kind 1)
 *
 * @example
 * ```ts
 * const note = createTextNote('Hello, world!');
 * await bridge.request('nostr:publish', note);
 * ```
 */
export function createTextNote(content: string, tags: string[][] = []): UnsignedEvent {
  return createEvent(1, content, tags);
}

/**
 * Create a custom event for your extension
 *
 * TODO: Replace this with your own event creation logic
 *
 * @example
 * ```ts
 * // For a chat extension:
 * export function createChatMessage(
 *   roomId: string,
 *   message: string
 * ): UnsignedEvent {
 *   return createEvent(29100, message, [
 *     ['h', roomId],
 *     ['alt', 'Chat message in room']
 *   ]);
 * }
 *
 * // For a collaborative editing extension:
 * export function createEditOperation(
 *   documentId: string,
 *   operation: EditOp
 * ): UnsignedEvent {
 *   return createEvent(29300, JSON.stringify(operation), [
 *     ['d', documentId],
 *     ['op', operation.type],
 *     ['alt', 'Document edit operation']
 *   ]);
 * }
 * ```
 */
export function createCustomEvent(
  contextId: string,
  data: Record<string, unknown>
): UnsignedEvent {
  // TODO: Replace kind 30000 with your custom event kind
  return createEvent(
    30000,
    JSON.stringify(data),
    [
      ['h', contextId], // Context identifier (room, group, etc.)
      ['alt', 'Custom extension event'], // Human-readable description (NIP-31)
    ]
  );
}

/**
 * Validate event before publishing
 *
 * @example
 * ```ts
 * const event = createTextNote('Hello!');
 * if (validateEvent(event, [1])) {
 *   await bridge.request('nostr:publish', event);
 * }
 * ```
 */
export function validateEvent(event: UnsignedEvent, allowedKinds: number[]): boolean {
  // Check kind is allowed
  if (!allowedKinds.includes(event.kind)) {
    console.error(`Event kind ${String(event.kind)} not allowed`);
    return false;
  }

  // Check timestamp is reasonable (within 1 hour of now)
  const now = Math.floor(Date.now() / 1000);
  const diff = Math.abs(now - event.created_at);
  if (diff > 3600) {
    console.error('Event timestamp out of range');
    return false;
  }

  // Check content size (100KB limit)
  if (event.content.length > 100000) {
    console.error('Event content too large');
    return false;
  }

  // Check tag count (100 tags max)
  if (event.tags.length > 100) {
    console.error('Too many tags');
    return false;
  }

  return true;
}
