/** Suggest an identifier for a NEW repository; never normalize an existing d tag. */
export function suggestRepoIdentifier(name: string): string {
  return name
    .trim()
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

export function validateRepoIdentifier(identifier: string): string | undefined {
  if (!identifier) return "Repository identifier is required"
  if (identifier.length > 100) return "Repository identifier must be 100 characters or less"
  if (!/^[a-zA-Z0-9._-]+$/.test(identifier) || !/[a-zA-Z0-9]/.test(identifier)) {
    return "Use letters, digits, dots, underscores or hyphens for the repository identifier"
  }
  if (identifier.startsWith(".") || identifier.includes("..") || /\.git$/i.test(identifier)) {
    return "Repository identifier cannot start with a dot, contain '..', or end in '.git'"
  }
  return undefined
}

export function validateRepoDisplayName(name: string): string | undefined {
  if (!name.trim()) return "Repository display name is required"
  if (name.length > 100) return "Repository display name must be 100 characters or less"
  return undefined
}
