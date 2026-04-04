/**
 * Compare two semantic version strings.
 * Returns:
 *  1 if v1 > v2
 *  0 if v1 === v2
 * -1 if v1 < v2
 */
export function compareVersions(v1: string | undefined, v2: string | undefined): number {
  if (!v1 && !v2) return 0
  if (!v1) return -1
  if (!v2) return 1

  // Remove leading 'v' if present
  const clean1 = v1.replace(/^v/, '')
  const clean2 = v2.replace(/^v/, '')

  const parts1 = clean1.split('.').map(p => parseInt(p, 10) || 0)
  const parts2 = clean2.split('.').map(p => parseInt(p, 10) || 0)

  const maxLength = Math.max(parts1.length, parts2.length)

  for (let i = 0; i < maxLength; i++) {
    const p1 = parts1[i] || 0
    const p2 = parts2[i] || 0

    if (p1 > p2) return 1
    if (p1 < p2) return -1
  }

  return 0
}

/**
 * Check if an update is available by comparing installed vs available version.
 */
export function hasUpdate(
  installedVersion: string | undefined,
  availableVersion: string | undefined
): boolean {
  return compareVersions(availableVersion, installedVersion) > 0
}
