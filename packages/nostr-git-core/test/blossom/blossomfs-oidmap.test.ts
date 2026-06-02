import { describe, it, expect, beforeEach, vi } from 'vitest';
import BlossomFS, { Signer } from '../../src/blossom/index.js';
import { NostrEvent } from 'nostr-tools';

// Polyfills
import 'fake-indexeddb/auto';
import { TextEncoder, TextDecoder } from 'util';
globalThis.TextEncoder = TextEncoder as any;
globalThis.TextDecoder = TextDecoder as any;
globalThis.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ sha256: 'abc123', size: 10 }) })) as any;

// Stub signer
const mockSigner: Signer = {
  async getPublicKey() { return 'deadbeef'.repeat(8); },
  async signEvent(evt: NostrEvent) { return { ...evt, id: 'id', sig: 'sig' }; },
};

describe('BlossomFS OID map persistence', () => {
  let fs: BlossomFS;

  beforeEach(async () => {
    fs = new BlossomFS('oidmap-test', { signer: mockSigner });
    await new Promise(r => setTimeout(r, 20));
  });

  it('stores both SHA-1 and SHA-256 git OIDs in oidmap', async () => {
    const data = new TextEncoder().encode('oid mapping test');
    await fs.writeFile('/oidmap/file.txt', data);
    const db = (fs as any).dbh.db;
    const tx = db.transaction('oidmap', 'readonly');
    const store = tx.objectStore('oidmap');
    const all = await new Promise<any[]>((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    expect(all.length).toBeGreaterThanOrEqual(2);
    const sha1rec = all.find(x => x.algo === 'sha1');
    const sha256rec = all.find(x => x.algo === 'sha256');
    expect(sha1rec?.gitOid.length).toBe(40);
    expect(sha256rec?.gitOid.length).toBe(64);
  });

  it('persists OID map after reopening', async () => {
    const data = new TextEncoder().encode('persistent');
    await fs.writeFile('/persist/file.txt', data);

    // reopen new instance
    const fs2 = new BlossomFS('oidmap-test', { signer: mockSigner });
    await new Promise(r => setTimeout(r, 20));
    const db = (fs2 as any).dbh.db;
    const tx = db.transaction('oidmap', 'readonly');
    const store = tx.objectStore('oidmap');
    const count = await new Promise<number>((res, rej) => {
      const r = store.count();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    expect(count).toBeGreaterThan(0);
  });

  it('maps Git OIDs to correct Blossom hash', async () => {
    const data = new TextEncoder().encode('map consistency');
    await fs.writeFile('/map/one.txt', data);
    const db = (fs as any).dbh.db;
    const tx = db.transaction('oidmap', 'readonly');
    const store = tx.objectStore('oidmap');
    const all = await new Promise<any[]>((res, rej) => {
      const r = store.getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    
    // Filter for records related to our test file
    const mapRecords = all.filter(rec => rec.path === '/map/one.txt');
    expect(mapRecords.length).toBeGreaterThan(0);
    
    for (const rec of mapRecords) {
      expect(typeof rec.blossomHash).toBe('string');
      expect(rec.blossomHash.length).toBe(64);
      expect(rec.path).toBe('/map/one.txt');
    }
  });
});