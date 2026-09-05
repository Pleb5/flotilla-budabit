import { describe, expect, it } from "vitest";

import {
  classifyCloneUrlIssue,
  classifyRemoteReadFailure,
  getCloneUrlBannerTitle,
  getReadFallbackMessage,
} from "./cloneUrlIssues";

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

  it.each([
    ["network-error", undefined, "connectivity", true],
    ["cors-proxy-failure", undefined, "cors-proxy", false],
    ["auth-required", undefined, "authentication", true],
    ["http-error", 404, "http-endpoint", true],
    ["protocol-error", undefined, "parser", false],
    ["missing-filter-capability", undefined, "capability", false],
    ["object-not-found", undefined, "object", false],
    ["cancellation-unconfirmed", undefined, "cancellation", false],
    ["transient-network-failure", undefined, "operation-timeout", false],
  ])("classifies structured %s failures", (errorCode, status, kind, endpointIssue) => {
    expect(classifyRemoteReadFailure("read failed", status, errorCode)).toMatchObject({
      kind,
      endpointIssue,
    });
  });

  it("prioritizes structured parser codes over misleading message text", () => {
    expect(
      classifyRemoteReadFailure("network stream failed", undefined, "protocol-error")
    ).toMatchObject({kind: "parser", endpointIssue: false});
  });

  it("describes operational fallback without claiming endpoint unavailability", () => {
    expect(
      getReadFallbackMessage({
        operation: "listDirectory",
        activeFallbackUrl: "https://github.com/example/repo.git",
        failures: [
          {
            url: "https://relay.example/repo.git",
            kind: "parser",
          },
        ],
      })
    ).toBe(
      "relay.example could not complete the directory read; reading from fallback github.com."
    );
  });

  it("describes reuse of an already-active fallback without inventing a failure", () => {
    expect(
      getReadFallbackMessage({
        operation: "getFileContent",
        activeFallbackUrl: "https://github.com/example/repo.git",
        failures: [],
      })
    ).toBe("Reading from fallback github.com.");
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
