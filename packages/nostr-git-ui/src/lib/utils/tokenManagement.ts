export const ACCESS_TOKEN_SETTINGS_PATH = "/settings/profile";

export interface AccessTokenSettingsLink {
  provider: "github" | "gitlab";
  label: string;
  url: string;
}

export const ACCESS_TOKEN_SETTINGS_LINKS: ReadonlyArray<AccessTokenSettingsLink> = [
  {
    provider: "github",
    label: "GitHub token settings",
    url: "https://github.com/settings/tokens",
  },
  {
    provider: "gitlab",
    label: "GitLab access token settings",
    url: "https://gitlab.com/-/user_settings/personal_access_tokens",
  },
];

export function getAccessTokenSettingsLink(
  providerOrHost?: string | null
): AccessTokenSettingsLink | null {
  const normalized = String(providerOrHost || "")
    .trim()
    .toLowerCase();

  if (!normalized) return null;

  return ACCESS_TOKEN_SETTINGS_LINKS.find((entry) => normalized.includes(entry.provider)) || null;
}

function getErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;

  try {
    return JSON.stringify(error);
  } catch {
    return String(error || "");
  }
}

export function isWorkflowScopeIssue(error: unknown): boolean {
  const message = getErrorText(error).toLowerCase();

  return /workflow_scope_missing|workflow token scope|workflow permission|refusing to allow.*workflow|without.*workflow.*scope|lacks.*workflow.*scope|missing.*workflow.*scope/.test(
    message
  );
}

export function isAccessTokenManagementIssue(error: unknown): boolean {
  const message = getErrorText(error).toLowerCase();

  if (!message) return false;
  if (isWorkflowScopeIssue(message)) return true;

  return /missing token|no matching access token|no .*authentication token found|no .*token found|token validation failed|token does not have|token lacks|authentication required|auth required|unauthorized|forbidden|permission denied|access denied|insufficient permissions|personal access token|401|403/.test(
    message
  );
}

export function getAccessTokenManagementMessage(error: unknown): string {
  if (isWorkflowScopeIssue(error)) {
    return "GitHub rejected this push because the token is missing Workflow permission for .github/workflows files.";
  }

  return "Review your Git access tokens in Settings and retry.";
}
