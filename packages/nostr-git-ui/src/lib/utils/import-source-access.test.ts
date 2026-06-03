import { describe, expect, it } from "vitest";

import {
  getEffectiveImportConfig,
  hasValidatedSourceAccess,
  shouldFetchBranchActivity,
  sortImportBranches,
} from "./import-source-access";

describe("import source access helpers", () => {
  it("accepts validated anonymous source access without a token", () => {
    expect(
      hasValidatedSourceAccess({
        tokenValidated: true,
        validatedForUrl: "https://github.com/nostr/repo",
        currentUrl: " https://github.com/nostr/repo ",
        validatedSourceAccess: { mode: "anonymous" },
      })
    ).toBe(true);
  });

  it("disables mirror reads for anonymous imports", () => {
    const config = getEffectiveImportConfig(
      {
        maxRetries: 3,
        enableProgressTracking: true,
        forkRepo: false,
        mirrorIssues: true,
        mirrorPullRequests: true,
        mirrorComments: true,
        destinationRepoName: "demo",
      },
      "anonymous"
    );

    expect(config.mirrorIssues).toBe(false);
    expect(config.mirrorPullRequests).toBe(false);
    expect(config.mirrorComments).toBe(false);
    expect(config.destinationRepoName).toBe("demo");
  });

  it("keeps token imports and branch activity enrichment enabled", () => {
    const config = getEffectiveImportConfig(
      {
        maxRetries: 3,
        enableProgressTracking: true,
        forkRepo: false,
        mirrorIssues: false,
        mirrorPullRequests: true,
        mirrorComments: false,
      },
      "token"
    );

    expect(config.mirrorIssues).toBe(false);
    expect(config.mirrorPullRequests).toBe(true);
    expect(config.mirrorComments).toBe(false);
    expect(shouldFetchBranchActivity("token")).toBe(true);
    expect(shouldFetchBranchActivity("anonymous")).toBe(false);
  });

  it("sorts default branch first, then by recency, then by name", () => {
    const sorted = sortImportBranches([
      { name: "release", timestampMs: 10, isDefault: false },
      { name: "main", timestampMs: 0, isDefault: true },
      { name: "alpha", timestampMs: 10, isDefault: false },
      { name: "legacy", timestampMs: 2, isDefault: false },
    ]);

    expect(sorted.map((branch) => branch.name)).toEqual(["main", "alpha", "release", "legacy"]);
  });
});
