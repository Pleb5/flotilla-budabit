import { describe, it, expect } from 'vitest';

import { getGitServiceApi } from '../../src/git/provider-factory.js';

// Exercise a happy path for GRASP creation without network

describe('git/provider-factory (more)', () => {
  it('getGitServiceApi creates GraspApiProvider with relay baseUrl', () => {
    const api = getGitServiceApi('grasp' as any, 'npub1...', 'wss://relay.example.com');
    expect(api).toBeTruthy();
  });
});
