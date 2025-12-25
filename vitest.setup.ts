// Vitest test setup for browser-like APIs in Node
// Polyfills for global self and indexedDB used by @nostr-git/core

import 'fake-indexeddb/auto';

// Ensure global self exists
// @ts-ignore
if (typeof (globalThis as any).self === 'undefined') {
  // @ts-ignore
  (globalThis as any).self = globalThis as any;
}

// Minimal Web Worker polyfill for Vitest (Node/happy-dom environment)
// This is test-only: it allows code that calls `new Worker(...)` to run
// without changing production behavior where the real Worker is available.
if (typeof (globalThis as any).Worker === 'undefined') {
  class FakeWorker {
    // Keep the constructor signature loose for tests
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(..._args: any[]) {}

    // Stubbed APIs used in our code/tests
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    postMessage(_msg: any) {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    terminate() {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    addEventListener(_type: string, _listener: any) {}
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    removeEventListener(_type: string, _listener: any) {}

    onmessage: ((ev: MessageEvent) => void) | null = null;
    onerror: ((ev: ErrorEvent) => void) | null = null;
  }

  // @ts-ignore - assign polyfill for tests only
  (globalThis as any).Worker = FakeWorker as any;
}
