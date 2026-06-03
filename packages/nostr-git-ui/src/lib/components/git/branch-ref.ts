const REF_PREFIXES = [
  "ref: refs/heads/",
  "ref: refs/tags/",
  "refs/heads/",
  "refs/tags/",
  "refs/remotes/origin/",
  "origin/",
  "heads/",
  "tags/",
] as const;

export function normalizeGitRefName(input?: string): string {
  const raw = String(input || "").trim();
  if (!raw) return "";

  for (const prefix of REF_PREFIXES) {
    if (raw.startsWith(prefix)) {
      const normalized = raw.slice(prefix.length);
      return normalized.trim();
    }
  }

  return raw;
}

export function getGitRefMismatch(
  requested?: string,
  actual?: string
): { requested: string; actual: string } | null {
  const requestedName = normalizeGitRefName(requested);
  const actualName = normalizeGitRefName(actual);

  if (!requestedName || !actualName || requestedName === actualName) {
    return null;
  }

  return { requested: requestedName, actual: actualName };
}

export function isPeeledTagName(name?: string): boolean {
  return normalizeGitRefName(name).endsWith("^{}");
}

export function isDisplayableGitRef(ref?: { name?: string; type?: "heads" | "tags" }): boolean {
  const name = normalizeGitRefName(ref?.name);
  if (!name) return false;
  if (ref?.type === "tags" && isPeeledTagName(name)) return false;
  return true;
}
