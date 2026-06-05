import { describe, expect, it } from "vitest";

import {
  ACCESS_TOKEN_SETTINGS_PATH,
  getAccessTokenManagementMessage,
  getAccessTokenSettingsLink,
  isAccessTokenManagementIssue,
  isWorkflowScopeIssue,
} from "./tokenManagement";

describe("token management helpers", () => {
  it("resolves provider settings links", () => {
    expect(ACCESS_TOKEN_SETTINGS_PATH).toBe("/settings/git");
    expect(getAccessTokenSettingsLink("github.com")?.url).toBe(
      "https://github.com/settings/tokens"
    );
    expect(getAccessTokenSettingsLink("gitlab")?.url).toBe(
      "https://gitlab.com/-/user_settings/personal_access_tokens"
    );
  });

  it("detects workflow scope failures as token issues", () => {
    const error =
      "GitHub rejected this push because the token is missing Workflow permission for .github/workflows files.";

    expect(isWorkflowScopeIssue(error)).toBe(true);
    expect(isAccessTokenManagementIssue(error)).toBe(true);
    expect(getAccessTokenManagementMessage(error)).toContain("Workflow permission");
  });

  it("detects GitHub workflow push rejection wording", () => {
    expect(
      isWorkflowScopeIssue(
        "refusing to allow a Personal Access Token to create or update workflow .github/workflows/build.yml"
      )
    ).toBe(true);
  });

  it("does not treat generic GitHub repository rules as workflow scope failures", () => {
    const error = "GH013: Repository rule violations found for refs/heads/master. push declined due to repository rule violations";

    expect(isWorkflowScopeIssue(error)).toBe(false);
    expect(isAccessTokenManagementIssue(error)).toBe(false);
  });

  it("detects missing or invalid token failures", () => {
    expect(isAccessTokenManagementIssue("Missing token for target host")).toBe(true);
    expect(
      isAccessTokenManagementIssue("No github authentication token found for push operation")
    ).toBe(true);
    expect(isAccessTokenManagementIssue("Token validation failed: Invalid token")).toBe(true);
    expect(isAccessTokenManagementIssue("Remote appears to have new commits")).toBe(false);
  });
});
