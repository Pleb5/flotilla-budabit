// Canonical repository key utilities
// Exported for use across core and UI layers

function sanitizePathSegment(seg: string): string {
  // Remove path separators and normalize whitespace
  return seg
    .replace(/[\\/]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^A-Za-z0-9._-]/g, '-');
}

function looksLikeEventId(id: string): boolean {
  // 64-hex characters typical nostr event id
  return /^[0-9a-fA-F]{64}$/.test(id);
}

export function parseRepoId(input: string): string {
  if (!input || !input.trim()) {
    throw new Error('Invalid repoId: empty. Expected "owner/name" or "npub...:name"');
  }
  const key = input.trim();
  // Accept "owner/name"
  if (key.includes('/')) {
    const [owner, name] = key.split('/', 2);
    if (!owner || !name) {
      throw new Error(`Invalid repoId: "${input}". Expected "owner/name" with both parts present.`);
    }
    return `${sanitizePathSegment(owner)}/${sanitizePathSegment(name)}`;
  }
  // Accept "owner:name" and normalize to slash
  if (key.includes(':')) {
    const [owner, name] = key.split(':', 2);
    if (!owner || !name) {
      throw new Error(`Invalid repoId: "${input}". Expected "owner:name" with both parts present.`);
    }
    return `${sanitizePathSegment(owner)}/${sanitizePathSegment(name)}`;
  }
  // Explicitly reject legacy event-id-only or owner-only identifiers
  if (looksLikeEventId(key)) {
    throw new Error(
      `Invalid repoId: received event id-like value "${key}". Expected canonical repoId "owner/name".`
    );
  }
  throw new Error(
    `Invalid repoId: "${input}". Expected canonical repoId in the form "owner/name" or "owner:name".`
  );
}

export function canonicalRepoKey(repoId: string): string {
  // Use parseRepoId to normalize, then make filesystem-safe
  try {
    const normalized = parseRepoId(repoId);
    return normalized.replace(/[^a-zA-Z0-9_\-\/]/g, "_");
  } catch {
    return repoId.replace(/[^a-zA-Z0-9_\-\/]/g, "_");
  }
}
