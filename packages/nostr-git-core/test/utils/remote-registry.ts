import type { VirtualGitRemote } from '../git/virtual-remote.js';

export interface RemoteRegistry {
  register: (url: string, remote: VirtualGitRemote) => void;
  unregister: (url: string) => void;
  get: (url: string) => VirtualGitRemote | undefined;
  urls: () => string[];
}

function normalizeUrl(url: string): string {
  return String(url || '')
    .trim()
    .replace(/\/+$/g, '');
}

export function createRemoteRegistry(): RemoteRegistry {
  const map = new Map<string, VirtualGitRemote>();

  return {
    register(url: string, remote: VirtualGitRemote) {
      map.set(normalizeUrl(url), remote);
    },
    unregister(url: string) {
      map.delete(normalizeUrl(url));
    },
    get(url: string) {
      return map.get(normalizeUrl(url));
    },
    urls() {
      return Array.from(map.keys());
    }
  };
}

export function normalizeRemoteUrl(url: string): string {
  return normalizeUrl(url);
}