import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const prView = readFileSync(new URL("../components/PRView.svelte", import.meta.url), "utf8")

describe("PR delivery contract", () => {
  it("orders the primary first and confirms the exact target ref before applied status", () => {
    expect(prView).toContain("orderPrimaryFirst(prPushRemotes.filter")
    expect(prView).toContain("verifyRequestedRemoteRefs({")
    expect(prView).toContain("ref: `refs/heads/${prTargetBranch}`")
    expect(prView).toContain('if (outcome === "complete")')
    expect(prView).toContain("await publishAppliedStatusAfterDelivery()")
  })

  it("uses ACK-aware status publication and never fire-and-forgets applied status", () => {
    expect(prView).toContain("await handlePrStatusPublish(statusEvent as any)")
    expect(prView).not.toContain("postStatus(statusEvent as any")
    expect(prView).toContain("Retry applied status")
  })

  it("rechecks an unknown primary without automatically pushing it again", () => {
    expect(prView).toContain('remote.status === "confirmed" || remote.status === "unknown"')
    expect(prView).toContain("const previousByUrl = new Map(prPushRemotes.map")
    expect(prView).toContain("status: previous?.status")
    expect(prView).toContain("const recheckPrimaryDelivery = async () =>")
    expect(prView).toContain("Recheck primary")
  })
})
