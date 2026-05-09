// Test setup file for UI package tests
import { vi, expect } from 'vitest';
import type { Commit } from '@nostr-git/core/types';
import type { StatusEvent } from '@nostr-git/core/events';

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

// Mock Web APIs that might not be available in test environment
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock clipboard API
Object.defineProperty(navigator, 'clipboard', {
  writable: true,
  value: {
    writeText: vi.fn().mockResolvedValue(undefined),
    readText: vi.fn().mockResolvedValue(''),
  },
});

// Mock ResizeObserver
global.ResizeObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Mock IntersectionObserver
global.IntersectionObserver = vi.fn().mockImplementation(() => ({
  observe: vi.fn(),
  unobserve: vi.fn(),
  disconnect: vi.fn(),
}));

// Minimal Web Worker polyfill for Vitest (Node/happy-dom)
// This is test-only and does not affect production behavior.
if (typeof (globalThis as any).Worker === 'undefined') {
  class FakeWorker {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    constructor(..._args: any[]) {}
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
  // @ts-ignore
  (globalThis as any).Worker = FakeWorker as any;
}

// Setup global test utilities
declare global {
  namespace Vi {
    interface JestAssertion<T = any> {
      toBeValidCommit(): T;
      toBeValidStatusEvent(): T;
    }
  }
}

// Custom matchers for test assertions
expect.extend({
  toBeValidCommit(received: Commit) {
    const pass = received &&
                 typeof received.oid === 'string' &&
                 typeof received.message === 'string' &&
                 received.author &&
                 typeof received.author.name === 'string' &&
                 typeof received.author.email === 'string' &&
                 Array.isArray(received.parent || []);

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid commit`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid commit`,
        pass: false,
      };
    }
  },

  toBeValidStatusEvent(received: StatusEvent) {
    const pass = received &&
                 typeof received.id === 'string' &&
                 typeof received.kind === 'number' &&
                 [1630, 1631, 1632, 1633].includes(received.kind) &&
                 typeof received.content === 'string' &&
                 Array.isArray(received.tags) &&
                 typeof received.created_at === 'number' &&
                 typeof received.pubkey === 'string';

    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid status event`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid status event`,
        pass: false,
      };
    }
  },
});

// Test timeout configuration
vi.setConfig({
  testTimeout: 10000,
  hookTimeout: 10000,
});
