import type { Token } from "../stores/tokens.js";
import {
  getProviderBaseUrl,
  getRemoteTargetProviderLabel,
  inferRemoteTargetProvider,
  normalizeTokenHostForTarget,
  type RemoteTargetProvider,
} from "./remote-targets.js";

export type TokenCapabilityId =
  | "identity"
  | "repoRead"
  | "repoWrite"
  | "repoCreate"
  | "workflow"
  | "issuesPr";

export type TokenCapabilityStatus = "present" | "missing" | "unknown";

export interface TokenCapability {
  id: TokenCapabilityId;
  label: string;
  status: TokenCapabilityStatus;
  detail?: string;
  recommended?: boolean;
}

export interface TokenCapabilityCheck {
  host: string;
  normalizedHost: string;
  provider: RemoteTargetProvider | "unknown";
  providerLabel: string;
  valid: boolean;
  unsupported?: boolean;
  userLogin?: string;
  checkedAt: number;
  capabilities: TokenCapability[];
  error?: string;
}

export interface CheckTokenCapabilitiesOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface JsonResponse {
  ok: boolean;
  status: number;
  headers: Headers;
  data: any;
  text: string;
}

const CAPABILITY_LABELS: Record<TokenCapabilityId, string> = {
  identity: "Valid token",
  repoRead: "Read repo",
  repoWrite: "Write repo",
  repoCreate: "Create repo",
  workflow: "Workflow files",
  issuesPr: "Issues/PRs",
};

const MISSING_LABELS: Partial<Record<TokenCapabilityId, string>> = {
  identity: "Invalid token",
  repoRead: "Read missing",
  repoWrite: "Write missing",
  repoCreate: "Create missing",
  workflow: "Workflow missing",
  issuesPr: "Issues/PRs missing",
};

function normalizeScopes(value: string | null | undefined): string[] {
  return Array.from(
    new Set(
      String(value || "")
        .split(",")
        .map((scope) => scope.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function scopeSet(scopes: string[]): Set<string> {
  return new Set(scopes.map((scope) => scope.toLowerCase()));
}

function hasAny(scopes: Set<string>, values: string[]): boolean {
  return values.some((value) => scopes.has(value));
}

function cap(
  id: TokenCapabilityId,
  status: TokenCapabilityStatus,
  detail?: string,
  recommended = true
): TokenCapability {
  return {
    id,
    label: CAPABILITY_LABELS[id],
    status,
    detail,
    recommended,
  };
}

function invalidResult(params: {
  host: string;
  normalizedHost: string;
  provider: RemoteTargetProvider | "unknown";
  error: string;
  unsupported?: boolean;
}): TokenCapabilityCheck {
  const providerLabel =
    params.provider === "unknown" ? "Unknown" : getRemoteTargetProviderLabel(params.provider);
  return {
    host: params.host,
    normalizedHost: params.normalizedHost,
    provider: params.provider,
    providerLabel,
    valid: false,
    unsupported: params.unsupported,
    checkedAt: Date.now(),
    error: params.error,
    capabilities: [cap("identity", params.unsupported ? "unknown" : "missing", params.error)],
  };
}

function authHeader(provider: RemoteTargetProvider, token: string): string {
  if (provider === "gitlab" || provider === "bitbucket") return `Bearer ${token}`;
  return `token ${token}`;
}

async function requestJson(
  url: string,
  provider: RemoteTargetProvider,
  token: string,
  options: CheckTokenCapabilitiesOptions
): Promise<JsonResponse> {
  const fetchImpl = options.fetchImpl || fetch;
  const controller = typeof AbortController !== "undefined" ? new AbortController() : undefined;
  const timeoutMs = options.timeoutMs ?? 10000;
  const timeout = controller
    ? setTimeout(() => controller.abort(), Math.max(1, timeoutMs))
    : undefined;

  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/json",
        Authorization: authHeader(provider, token),
      },
      signal: controller?.signal,
    });
    const text = await response.text();
    let data: any = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: response.ok, status: response.status, headers: response.headers, data, text };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function getApiBaseUrl(provider: RemoteTargetProvider, host: string): string | undefined {
  const base = getProviderBaseUrl(provider, host);
  if (base) return base.replace(/\/+$/, "");

  if (provider === "github") return "https://api.github.com";
  if (provider === "gitlab") return "https://gitlab.com/api/v4";
  if (provider === "bitbucket") return "https://api.bitbucket.org/2.0";
  if (provider === "gitea") return `https://${host}/api/v1`;
  return undefined;
}

function getCurrentUserEndpoint(provider: RemoteTargetProvider): string {
  if (provider === "github") return "/user";
  if (provider === "gitlab") return "/user";
  if (provider === "gitea") return "/user";
  if (provider === "bitbucket") return "/user";
  return "/user";
}

function getUserLogin(provider: RemoteTargetProvider, data: any): string | undefined {
  if (provider === "gitlab") return data?.username || data?.login;
  if (provider === "bitbucket") return data?.username || data?.nickname || data?.display_name;
  return data?.login || data?.username;
}

function buildGithubCapabilities(scopes: string[], scopesKnown: boolean): TokenCapability[] {
  const set = scopeSet(scopes);
  const repoRead = hasAny(set, ["repo", "public_repo", "read:repo"]);
  const repoWrite = hasAny(set, ["repo", "public_repo"]);
  const repoCreate = hasAny(set, ["repo", "public_repo"]);
  const workflow = hasAny(set, ["workflow"]);
  const issuesPr = hasAny(set, ["repo", "public_repo", "issues"]);
  const unknownDetail = "GitHub did not expose classic token scopes for this token.";

  return [
    cap("identity", "present", "Token can identify the GitHub user."),
    cap("repoRead", scopesKnown ? (repoRead ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
    cap("repoWrite", scopesKnown ? (repoWrite ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
    cap("repoCreate", scopesKnown ? (repoCreate ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
    cap(
      "workflow",
      scopesKnown ? (workflow ? "present" : "missing") : "unknown",
      scopesKnown
        ? workflow
          ? "Can push files under .github/workflows."
          : "Forking or importing repositories with .github/workflows files may fail."
        : unknownDetail
    ),
    cap("issuesPr", scopesKnown ? (issuesPr ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
  ];
}

function buildGitlabCapabilities(scopes: string[] | null): TokenCapability[] {
  const scopesKnown = Boolean(scopes);
  const set = scopeSet(scopes || []);
  const api = set.has("api");
  const readRepo = api || set.has("read_repository") || set.has("write_repository");
  const writeRepo = api || set.has("write_repository");
  const unknownDetail = "GitLab did not expose token scopes for this token.";

  return [
    cap("identity", "present", "Token can identify the GitLab user."),
    cap("repoRead", scopesKnown ? (readRepo ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
    cap("repoWrite", scopesKnown ? (writeRepo ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
    cap("repoCreate", scopesKnown ? (api ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
    cap("issuesPr", scopesKnown ? (api ? "present" : "missing") : "unknown", scopesKnown ? undefined : unknownDetail),
  ];
}

function buildUnknownScopeCapabilities(provider: RemoteTargetProvider): TokenCapability[] {
  const detail = `${getRemoteTargetProviderLabel(provider)} capability scopes are not exposed by this checker.`;
  return [
    cap("identity", "present", `Token can identify the ${getRemoteTargetProviderLabel(provider)} user.`),
    cap("repoRead", "unknown", detail),
    cap("repoWrite", "unknown", detail),
    cap("repoCreate", "unknown", detail),
    cap("issuesPr", "unknown", detail),
  ];
}

export async function checkTokenCapabilities(
  tokenEntry: Token,
  options: CheckTokenCapabilitiesOptions = {}
): Promise<TokenCapabilityCheck> {
  const host = String(tokenEntry.host || "").trim();
  const token = String(tokenEntry.token || "").trim();
  const normalizedHost = normalizeTokenHostForTarget(host);
  const provider = inferRemoteTargetProvider(normalizedHost, token);

  if (!host || !token) {
    return invalidResult({
      host,
      normalizedHost,
      provider: provider || "unknown",
      error: "Host and token are required.",
    });
  }

  if (!provider || provider === "grasp") {
    return invalidResult({
      host,
      normalizedHost,
      provider: "unknown",
      error: "Capability checks are not available for this token host.",
      unsupported: true,
    });
  }

  const apiBaseUrl = getApiBaseUrl(provider, normalizedHost || host);
  if (!apiBaseUrl) {
    return invalidResult({
      host,
      normalizedHost,
      provider,
      error: "Unable to determine API endpoint for token check.",
      unsupported: true,
    });
  }

  try {
    const userResponse = await requestJson(
      `${apiBaseUrl}${getCurrentUserEndpoint(provider)}`,
      provider,
      token,
      options
    );

    if (!userResponse.ok) {
      return invalidResult({
        host,
        normalizedHost,
        provider,
        error:
          userResponse.status === 401 || userResponse.status === 403
            ? "Token credentials were rejected by the provider."
            : `Token check failed with HTTP ${userResponse.status}.`,
      });
    }

    let capabilities: TokenCapability[];
    if (provider === "github") {
      const scopes = normalizeScopes(userResponse.headers.get("x-oauth-scopes"));
      capabilities = buildGithubCapabilities(scopes, scopes.length > 0);
    } else if (provider === "gitlab") {
      let scopes: string[] | null = null;
      try {
        const scopeResponse = await requestJson(
          `${apiBaseUrl}/personal_access_tokens/self`,
          provider,
          token,
          options
        );
        if (scopeResponse.ok && Array.isArray(scopeResponse.data?.scopes)) {
          scopes = scopeResponse.data.scopes.map((scope: string) => String(scope).toLowerCase());
        }
      } catch {
        scopes = null;
      }
      capabilities = buildGitlabCapabilities(scopes);
    } else {
      capabilities = buildUnknownScopeCapabilities(provider);
    }

    return {
      host,
      normalizedHost,
      provider,
      providerLabel: getRemoteTargetProviderLabel(provider),
      valid: true,
      userLogin: getUserLogin(provider, userResponse.data),
      checkedAt: Date.now(),
      capabilities,
    };
  } catch (error) {
    return invalidResult({
      host,
      normalizedHost,
      provider,
      error: error instanceof Error ? error.message : String(error || "Token check failed."),
    });
  }
}

export function getTokenCapabilityPillLabel(capability: TokenCapability): string {
  if (capability.status === "missing") {
    return MISSING_LABELS[capability.id] || `${capability.label} missing`;
  }
  if (capability.status === "unknown") {
    return `${capability.label} unknown`;
  }
  return capability.label;
}

export function getMissingRecommendedTokenCapabilities(
  check: TokenCapabilityCheck | undefined
): TokenCapability[] {
  if (!check || !check.valid) return [];
  return check.capabilities.filter(
    (capability) => capability.recommended && capability.status === "missing"
  );
}
