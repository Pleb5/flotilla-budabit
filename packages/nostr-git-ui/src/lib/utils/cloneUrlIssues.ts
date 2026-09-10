export type CloneUrlIssueKind = "auth" | "not-found" | "network" | "unknown";

export type RemoteReadFailureKind =
  | "connectivity"
  | "cors-proxy"
  | "authentication"
  | "http-endpoint"
  | "parser"
  | "capability"
  | "object"
  | "cancellation"
  | "operation-timeout"
  | "unknown";

export interface RemoteReadFailureClassification {
  kind: RemoteReadFailureKind;
  endpointIssue: boolean;
  summary: string;
}

export interface ReadFallbackMessageInput {
  operation?: string;
  activeFallbackUrl?: string;
  failures: Array<{
    url: string;
    kind: RemoteReadFailureKind;
    status?: number;
  }>;
}

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
  "failed to fetch",
  "network",
  "cors",
  "enotfound",
  "econn",
  "certificate",
  "tls",
  "ssl",
];

const AUTH_ERROR_CODES = new Set([
  "auth-required",
  "auth-expired",
  "auth-invalid",
  "permission-denied",
]);
const NETWORK_ERROR_CODES = new Set(["network-error"]);
const HTTP_ERROR_CODES = new Set([
  "http-error",
  "repo-not-found",
  "rate-limited",
  "temporary-failure",
  "grasp-5xx",
]);
const TIMEOUT_ERROR_CODES = new Set(["transient-network-failure", "timeout"]);
const CANCELLATION_ERROR_CODES = new Set([
  "cancellation-unconfirmed",
  "operation-aborted",
  "aborterror",
]);

export function classifyRemoteReadFailure(
  error?: string,
  status?: number,
  errorCode?: string
): RemoteReadFailureClassification {
  const details = String(error || "").trim();
  const lower = details.toLowerCase();
  const code = normalizeErrorCode(errorCode);
  const httpStatus = Number(status || 0);

  if (AUTH_ERROR_CODES.has(code) || httpStatus === 401 || httpStatus === 403) {
    return classification("authentication", true, "recent authenticated read failed");
  }
  if (HTTP_ERROR_CODES.has(code) || httpStatus >= 400) {
    return classification(
      "http-endpoint",
      true,
      httpStatus === 404 ? "recent read returned not found" : "recent HTTP read failed"
    );
  }
  if (NETWORK_ERROR_CODES.has(code)) {
    return classification("connectivity", true, "recent read hiccup");
  }
  if (code === "cors-proxy-failure") {
    return classification("cors-proxy", false, "recent proxied read failed");
  }
  if (TIMEOUT_ERROR_CODES.has(code)) {
    return classification("operation-timeout", false, "recent read timed out");
  }
  if (code === "protocol-error" || code === "corrupt-pack" || code === "corrupt-object") {
    return classification("parser", false, "recent read could not be parsed");
  }
  if (code === "missing-capability" || code === "missing-filter-capability") {
    return classification("capability", false, "recent read was unsupported");
  }
  if (code === "ref-not-found" || code === "object-not-found") {
    return classification("object", false, "recent read could not find an object");
  }
  if (CANCELLATION_ERROR_CODES.has(code)) {
    return classification("cancellation", false, "recent read was cancelled");
  }

  if (AUTH_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return classification("authentication", true, "recent authenticated read failed");
  }
  if (NOT_FOUND_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return classification("http-endpoint", true, "recent read returned not found");
  }
  if (/http\s*\d{3}|rate limit|service unavailable|temporarily unavailable/i.test(details)) {
    return classification("http-endpoint", true, "recent HTTP read failed");
  }
  if (NETWORK_PATTERNS.some((pattern) => lower.includes(pattern))) {
    return classification("connectivity", true, "recent read hiccup");
  }
  if (/timeout|timed out/i.test(details)) {
    return classification("operation-timeout", false, "recent read timed out");
  }
  if (/abort|cancel/i.test(details)) {
    return classification("cancellation", false, "recent read was cancelled");
  }
  if (/pack|parse|zlib|inflate|checksum/i.test(details)) {
    return classification("parser", false, "recent read could not be parsed");
  }

  return classification("unknown", false, "recent read issue");
}

export function getReadFallbackMessage(input: ReadFallbackMessageInput): string {
  const failure = input.failures[0];
  if (!failure) {
    return input.activeFallbackUrl
      ? `Reading from fallback ${getUrlHost(input.activeFallbackUrl)}.`
      : "A repository read used a fallback remote.";
  }

  const failedHost = getUrlHost(failure.url);
  const fallbackHost = input.activeFallbackUrl ? getUrlHost(input.activeFallbackUrl) : "";
  if (!fallbackHost) {
    return `The ${readOperationLabel(input.operation)} read could not be completed by the configured remotes.`;
  }

  if (failure.kind === "connectivity") {
    return `${failedHost} was unreachable; reading from fallback ${fallbackHost}.`;
  }
  if (failure.kind === "cors-proxy") {
    return `${failedHost} could not be reached through the CORS proxy; reading from fallback ${fallbackHost}.`;
  }
  if (failure.kind === "authentication") {
    return `${failedHost} requires authentication; reading from fallback ${fallbackHost}.`;
  }
  if (failure.kind === "http-endpoint") {
    const status = failure.status ? ` HTTP ${failure.status}` : " an HTTP error";
    return `Read from ${failedHost} failed with${status}; reading from fallback ${fallbackHost}.`;
  }
  return `${failedHost} could not complete the ${readOperationLabel(
    input.operation
  )} read; reading from fallback ${fallbackHost}.`;
}

export function classifyCloneUrlIssue(
  error?: string,
  status?: number,
  errorCode?: string
): { kind: CloneUrlIssueKind; summary: string } {
  const classified = classifyRemoteReadFailure(error, status, errorCode);
  if (classified.kind === "authentication") {
    return { kind: "auth", summary: classified.summary };
  }
  if (classified.kind === "http-endpoint" && Number(status || 0) === 404) {
    return { kind: "not-found", summary: classified.summary };
  }
  if (
    classified.kind === "connectivity" ||
    classified.kind === "cors-proxy" ||
    classified.kind === "http-endpoint"
  ) {
    return { kind: "network", summary: classified.summary };
  }
  return { kind: "unknown", summary: classified.summary };
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

function classification(
  kind: RemoteReadFailureKind,
  endpointIssue: boolean,
  summary: string
): RemoteReadFailureClassification {
  return { kind, endpointIssue, summary };
}

function normalizeErrorCode(errorCode?: string): string {
  return String(errorCode || "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");
}

function getUrlHost(value: string): string {
  try {
    return new URL(value).hostname;
  } catch {
    return value;
  }
}

function readOperationLabel(operation?: string): string {
  switch (operation) {
    case "listDirectory":
      return "directory";
    case "getFileContent":
      return "file";
    case "listRefs":
      return "refs";
    case "listCommits":
    case "getCommit":
      return "commit";
    case "diff":
      return "diff";
    default:
      return "repository";
  }
}
