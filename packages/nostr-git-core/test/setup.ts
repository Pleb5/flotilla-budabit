// Global test setup; keep minimal to avoid interfering with per-test mocks
import { webcrypto } from 'node:crypto'
import * as nostrTools from 'nostr-tools'

try {
  const g: any = globalThis as any
  if (!g.crypto || !g.crypto.subtle) {
    g.crypto = webcrypto as any
  }
} catch {}

try {
  // Ensure nip05 exists and has a configurable queryProfile function property
  const nip05: any = (nostrTools as any).nip05 ?? {}
  if (!nip05.queryProfile) {
    nip05.queryProfile = async (_id: string) => null
  }
  // Ensure the method is configurable so tests can spy on it
  try {
    const desc = Object.getOwnPropertyDescriptor(nip05, 'queryProfile')
    if (!desc || !desc.configurable) {
      Object.defineProperty(nip05, 'queryProfile', {
        value: nip05.queryProfile,
        writable: true,
        configurable: true,
        enumerable: true,
      })
    }
  } catch {}
  Object.defineProperty((nostrTools as any), 'nip05', {
    value: nip05,
    configurable: true,
    writable: true,
    enumerable: true,
  })
} catch {}
