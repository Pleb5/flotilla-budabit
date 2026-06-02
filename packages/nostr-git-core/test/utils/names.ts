/**
 * Unique naming utilities for tests.
 *
 * LightningFS uses IndexedDB and can collide across parallel tests if names repeat.
 * These helpers provide deterministic-but-unique identifiers with optional prefixes.
 */

let __counter = 0;

function sanitizePrefix(prefix: string): string {
  return String(prefix || 'test')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .slice(0, 60);
}

export function uniqueId(prefix: string = 'id'): string {
  __counter += 1;
  const p = sanitizePrefix(prefix);
  const rand = Math.random().toString(16).slice(2, 10);
  return `${p}-${Date.now()}-${__counter}-${rand}`;
}

export function uniqueFsName(prefix: string = 'fs'): string {
  return uniqueId(`lfs-${prefix}`);
}

export function uniqueRepoDir(prefix: string = 'repo'): string {
  return `/${uniqueId(prefix)}`;
}