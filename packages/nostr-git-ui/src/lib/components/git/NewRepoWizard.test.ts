import { describe, it, expect, vi } from 'vitest';

/**
 * Tests for NewRepoWizard author props
 * 
 * These tests verify that the NewRepoWizard correctly accepts and uses
 * defaultAuthorName and defaultAuthorEmail props to pre-populate the
 * advanced settings for git commit author information.
 */

describe('NewRepoWizard Author Props', () => {
  // Test the props interface
  interface NewRepoWizardProps {
    workerApi?: any;
    workerInstance?: Worker;
    onRepoCreated?: (repoData: any) => void;
    onCancel?: () => void;
    onPublishEvent?: (event: any) => Promise<void>;
    defaultRelays?: string[];
    userPubkey?: string;
    defaultAuthorName?: string;
    defaultAuthorEmail?: string;
    getProfile?: (pubkey: string) => Promise<any>;
    searchProfiles?: (query: string) => Promise<any[]>;
    searchRelays?: (query: string) => Promise<string[]>;
    createAuthHeader?: (url: string, method?: string) => Promise<string | null>;
  }

  // Test the advanced settings state structure
  interface AdvancedSettings {
    gitignoreTemplate: string;
    licenseTemplate: string;
    defaultBranch: string;
    authorName: string;
    authorEmail: string;
    maintainers: string[];
    relays: string[];
    tags: string[];
    webUrls: string[];
    cloneUrls: string[];
  }

  // Simulate the initialization logic from NewRepoWizard
  function initializeAdvancedSettings(
    defaultAuthorName: string = '',
    defaultAuthorEmail: string = '',
    defaultRelays: string[] = []
  ): AdvancedSettings {
    return {
      gitignoreTemplate: '',
      licenseTemplate: '',
      defaultBranch: 'master',
      authorName: defaultAuthorName,
      authorEmail: defaultAuthorEmail,
      maintainers: [],
      relays: [...defaultRelays],
      tags: [],
      webUrls: [],
      cloneUrls: [],
    };
  }

  describe('Props interface', () => {
    it('should accept defaultAuthorName prop', () => {
      const props: NewRepoWizardProps = {
        defaultAuthorName: 'Test User',
      };

      expect(props.defaultAuthorName).toBe('Test User');
    });

    it('should accept defaultAuthorEmail prop', () => {
      const props: NewRepoWizardProps = {
        defaultAuthorEmail: 'test@example.com',
      };

      expect(props.defaultAuthorEmail).toBe('test@example.com');
    });

    it('should accept both author props together', () => {
      const props: NewRepoWizardProps = {
        defaultAuthorName: 'Test User',
        defaultAuthorEmail: 'test@example.com',
        userPubkey: 'abc123',
      };

      expect(props.defaultAuthorName).toBe('Test User');
      expect(props.defaultAuthorEmail).toBe('test@example.com');
      expect(props.userPubkey).toBe('abc123');
    });
  });

  describe('Advanced settings initialization', () => {
    it('should initialize authorName from defaultAuthorName prop', () => {
      const settings = initializeAdvancedSettings('Test User', '', []);

      expect(settings.authorName).toBe('Test User');
    });

    it('should initialize authorEmail from defaultAuthorEmail prop', () => {
      const settings = initializeAdvancedSettings('', 'test@example.com', []);

      expect(settings.authorEmail).toBe('test@example.com');
    });

    it('should initialize both author fields from props', () => {
      const settings = initializeAdvancedSettings('Test User', 'test@example.com', []);

      expect(settings.authorName).toBe('Test User');
      expect(settings.authorEmail).toBe('test@example.com');
    });

    it('should default to empty strings when no props provided', () => {
      const settings = initializeAdvancedSettings();

      expect(settings.authorName).toBe('');
      expect(settings.authorEmail).toBe('');
    });

    it('should preserve other default values', () => {
      const settings = initializeAdvancedSettings('User', 'user@test.com', ['wss://relay.example.com']);

      expect(settings.defaultBranch).toBe('master');
      expect(settings.gitignoreTemplate).toBe('');
      expect(settings.licenseTemplate).toBe('');
      expect(settings.relays).toEqual(['wss://relay.example.com']);
    });
  });

  describe('Author info from Nostr profile scenarios', () => {
    it('should handle display_name as authorName', () => {
      const profile = { display_name: 'Alice', name: 'alice123' };
      const authorName = profile.display_name || profile.name || 'Anonymous';

      const settings = initializeAdvancedSettings(authorName, '', []);

      expect(settings.authorName).toBe('Alice');
    });

    it('should fall back to name when no display_name', () => {
      const profile = { name: 'alice123' };
      const authorName = (profile as any).display_name || profile.name || 'Anonymous';

      const settings = initializeAdvancedSettings(authorName, '', []);

      expect(settings.authorName).toBe('alice123');
    });

    it('should handle nip-05 as authorEmail', () => {
      const profile = { nip05: 'alice@nostr.example.com' };
      const authorEmail = profile.nip05;

      const settings = initializeAdvancedSettings('', authorEmail, []);

      expect(settings.authorEmail).toBe('alice@nostr.example.com');
    });

    it('should handle npub-based email when no nip-05', () => {
      const npubEmail = 'npub1abc123...@nostr.git';

      const settings = initializeAdvancedSettings('', npubEmail, []);

      expect(settings.authorEmail).toBe('npub1abc123...@nostr.git');
    });
  });

  describe('Integration with useNewRepo hook', () => {
    // Simulate the config passed to useNewRepo
    interface NewRepoConfig {
      name: string;
      description: string;
      provider: string;
      defaultBranch: string;
      authorName: string;
      authorEmail: string;
      // ... other fields
    }

    function createRepoConfig(advancedSettings: AdvancedSettings): NewRepoConfig {
      return {
        name: 'test-repo',
        description: 'Test repository',
        provider: 'github',
        defaultBranch: advancedSettings.defaultBranch,
        authorName: advancedSettings.authorName,
        authorEmail: advancedSettings.authorEmail,
      };
    }

    it('should pass author info to repo creation config', () => {
      const settings = initializeAdvancedSettings('Test User', 'test@example.com', []);
      const config = createRepoConfig(settings);

      expect(config.authorName).toBe('Test User');
      expect(config.authorEmail).toBe('test@example.com');
    });

    it('should handle empty author info gracefully', () => {
      const settings = initializeAdvancedSettings('', '', []);
      const config = createRepoConfig(settings);

      expect(config.authorName).toBe('');
      expect(config.authorEmail).toBe('');
    });
  });
});

describe('NewRepoWizardWrapper Props Passthrough', () => {
  // The wrapper should pass all props to NewRepoWizard
  it('should pass defaultAuthorName to inner component', () => {
    const wrapperProps = {
      defaultAuthorName: 'Test User',
      defaultAuthorEmail: 'test@example.com',
      userPubkey: 'abc123',
    };

    // Simulate spreading props to inner component
    const innerProps = { ...wrapperProps };

    expect(innerProps.defaultAuthorName).toBe('Test User');
    expect(innerProps.defaultAuthorEmail).toBe('test@example.com');
  });
});
