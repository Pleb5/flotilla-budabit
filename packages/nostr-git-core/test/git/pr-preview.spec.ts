import "fake-indexeddb/auto"
import {describe, expect, it} from "vitest"

import {getPRPreviewData} from "../../src/git/merge-analysis.js"

describe("git/merge-analysis: PR preview branch resolution", () => {
  it("requires source branch to exist on fork remote when sourceRemote is provided", async () => {
    const gitMock: any = {
      async resolveRef({ref}: {ref: string}) {
        if (ref === "refs/remotes/fork/feature") {
          throw new Error("not found")
        }
        if (ref === "fork/feature") {
          throw new Error("not found")
        }
        if (ref === "refs/heads/feature") {
          return "1111111111111111111111111111111111111111"
        }
        if (ref === "refs/remotes/origin/main") {
          return "2222222222222222222222222222222222222222"
        }
        throw new Error(`unexpected ref: ${ref}`)
      },
    }

    const result = await getPRPreviewData(gitMock, "/repo", "feature", "main", {
      sourceRemote: "fork",
      preferRemoteRefs: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("not found on fork remote")
  })

  it("still resolves source from local refs when sourceRemote is not set", async () => {
    const gitMock: any = {
      async resolveRef({ref}: {ref: string}) {
        if (ref === "refs/heads/feature") {
          return "3333333333333333333333333333333333333333"
        }
        if (ref === "refs/remotes/origin/main") {
          return "3333333333333333333333333333333333333333"
        }
        throw new Error(`unexpected ref: ${ref}`)
      },
    }

    const result = await getPRPreviewData(gitMock, "/repo", "feature", "main", {
      preferRemoteRefs: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain("No commits to merge")
  })
})
