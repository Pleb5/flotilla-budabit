import { describe, it, expect } from 'vitest';
import 'fake-indexeddb/auto';

import {
  resolveVendorProvider,
  getVendorProvider,
  parseRepoFromUrl,
  registerProviderOverride,
  clearProviderOverrides,
  clearProviderRegistry,
} from '../../src/git/vendor-provider-factory.js';

describe('vendor-provider-factory more edges', () => {
  it('resolveVendorProvider caches provider per hostname', () => {
    clearProviderRegistry();
    const a = resolveVendorProvider('https://github.com/owner/repo');
    const b = resolveVendorProvider('https://github.com/other/another');
    expect(a).toBe(b);
  });

  it('getVendorProvider caches by vendor:hostname', () => {
    clearProviderRegistry();
    const a = getVendorProvider('gitlab', 'gitlab.example.com');
    const b = getVendorProvider('gitlab', 'gitlab.example.com');
    const c = getVendorProvider('gitlab', 'other.example.com');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('parseRepoFromUrl handles SSH-like git URLs and hostname-only URLs', () => {
    clearProviderRegistry();
    const ssh = parseRepoFromUrl('git@github.com:octo/repo.git');
    expect(ssh).toBeTruthy();
    expect(ssh!.owner).toBe('octo');
    expect(ssh!.repo).toBe('repo');

    const hostOnly = parseRepoFromUrl('github.com/octo/repo');
    expect(hostOnly).toBeTruthy();
    expect(hostOnly!.owner).toBe('octo');
    expect(hostOnly!.repo).toBe('repo');
  });

  it('registerProviderOverride forces vendor type for given hostname', () => {
    clearProviderRegistry();
    clearProviderOverrides();
    registerProviderOverride('enterprise.example.com', 'github');
    const p = resolveVendorProvider('https://enterprise.example.com/org/repo');
    expect(p.vendor).toBe('github');
    clearProviderOverrides();
  });

  it('builds self-hosted REST API URLs from provider hostnames', () => {
    clearProviderRegistry();
    clearProviderOverrides();

    registerProviderOverride('enterprise.example.com', 'github');
    const github = resolveVendorProvider('https://enterprise.example.com/org/repo');
    expect(github.getApiUrl('/repos/org/repo/commits/abc123')).toBe(
      'https://enterprise.example.com/api/v3/repos/org/repo/commits/abc123'
    );

    const gitlab = resolveVendorProvider('https://gitlab.example.com/group/subgroup/repo');
    expect(gitlab.getApiUrl('/projects/group%2Fsubgroup%2Frepo/repository/commits/abc123')).toBe(
      'https://gitlab.example.com/api/v4/projects/group%2Fsubgroup%2Frepo/repository/commits/abc123'
    );

    clearProviderOverrides();
  });

  it('clearProviderRegistry resets the cache creating a new instance for same hostname', () => {
    clearProviderRegistry();
    const p1 = resolveVendorProvider('https://cache-reset.example.com/a/b');
    clearProviderRegistry();
    const p2 = resolveVendorProvider('https://cache-reset.example.com/c/d');
    expect(p2).not.toBe(p1);
  });

  it('parseRepoFromUrl returns null on invalid input', () => {
    const bad = parseRepoFromUrl('invalid::');
    expect(bad).toBeNull();
  });
});
