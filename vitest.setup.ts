// Vitest test setup for browser-like APIs in Node
// Polyfills for global self and indexedDB used by @nostr-git/core

import 'fake-indexeddb/auto';

// Ensure global self exists
// @ts-ignore
if (typeof (globalThis as any).self === 'undefined') {
  // @ts-ignore
  (globalThis as any).self = globalThis as any;
}
