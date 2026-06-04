import { getGitServiceApi } from "@nostr-git/core";

import type { Token } from "../stores/tokens.js";
import { checkGraspRepoExists } from "./grasp-availability.js";
import { findExistingTargetRepoConflict } from "./import-targets.js";
import { matchesHost } from "./tokenMatcher.js";
import { AllTokensFailedError, TokenNotFoundError } from "./tokenErrors.js";
import { tryTokensForHost } from "./tokenHelpers.js";

export type RemoteTargetProvider = "github" | "gitlab" | "gitea" | "bitbucket" | "grasp";
export type RemoteTargetStatus = "checking" | "ready" | "failed" | "unsupported" | "no-token";

export interface RemoteTargetOption {
  id: string;
  label: string;
  provider: RemoteTargetProvider;
  host?: string;
  relayUrl?: string;
  status: RemoteTargetStatus;
  detail?: string;
  validatedToken?: string;
  candidateTokens?: string[];
  existsAlready?: boolean;
  existingRemoteUrl?: string;
  existingWebUrl?: string;
}

export interface RemoteTargetSelection {
  id: string;
  label: string;
  provider: RemoteTargetProvider;
  host?: string;
  token?: string;
  tokens?: string[];
  relayUrl?: string;
  existsAlready?: boolean;
  existingRemoteUrl?: string;
  existingWebUrl?: string;
}

export interface PreflightRemoteTargetsOptions {
  allowExistingRepoReuse?: boolean;
  existingRepoMessage?: string;
}

export function normalizeRelayUrl(value: string): string {
  return (value || "").trim().replace(/\/+$/, "");
}

export function normalizeTokenHostForTarget(host: string): string {
  const normalized = (host || "").trim().toLowerCase();
  if (normalized === "api.github.com") return "github.com";
  return normalized;
}

export function inferRemoteTargetProvider(
  host: string,
  token: string
): RemoteTargetProvider | null {
  const normalizedHost = String(host || "")
    .trim()
    .toLowerCase();
  const normalizedToken = String(token || "")
    .trim()
    .toLowerCase();

  if (normalizedHost.includes("github")) return "github";
  if (normalizedHost.includes("gitlab")) return "gitlab";
  if (normalizedHost.includes("gitea") || normalizedHost === "codeberg.org") return "gitea";
  if (normalizedHost.includes("bitbucket")) return "bitbucket";

  if (normalizedToken.startsWith("github_pat_") || normalizedToken.startsWith("ghp_")) {
    return "github";
  }
  if (normalizedToken.startsWith("glpat-")) return "gitlab";

  return null;
}

export function getRemoteTargetProviderLabel(provider: RemoteTargetProvider): string {
  if (provider === "github") return "GitHub";
  if (provider === "gitlab") return "GitLab";
  if (provider === "gitea") return "Gitea";
  if (provider === "bitbucket") return "Bitbucket";
  return "GRASP";
}

export function getProviderBaseUrl(
  provider: RemoteTargetProvider,
  host?: string
): string | undefined {
  if (!host || provider === "grasp") return undefined;

  const normalizedHost = host.toLowerCase();

  if (provider === "github") {
    if (normalizedHost === "github.com") return undefined;
    return `https://${host}/api/v3`;
  }
  if (provider === "gitlab") {
    if (normalizedHost === "gitlab.com") return undefined;
    return `https://${host}/api/v4`;
  }
  if (provider === "gitea") {
    return `https://${host}/api/v1`;
  }
  if (provider === "bitbucket") {
    if (normalizedHost === "bitbucket.org") return undefined;
    return `https://${host}/api/2.0`;
  }

  return undefined;
}

export function validateRemoteTargetRepoName(name: string): string | undefined {
  const trimmed = String(name || "").trim();
  if (!trimmed) {
    return "Destination repository name is required";
  }

  if (/[\\/]/.test(trimmed)) {
    return "Destination repository name cannot contain / or \\\\";
  }

  return undefined;
}

export function buildRemoteTargetOptions(params: {
  tokenList: Token[];
  graspRelayUrls: string[];
}): RemoteTargetOption[] {
  const { tokenList, graspRelayUrls } = params;
  const targetMap = new Map<string, RemoteTargetOption>();

  const tokenByHost = new Map<string, string>();
  for (const entry of tokenList) {
    const normalizedHost = normalizeTokenHostForTarget(entry.host);
    if (!normalizedHost) continue;
    if (!tokenByHost.has(normalizedHost)) tokenByHost.set(normalizedHost, entry.token);
  }

  for (const [host, sampleToken] of tokenByHost.entries()) {
    const provider = inferRemoteTargetProvider(host, sampleToken);
    if (!provider) {
      targetMap.set(`unsupported:${host}`, {
        id: `unsupported:${host}`,
        label: host,
        provider: "github",
        host,
        status: "unsupported",
        detail: "Could not infer provider from token host",
      });
      continue;
    }

    targetMap.set(`git:${host}`, {
      id: `git:${host}`,
      label: `${getRemoteTargetProviderLabel(provider)} (${host})`,
      provider,
      host,
      status: "checking",
    });
  }

  graspRelayUrls.forEach((relayUrl, index) => {
    const normalized = normalizeRelayUrl(relayUrl);
    if (!normalized) return;

    targetMap.set(`grasp:${normalized}`, {
      id: `grasp:${normalized}`,
      label: `GRASP (${normalized.replace(/^wss?:\/\//, "")})`,
      provider: "grasp",
      relayUrl: normalized,
      status: "checking",
      detail: index === 0 ? "Primary relay" : undefined,
    });
  });

  return Array.from(targetMap.values());
}

function isNotFoundError(error: unknown): boolean {
  const anyError = error as any;
  const message = error instanceof Error ? error.message : String(error || "");
  const lowered = message.toLowerCase();
  const statusCode = anyError?.statusCode ?? anyError?.status ?? anyError?.context?.statusCode;
  return statusCode === 404 || lowered.includes("404") || lowered.includes("not found");
}

function toFriendlyTargetPreflightError(error: unknown, host: string): string {
  const classify = (message: string): string => {
    const normalized = message.toLowerCase();
    if (normalized.includes("404") || normalized.includes("not found")) {
      return "Repository not found or token has no access";
    }
    if (
      normalized.includes("401") ||
      normalized.includes("unauthorized") ||
      normalized.includes("bad credentials")
    ) {
      return "Invalid token credentials";
    }
    if (normalized.includes("403") || normalized.includes("forbidden")) {
      return "Token lacks required repository permissions";
    }
    return "Token could not access this host";
  };

  if (error instanceof TokenNotFoundError) {
    return `No token found for ${host}`;
  }

  if (error instanceof AllTokensFailedError) {
    const reasons = Array.from(new Set(error.errors.map((entry) => classify(entry.message))));
    return `No usable token for ${host} (${reasons.join(", ")})`;
  }

  if (error instanceof Error) {
    return classify(error.message);
  }

  return `No usable token for ${host}`;
}

export async function preflightRemoteTargets(params: {
  targets: RemoteTargetOption[];
  tokenList: Token[];
  userPubkey: string;
  repoName: string;
  options?: PreflightRemoteTargetsOptions;
}): Promise<RemoteTargetOption[]> {
  const { targets, tokenList, userPubkey, repoName, options } = params;
  const allowExistingRepoReuse = options?.allowExistingRepoReuse ?? true;
  const existingRepoMessage =
    options?.existingRepoMessage ||
    "Destination already exists. Fork only creates new destinations; use import or manually attach an existing remote instead.";

  return await Promise.all(
    targets.map(async (target) => {
      if (target.status === "unsupported") return target;

      if (target.provider === "grasp") {
        if (!target.relayUrl) {
          return { ...target, status: "failed" as const, detail: "Missing relay URL" };
        }

        try {
          const probe = await checkGraspRepoExists({
            relayUrl: target.relayUrl,
            userPubkey,
            owner: userPubkey,
            repoName,
          });

          if (probe.exists) {
            const existingWebUrl = probe.htmlUrl;
            const existingRemoteUrl = existingWebUrl
              ? existingWebUrl.endsWith(".git")
                ? existingWebUrl
                : `${existingWebUrl.replace(/\/+$/, "")}.git`
              : undefined;

            if (!allowExistingRepoReuse) {
              return {
                ...target,
                status: "failed" as const,
                detail: existingRepoMessage,
                existsAlready: true,
                existingWebUrl,
                existingRemoteUrl,
              };
            }

            return {
              ...target,
              status: "ready" as const,
              detail: "Repository exists, will push to existing destination",
              existsAlready: true,
              existingWebUrl,
              existingRemoteUrl,
            };
          }

          return {
            ...target,
            status: "ready" as const,
            detail: target.detail || "Relay available",
          };
        } catch (error) {
          return {
            ...target,
            status: "failed" as const,
            detail: error instanceof Error ? error.message : String(error),
          };
        }
      }

      if (!target.host) {
        return { ...target, status: "failed" as const, detail: "Missing host" };
      }

      const normalizedTargetHost = normalizeTokenHostForTarget(target.host);
      const matchingTargetTokens = tokenList
        .filter((tokenEntry) => {
          const normalizedTokenHost = normalizeTokenHostForTarget(tokenEntry.host);
          return (
            matchesHost(normalizedTokenHost, normalizedTargetHost) ||
            matchesHost(normalizedTargetHost, normalizedTokenHost)
          );
        })
        .map((tokenEntry) => tokenEntry.token);

      try {
        const result = await tryTokensForHost(
          tokenList,
          (tokenHost: string) => {
            const normalizedTokenHost = normalizeTokenHostForTarget(tokenHost);
            return (
              matchesHost(normalizedTokenHost, normalizedTargetHost) ||
              matchesHost(normalizedTargetHost, normalizedTokenHost)
            );
          },
          async (candidateToken: string) => {
            const api = getGitServiceApi(
              target.provider,
              candidateToken,
              getProviderBaseUrl(target.provider, target.host)
            );

            const user = await api.getCurrentUser();
            const username = user.login || (user as any).username;
            if (!username) {
              throw new Error("Unable to determine token user");
            }

            try {
              const existingRepo = await api.getRepo(username, repoName);
              const repoConflict = findExistingTargetRepoConflict({
                provider: target.provider,
                requestedOwner: username,
                requestedRepo: repoName,
                existingRepo,
              });

              if (repoConflict) {
                return {
                  token: candidateToken,
                  detail: repoConflict.message,
                  blocked: true,
                };
              }

              if (!allowExistingRepoReuse) {
                return {
                  token: candidateToken,
                  detail: existingRepoMessage,
                  blocked: true,
                  existsAlready: true,
                  existingRemoteUrl: existingRepo.cloneUrl,
                  existingWebUrl: existingRepo.htmlUrl,
                };
              }

              return {
                token: candidateToken,
                detail: "Repository exists, will push to existing destination",
                existsAlready: true,
                existingRemoteUrl: existingRepo.cloneUrl,
                existingWebUrl: existingRepo.htmlUrl,
              };
            } catch (error) {
              if (isNotFoundError(error)) {
                return {
                  token: candidateToken,
                  detail: `Will create ${getRemoteTargetProviderLabel(target.provider)} repository as ${username}/${repoName}`,
                  existsAlready: false,
                };
              }

              throw error;
            }
          }
        );

        if (result?.blocked) {
          return {
            ...target,
            status: "failed" as const,
            detail: result.detail,
            validatedToken: result.token,
            candidateTokens: matchingTargetTokens,
            existsAlready: Boolean(result?.existsAlready),
            existingRemoteUrl: result?.existingRemoteUrl,
            existingWebUrl: result?.existingWebUrl,
          };
        }

        return {
          ...target,
          status: "ready" as const,
          detail: result?.detail || target.detail,
          validatedToken: result?.token,
          candidateTokens: matchingTargetTokens,
          existsAlready: Boolean(result?.existsAlready),
          existingRemoteUrl: result?.existingRemoteUrl,
          existingWebUrl: result?.existingWebUrl,
        };
      } catch (error) {
        return {
          ...target,
          status: "failed" as const,
          detail: toFriendlyTargetPreflightError(error, normalizedTargetHost),
          candidateTokens: matchingTargetTokens,
        };
      }
    })
  );
}

export function getDefaultSelectedRemoteTargetIds(targets: RemoteTargetOption[]): string[] {
  const readyTargets = targets.filter((target) => target.status === "ready");
  const readyGitTargets = readyTargets
    .filter((target) => target.provider !== "grasp")
    .map((target) => target.id);
  const readyGraspTargets = readyTargets
    .filter((target) => target.provider === "grasp")
    .map((target) => target.id);

  return readyGraspTargets.length > 0 ? readyGraspTargets : readyGitTargets;
}

export function toRemoteTargetSelection(target: RemoteTargetOption): RemoteTargetSelection {
  return {
    id: target.id,
    label: target.label,
    provider: target.provider,
    host: target.host,
    relayUrl: target.relayUrl,
    token: target.validatedToken,
    tokens: target.candidateTokens,
    existsAlready: target.existsAlready,
    existingRemoteUrl: target.existingRemoteUrl,
    existingWebUrl: target.existingWebUrl,
  };
}
