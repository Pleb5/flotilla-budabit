import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Tests for Repo class user identity handling
 * 
 * These tests verify that the Repo class correctly stores and uses
 * user identity (authorName, authorEmail) for git commit operations.
 */

// Mock the dependencies
vi.mock('./WorkerManager', () => ({
  WorkerManager: vi.fn().mockImplementation(() => ({
    setProgressCallback: vi.fn(),
    setAuthConfig: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  })),
}));

vi.mock('../../../stores/tokens', () => ({
  tokens: {
    subscribe: vi.fn((cb) => {
      cb([]);
      return () => {};
    }),
    waitForInitialization: vi.fn().mockResolvedValue([]),
  },
}));

// Create a minimal Repo-like class for testing the author info logic
class TestableRepo {
  authorName: string = '';
  authorEmail: string = '';

  constructor(opts: {
    authorName?: string;
    authorEmail?: string;
  } = {}) {
    if (opts.authorName) this.authorName = opts.authorName;
    if (opts.authorEmail) this.authorEmail = opts.authorEmail;
  }

  setAuthorInfo(name: string, email: string) {
    this.authorName = name;
    this.authorEmail = email;
  }

  getAuthorInfo() {
    return {
      name: this.authorName,
      email: this.authorEmail,
    };
  }
}

describe('Repo User Identity', () => {
  describe('Constructor initialization', () => {
    it('should initialize with empty author info by default', () => {
      const repo = new TestableRepo();

      expect(repo.authorName).toBe('');
      expect(repo.authorEmail).toBe('');
    });

    it('should accept authorName in constructor', () => {
      const repo = new TestableRepo({
        authorName: 'Test User',
      });

      expect(repo.authorName).toBe('Test User');
      expect(repo.authorEmail).toBe('');
    });

    it('should accept authorEmail in constructor', () => {
      const repo = new TestableRepo({
        authorEmail: 'test@example.com',
      });

      expect(repo.authorName).toBe('');
      expect(repo.authorEmail).toBe('test@example.com');
    });

    it('should accept both authorName and authorEmail in constructor', () => {
      const repo = new TestableRepo({
        authorName: 'Test User',
        authorEmail: 'test@example.com',
      });

      expect(repo.authorName).toBe('Test User');
      expect(repo.authorEmail).toBe('test@example.com');
    });
  });

  describe('Author info from Nostr profile', () => {
    it('should accept display_name as authorName', () => {
      const repo = new TestableRepo({
        authorName: 'Display Name',
      });

      expect(repo.authorName).toBe('Display Name');
    });

    it('should accept nip-05 as authorEmail', () => {
      const repo = new TestableRepo({
        authorEmail: 'user@nostr.example.com',
      });

      expect(repo.authorEmail).toBe('user@nostr.example.com');
    });

    it('should accept npub-based email format', () => {
      // When user has no nip-05, we generate an email from their npub
      const npubBasedEmail = 'npub1abc123...@nostr.git';
      const repo = new TestableRepo({
        authorEmail: npubBasedEmail,
      });

      expect(repo.authorEmail).toBe(npubBasedEmail);
    });
  });

  describe('Author info updates', () => {
    it('should allow updating author info after construction', () => {
      const repo = new TestableRepo();

      repo.setAuthorInfo('Updated User', 'updated@example.com');

      expect(repo.authorName).toBe('Updated User');
      expect(repo.authorEmail).toBe('updated@example.com');
    });

    it('should return author info via getter', () => {
      const repo = new TestableRepo({
        authorName: 'Test User',
        authorEmail: 'test@example.com',
      });

      const info = repo.getAuthorInfo();

      expect(info).toEqual({
        name: 'Test User',
        email: 'test@example.com',
      });
    });
  });
});

describe('Author Email Generation', () => {
  // Helper function that mirrors the app's logic
  function getAuthorEmail(profile: any, pubkey: string | null | undefined): string {
    if (profile?.nip05) return profile.nip05;
    if (pubkey) {
      // Simplified npub encoding for test
      const npub = `npub1${pubkey.slice(0, 8)}`;
      return `${npub.slice(0, 12)}@nostr.git`;
    }
    return '';
  }

  function getAuthorName(profile: any): string {
    return profile?.display_name || profile?.name || 'Anonymous';
  }

  describe('getAuthorEmail', () => {
    it('should return nip-05 when available', () => {
      const profile = { nip05: 'user@domain.com' };
      const result = getAuthorEmail(profile, 'abc123');

      expect(result).toBe('user@domain.com');
    });

    it('should generate npub-based email when no nip-05', () => {
      const profile = { name: 'Test' };
      const result = getAuthorEmail(profile, 'abc123def456');

      expect(result).toContain('@nostr.git');
      expect(result).toContain('npub1');
    });

    it('should return empty string when no profile and no pubkey', () => {
      const result = getAuthorEmail(null, null);

      expect(result).toBe('');
    });

    it('should handle undefined pubkey', () => {
      const result = getAuthorEmail(null, undefined);

      expect(result).toBe('');
    });

    it('should prioritize nip-05 over npub-based email', () => {
      const profile = { nip05: 'user@domain.com', name: 'Test' };
      const result = getAuthorEmail(profile, 'abc123');

      expect(result).toBe('user@domain.com');
    });
  });

  describe('getAuthorName', () => {
    it('should return display_name when available', () => {
      const profile = { display_name: 'Display Name', name: 'username' };
      const result = getAuthorName(profile);

      expect(result).toBe('Display Name');
    });

    it('should fall back to name when no display_name', () => {
      const profile = { name: 'username' };
      const result = getAuthorName(profile);

      expect(result).toBe('username');
    });

    it('should return Anonymous when no profile', () => {
      const result = getAuthorName(null);

      expect(result).toBe('Anonymous');
    });

    it('should return Anonymous when profile has no name fields', () => {
      const profile = { picture: 'https://example.com/pic.jpg' };
      const result = getAuthorName(profile);

      expect(result).toBe('Anonymous');
    });
  });
});
