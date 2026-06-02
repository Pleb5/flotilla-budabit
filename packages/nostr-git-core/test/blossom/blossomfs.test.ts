import { describe, it, expect, beforeEach, vi } from 'vitest';
import BlossomFS, { Signer } from '../../src/blossom/index.js';
import { NostrEvent } from 'nostr-tools';
// Polyfills for IndexedDB + fetch (Node/Jsdom environment)
import 'fake-indexeddb/auto';
import { TextEncoder, TextDecoder } from 'util';
globalThis.TextEncoder = TextEncoder as any;
globalThis.TextDecoder = TextDecoder as any;

// Mock fetch for Blossom endpoints
const mockFetch = vi.fn();
globalThis.fetch = mockFetch as any;

// Mock signer implementing NIP-07/NIP-46
const mockSigner: Signer = {
  async getPublicKey() {
    return 'deadbeef'.repeat(8);
  },
  async signEvent(evt: NostrEvent) {
    return { ...evt, id: 'eventid', sig: 'signature' };
  },
};

describe('BlossomFS basic operations', () => {
  let fs: BlossomFS;

  beforeEach(async () => {
    mockFetch.mockReset();
    fs = new BlossomFS('testfs', { signer: mockSigner });
    // Wait for DB init
    await new Promise((r) => setTimeout(r, 20));
  });

  it('creates and reads a file', async () => {
    const data = new TextEncoder().encode('hello world');
    await fs.writeFile('/greeting.txt', data);

    const read = await fs.readFile('/greeting.txt');
    expect(new TextDecoder().decode(read)).toBe('hello world');

    const stat = await fs.stat('/greeting.txt');
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(data.length);
  });

  it('creates a nested directory tree automatically', async () => {
    const data = new TextEncoder().encode('deep data');
    await fs.writeFile('/nested/dir/file.txt', data);

    const list = await fs.readdir('/nested/dir');
    expect(list).toContain('file.txt');

    const stat = await fs.stat('/nested/dir/file.txt');
    expect(stat.isFile()).toBe(true);
  });

  it('deletes a file and updates parent directory', async () => {
    const data = new TextEncoder().encode('temporary');
    await fs.writeFile('/tmp/test.txt', data);

    await fs.unlink('/tmp/test.txt');
    const list = await fs.readdir('/tmp');
    expect(list).not.toContain('test.txt');
  });

  it('uploads a large file via Blossom', async () => {
    // Mock upload response
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      json: async () => ({ sha256: 'abc123', size: 42 }),
    }));

    const data = new Uint8Array(50 * 1024); // 50KB
    await fs.writeFile('/bigfile.bin', data);

    const rec = await (fs as any)._getFile('/bigfile.bin');
    expect(rec.blossomHash).toBe('abc123');
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/upload$/),
      expect.objectContaining({ method: 'PUT' })
    );
  });

  it('fetches from Blossom when data missing', async () => {
    const testBlob = new TextEncoder().encode('blossom data');
    // Calculate the correct SHA-256 hash for the test data
    const hashBuffer = await crypto.subtle.digest('SHA-256', new Uint8Array(testBlob));
    const hashArray = new Uint8Array(hashBuffer);
    const hashHex = Array.from(hashArray).map(b => b.toString(16).padStart(2, '0')).join('');
    
    mockFetch.mockImplementationOnce(async () => ({
      ok: true,
      arrayBuffer: async () => testBlob.buffer,
    }));

    const rec = {
      isDir: false,
      size: testBlob.length,
      mtime: Date.now(),
      blossomHash: hashHex,
    };
    await (fs as any)._putFile('/remote.txt', rec);

    const data = await fs.readFile('/remote.txt');
    expect(new TextDecoder().decode(data)).toBe('blossom data');
  });
});