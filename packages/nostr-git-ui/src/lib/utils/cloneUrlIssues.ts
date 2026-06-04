export type CloneUrlIssueKind = "auth" | "not-found" | "network" | "unknown";

const AUTH_PATTERNS = [
  "401",
  "403",
  "forbidden",
  "unauthorized",
  "permission denied",
  "bad credentials",
  "authentication required",
  "no tokens found",
];

const NOT_FOUND_PATTERNS = ["404", "not found"];

const NETWORK_PATTERNS = [
  "timeout",
  "timed out",
  "failed to fetch",
  "network",
  "cors",
  "enotfound",
  "econn",
  "certificate",
  "tls",
  "ssl",
  "429",
  "rate limit",
  "service unavailable",
  "temporarily unavailable",
  "abort",
];

export function classifyCloneUrlIssue(
  error?: string,
  status?: number
): { kind: CloneUrlIssueKind; summary: string } {
  const details = String(error || "").trim();
  const lower = details.toLowerCase();
  const code = Number(status || 0);

  if (code === 401 || code === 403 || AUTH_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return {
      kind: "auth",
      summary: "recent authenticated read failed",
    };
  }

  if (code === 404 || NOT_FOUND_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return {
      kind: "not-found",
      summary: "recent read returned not found",
    };
  }

  if (code === 429 || code >= 500 || NETWORK_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return {
      kind: "network",
      summary: "recent read hiccup",
    };
  }

  return {
    kind: "unknown",
    summary: "recent read issue",
  };
}

export function getCloneUrlBannerTitle(params: {
  hasPrimaryIssue: boolean;
  issueCount: number;
}): string {
  const { hasPrimaryIssue, issueCount } = params;
  const plural = issueCount === 1 ? "issue" : "issues";

  if (hasPrimaryIssue) {
    return `Recent primary remote read ${plural}`;
  }

  return `Recent remote read ${plural}`;
}
