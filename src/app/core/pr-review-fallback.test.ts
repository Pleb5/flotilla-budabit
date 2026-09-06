import {describe, expect, it} from "vitest"

import {buildPRReviewFallbackEvidence} from "./pr-review-fallback"

const classify = (_error: string, _status?: number, errorCode?: string) => ({
  kind: errorCode === "network-error" ? "connectivity" : "operation",
  endpointIssue: errorCode === "network-error",
})

describe("PR review fallback evidence", () => {
  it("keeps fork-source fallback out of target repository observations", () => {
    const evidence = buildPRReviewFallbackEvidence({
      result: {
        sourceAttempts: [
          {
            url: "https://source-primary.example/repo.git",
            success: false,
            error: "source unavailable",
            errorCode: "network-error",
          },
          {url: "https://source-secondary.example/repo.git", success: true},
        ],
        usedCloneUrl: "https://source-secondary.example/repo.git",
      },
      targetPrimaryUrl: "https://target-primary.example/repo.git",
      sourcePrimaryUrl: "https://source-primary.example/repo.git",
      classify,
    })

    expect(evidence.targetObservation).toBeUndefined()
    expect(evidence.targetEndpointFailures).toEqual([])
    expect(evidence.sourceMessage).toContain("source-primary.example")
    expect(evidence.sourceMessage).toContain("source-secondary.example")
  })

  it("reports target fallback while limiting endpoint health to connectivity evidence", () => {
    const evidence = buildPRReviewFallbackEvidence({
      result: {
        targetAttempts: [
          {
            url: "https://target-primary.example/repo.git",
            success: false,
            error: "pack parser failed",
            errorCode: "protocol-error",
          },
          {
            url: "https://target-secondary.example/repo.git",
            success: false,
            error: "failed to fetch",
            errorCode: "network-error",
          },
          {url: "https://target-tertiary.example/repo.git", success: true},
        ],
        usedTargetCloneUrl: "https://target-tertiary.example/repo.git",
      },
      targetPrimaryUrl: "https://target-primary.example/repo.git",
      sourcePrimaryUrl: "https://source.example/repo.git",
      classify,
    })

    expect(evidence.targetObservation).toMatchObject({
      activeFallbackUrl: "https://target-tertiary.example/repo.git",
      failures: [
        expect.objectContaining({errorCode: "protocol-error"}),
        expect.objectContaining({errorCode: "network-error"}),
      ],
    })
    expect(evidence.targetEndpointFailures).toEqual([
      expect.objectContaining({url: "https://target-secondary.example/repo.git"}),
    ])
    expect(evidence.sourceMessage).toBeUndefined()
  })
})
