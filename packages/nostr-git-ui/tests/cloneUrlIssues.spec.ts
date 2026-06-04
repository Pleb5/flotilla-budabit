import { describe, expect, it } from "vitest";

import { classifyCloneUrlIssue, getCloneUrlBannerTitle } from "../src/lib/utils/cloneUrlIssues";

describe("cloneUrlIssues", () => {
  it("classifies token fetch failures as soft network hiccups", () => {
    expect(
      classifyCloneUrlIssue(
        "All tokens failed for host github.com. Errors: Token 1: Failed to fetch"
      )
    ).toEqual({
      kind: "network",
      summary: "recent read hiccup",
    });
  });

  it("classifies auth failures without overstating severity", () => {
    expect(classifyCloneUrlIssue("Vendor authentication required (HTTP 403).", 403)).toEqual({
      kind: "auth",
      summary: "recent authenticated read failed",
    });
  });

  it("classifies not found responses as a soft read issue", () => {
    expect(classifyCloneUrlIssue("Not found (HTTP 404).", 404)).toEqual({
      kind: "not-found",
      summary: "recent read returned not found",
    });
  });

  it("builds softer banner copy for primary issues", () => {
    expect(getCloneUrlBannerTitle({ hasPrimaryIssue: true, issueCount: 1 })).toBe(
      "Recent primary remote read issue"
    );
    expect(getCloneUrlBannerTitle({ hasPrimaryIssue: true, issueCount: 2 })).toBe(
      "Recent primary remote read issues"
    );
  });

  it("builds softer banner copy for non-primary issues", () => {
    expect(getCloneUrlBannerTitle({ hasPrimaryIssue: false, issueCount: 1 })).toBe(
      "Recent remote read issue"
    );
    expect(getCloneUrlBannerTitle({ hasPrimaryIssue: false, issueCount: 3 })).toBe(
      "Recent remote read issues"
    );
  });
});
