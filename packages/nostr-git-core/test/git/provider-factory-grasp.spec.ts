import { describe, it, expect } from 'vitest';
import { getGitServiceApi } from '../../src/git/provider-factory.js';
import { GraspApiProvider } from '../../src/api/providers/grasp.js';

describe('provider-factory GRASP selection', () => {
  it('throws when baseUrl is missing for grasp', () => {
    expect(() => getGitServiceApi('grasp' as any, 'deadbeef')).toThrow(/GRASP provider requires a relay URL/);
  });

  it('returns GraspApiProvider when baseUrl provided', () => {
    const api = getGitServiceApi('grasp' as any, 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef', 'wss://relay.example');
    expect(api).toBeInstanceOf(GraspApiProvider);
  });
});
