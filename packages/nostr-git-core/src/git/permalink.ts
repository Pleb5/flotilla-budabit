export interface PermalinkData {
  host: string;
  platform: 'github' | 'gitlab' | 'gitea' | 'unknown';
  owner: string;
  repo: string;
  branch: string;
  filePath: string;
  startLine?: number;
  endLine?: number;
  isDiff?: boolean;
  diffFileHash?: string;
  diffSide?: 'L' | 'R';
}

/**
 * Determines if the URL is a valid permalink for GitHub, GitLab, or Gitea.
 * @param url - The URL to check.
 * @returns True if the URL is a valid permalink; otherwise, false.
 */
export function isPermalink(url: string): boolean {
  try {
    const parsed = new URL(url);
    const { hostname, pathname } = parsed;
    const pathParts = pathname.split('/').filter(Boolean);
    const isGitHub = hostname.includes('github') && pathParts.length >= 4;
    const isGitLab = hostname.includes('gitlab') && pathParts.includes('blob');
    const isGitea = hostname.includes('gitea') && pathParts.length >= 5;
    return isGitHub || isGitLab || isGitea;
  } catch (err) {
    console.log(err);
    return false;
  }
}

/**
 * Parses a URL to extract relevant data for GitHub, GitLab, or Gitea.
 * Returns null if the URL is not a valid permalink.
 * @param url - The URL to parse.
 * @returns An object containing the parsed data or null if invalid.
 */
export function parsePermalink(url: string): PermalinkData | null {
  try {
    const parsed = new URL(url);
    const { hostname, hash } = parsed;

    let platform: PermalinkData['platform'] = 'unknown';

    if (hostname.includes('github')) {
      platform = 'github';
    } else if (hostname.includes('gitlab')) {
      platform = 'gitlab';
    } else if (hostname.includes('gitea')) {
      platform = 'gitea';
    }

    let startLine: number | undefined;
    let endLine: number | undefined;
    let diffFileHash: string | undefined;
    let diffSide: 'L' | 'R' | undefined;
    let isDiff = false;

    const fragment = hash.replace(/^#/, '');

    // Check if it starts with "diff-"
    // e.g. "diff-189f7772bb...L19-L20" or "...R21-R22"
    if (fragment.startsWith('diff-')) {
      isDiff = true;
      const diffRegex = /^diff-([a-f0-9]+)([LR])(\d+)(-[LR]?(\d+))?$/i;

      const match = fragment.match(diffRegex);
      if (!match) {
        // Possibly no lines or something else. We'll parse up to the file-hash if we want
        // but if we can't parse lines, we return null or we skip line data.
        diffFileHash = fragment.slice('diff-'.length);
      } else {
        diffFileHash = match[1];
        diffSide = match[2] as 'L' | 'R';
        startLine = parseInt(match[3], 10);
        if (match[4]) {
          // If there's a range
          const endRaw = match[5];
          if (endRaw) {
            endLine = parseInt(endRaw, 10);
          }
        }
      }
    } else {
      // e.g. "L10-L20" (GitHub style) or "L1-3" (GitLab style)
      if (fragment.startsWith('L')) {
        // remove the leading 'L'
        const str = fragment.slice(1); // e.g. "10-L20" or "1-3"
        const dashIndex = str.indexOf('-');
        if (dashIndex === -1) {
          // single line, e.g. "#L10"
          startLine = parseInt(str, 10) || undefined;
        } else {
          // e.g. "10-L20" or "1-3"
          // left side is start line
          const startRaw = str.slice(0, dashIndex).replace(/\D/g, '');
          startLine = parseInt(startRaw, 10) || undefined;

          // right side might have an 'L' (GitHub style) or no 'L' (GitLab style)
          let tail = str.slice(dashIndex + 1); // e.g. "L20" or "3"
          tail = tail.replace(/^L/, ''); // remove leading 'L' if present
          const endRaw = tail.replace(/\D/g, '');
          endLine = parseInt(endRaw, 10) || undefined;
        }
      }
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);
    if (!pathParts.length) return null;

    let owner = '';
    let repo = '';
    let branch = '';
    let filePath = '';

    switch (platform) {
      case 'github': {
        // Two main patterns:
        // 1) /owner/repo/blob/<branch>/<filePath>...
        // 2) /owner/repo/commit/<sha> if it's a commit link, etc.
        if (pathParts.length < 3) return null;

        owner = pathParts[0];
        repo = pathParts[1];

        // If we see "blob", parse as normal. If we see "commit", parse that way.
        const thirdSegment = pathParts[2];

        if (thirdSegment === 'blob') {
          if (pathParts.length < 4) return null;
          branch = pathParts[3];
          filePath = pathParts.slice(4).join('/');
        } else if (thirdSegment === 'commit') {
          // e.g. /owner/repo/commit/<sha>
          if (pathParts.length < 4) return null;
          branch = pathParts[3]; // store the commit SHA in 'branch'
          // If there's a #diff-..., the actual file path might not be present in the URL
          // so we might do filePath='' or do a fallback.
          // Usually for a diff link, the actual file name is derived from #diff-hash.
          filePath = ''; // we'll rely on the diff hash to identify the file
        } else {
          return null;
        }
        break;
      }
      case 'gitlab': {
        const blobIndex = pathParts.indexOf('blob');
        if (blobIndex === -1) return null;
        owner = pathParts[0];
        repo = pathParts.slice(1, blobIndex - 1).join('/');
        branch = pathParts[blobIndex + 1];
        filePath = pathParts.slice(blobIndex + 2).join('/');
        break;
      }
      case 'gitea':
        if (pathParts.length < 5) return null;
        owner = pathParts[0];
        repo = pathParts[1];
        if (pathParts[2] !== 'src' || pathParts[3] !== 'commit') return null;
        branch = pathParts[4];
        filePath = pathParts.slice(5).join('/');
        break;
      default:
        return null;
    }

    return {
      host: hostname,
      platform,
      owner,
      repo,
      branch,
      filePath,
      startLine,
      endLine,
      isDiff,
      diffFileHash,
      diffSide
    };
  } catch (err) {
    console.log(err);
    return null;
  }
}
