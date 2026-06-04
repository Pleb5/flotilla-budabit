import type { ImportConfig } from "@nostr-git/core";

export type SourceAccessMode = "token" | "anonymous";

export function hasValidatedSourceAccess(params: {
  tokenValidated: boolean;
  validatedForUrl: string | null;
  currentUrl: string;
  validatedSourceAccess: unknown;
}): boolean {
  const normalizedCurrentUrl = params.currentUrl.trim();

  return (
    normalizedCurrentUrl.length > 0 &&
    params.tokenValidated &&
    params.validatedForUrl === normalizedCurrentUrl &&
    params.validatedSourceAccess !== null &&
    params.validatedSourceAccess !== undefined
  );
}

export function getEffectiveImportConfig(
  config: ImportConfig,
  sourceAccessMode: SourceAccessMode
): ImportConfig {
  if (sourceAccessMode !== "anonymous") {
    return config;
  }

  return {
    ...config,
    mirrorIssues: false,
    mirrorPullRequests: false,
    mirrorComments: false,
  };
}

export function shouldFetchBranchActivity(sourceAccessMode: SourceAccessMode): boolean {
  return sourceAccessMode === "token";
}

export function sortImportBranches<
  Branch extends {
    name: string;
    timestampMs?: number;
    isDefault?: boolean;
  },
>(branches: Branch[]): Branch[] {
  return [...branches].sort((a, b) => {
    if (Boolean(a.isDefault) !== Boolean(b.isDefault)) {
      return a.isDefault ? -1 : 1;
    }

    const aTimestamp = Number.isFinite(a.timestampMs) ? Number(a.timestampMs) : 0;
    const bTimestamp = Number.isFinite(b.timestampMs) ? Number(b.timestampMs) : 0;

    if (bTimestamp !== aTimestamp) {
      return bTimestamp - aTimestamp;
    }

    return a.name.localeCompare(b.name);
  });
}
