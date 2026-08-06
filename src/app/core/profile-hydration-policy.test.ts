import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const dense = (source: string) => source.replace(/\s+/g, "")

describe("signed-in profile hydration policy", () => {
  it("runs one bounded community-only attempt per identity", () => {
    const layout = dense(readProjectFile("../../routes/+layout.svelte"))

    expect(layout).toContain("constcommunityRefs=$activeUserCommunityRefs")
    expect(layout).toContain("getProfileCommunityRelaysFromRefs(communityRefs)")
    expect(layout).toContain("userProfileHydrationAttempted=true")
    expect(layout).toContain(
      "hydratePubkeyProfiles({pubkeys:[user],relayHints,signal:controller.signal,timeout:3000,})",
    )
    expect(layout).toContain("userProfileHydrationController?.abort()")
    expect(layout).not.toContain("loadedUserProfileKey")
    expect(layout).not.toContain("loadingUserProfileKey")
  })

  it("does not broaden direct profile batches to outbox or indexer relays", () => {
    const state = readProjectFile("./community-state.ts")
    const start = state.indexOf("export const hydratePubkeyProfiles")
    const end = state.indexOf("export const getCommunityStarRelays", start)
    const hydration = dense(state.slice(start, end))

    expect(hydration).toContain("constrelays=normalizeRelays(relayHints)")
    expect(hydration).toContain("[{kinds:[PROFILE],authors,limit:authors.length}]")
    expect(hydration).toContain("{timeout,authenticate:true,signal}")
    expect(hydration).not.toContain("getCommunityBootstrapRelays")
    expect(hydration).not.toContain("setTimeout")
  })
})
