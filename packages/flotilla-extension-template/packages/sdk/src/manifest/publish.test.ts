// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  publish: vi.fn(),
  uploadToBlossom: vi.fn(),
}));

vi.mock('commander', () => ({
  Command: class {
    name() {
      return this;
    }
    description() {
      return this;
    }
    requiredOption() {
      return this;
    }
    option() {
      return this;
    }
    action() {
      return this;
    }
    parse() {
      return this;
    }
  },
}));

vi.mock('nostr-tools/pool', () => ({
  SimplePool: class {
    publish = mocks.publish;
    close = mocks.close;
  },
}));

vi.mock('./upload.js', () => ({
  getArtifactPath: vi.fn(),
  uploadToBlossom: mocks.uploadToBlossom,
  uploadToGithubRelease: vi.fn(),
}));

import { publishWidget, type PublishOptions } from './publish.js';

describe('publishWidget()', () => {
  let tempDir: string;
  let eventPath: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'budabit-publish-'));
    eventPath = join(tempDir, 'event.json');
    writeFileSync(
      eventPath,
      JSON.stringify({
        kind: 30033,
        created_at: 1_700_000_000,
        content: 'Test widget',
        tags: [
          ['d', 'test-widget'],
          ['button', 'Open', 'app', 'https://placeholder.example/widget.html'],
        ],
      })
    );
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function options(relays: string[]): PublishOptions {
    return {
      eventPath,
      relays,
      secretKey: '01'.repeat(32),
      dryRun: false,
    };
  }

  it('rejects publishing without tagged community relays', async () => {
    await expect(publishWidget(options([]))).rejects.toThrow('No community relays supplied');
    expect(mocks.publish).not.toHaveBeenCalled();
  });

  it('aborts without publishing when an upload-first Blossom upload rejects', async () => {
    const secret = 'upload-auth-secret';
    mocks.uploadToBlossom.mockRejectedValueOnce(new Error(`rejected: ${secret}`));

    await expect(
      publishWidget({
        ...options(['wss://relay.example']),
        uploadFirst: true,
        blossomServers: ['https://blossom.example'],
        artifactPath: '/tmp/widget.html',
      })
    ).rejects.toThrow('Pre-signing artifact upload failed');

    expect(mocks.publish).not.toHaveBeenCalled();
    expect(
      JSON.stringify([
        vi.mocked(console.log).mock.calls,
        vi.mocked(console.warn).mock.calls,
        vi.mocked(console.error).mock.calls,
      ])
    ).not.toContain(secret);
  });

  it('signs with a hex local key using nostr-tools-compatible bytes', async () => {
    mocks.publish.mockReturnValue([Promise.resolve('')]);

    await publishWidget(options(['wss://relay.example']));

    expect(mocks.publish).toHaveBeenCalledWith(
      ['wss://relay.example'],
      expect.objectContaining({
        pubkey: '1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f',
        kind: 30033,
        sig: expect.any(String),
      })
    );
  });

  it('classifies fulfilled relay error strings as failures', async () => {
    mocks.publish.mockReturnValue([
      Promise.resolve('error: relay rejected event'),
      Promise.resolve('rate-limited: slow down'),
    ]);

    await expect(
      publishWidget(options(['wss://one.example', 'wss://two.example']))
    ).rejects.toThrow('Failed to publish widget to any relay');

    expect(mocks.close).toHaveBeenCalledWith(['wss://one.example', 'wss://two.example']);
  });

  it('succeeds when at least one relay publishes among mixed results', async () => {
    mocks.publish.mockImplementationOnce(() => [
      Promise.resolve(''),
      Promise.resolve('blocked: policy'),
      Promise.reject(new Error('connection failed')),
    ]);

    await expect(
      publishWidget(
        options(['wss://success.example', 'wss://blocked.example', 'wss://offline.example'])
      )
    ).resolves.toBeUndefined();

    expect(console.log).toHaveBeenCalledWith('✅ Published to 1 relay(s):');
    expect(console.log).toHaveBeenCalledWith('⚠️  Failed on 2 relay(s):');
  });

  it('throws when every relay publication rejects', async () => {
    mocks.publish.mockImplementationOnce(() => [
      Promise.reject(new Error('offline')),
      Promise.reject(new Error('timed out')),
    ]);

    await expect(
      publishWidget(options(['wss://one.example', 'wss://two.example']))
    ).rejects.toThrow('Failed to publish widget to any relay');
  });
});
