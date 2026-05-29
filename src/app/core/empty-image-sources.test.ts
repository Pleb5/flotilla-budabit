import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("empty image source guards", () => {
  it("prevents ImageIcon from rendering an img for empty sources", () => {
    const source = readProjectFile("../../lib/components/ImageIcon.svelte")

    expect(source).toContain('const safeSrc = $derived(String(src || "").trim())')
    expect(source).toContain("{#if !safeSrc}")
    expect(source).toContain("{:else if safeSrc.includes")
    expect(source).toContain("src={safeSrc}")
  })

  it("uses profile avatar fallback instead of empty ChannelMessage picture src", () => {
    const source = readProjectFile("../components/ChannelMessage.svelte")

    expect(source).toContain("ProfileCircle")
    expect(source).not.toContain('$profile?.picture || ""')
  })

  it("uses safe AvatarImage for Nostr Git UI avatar fallbacks", () => {
    const layout = readProjectFile("../../routes/+layout.svelte")
    const gitPage = readProjectFile("../../routes/git/+page.svelte")
    const safeAvatar = readProjectFile("../components/SafeAvatarImage.svelte")

    expect(layout).toContain("@app/components/SafeAvatarImage.svelte")
    expect(gitPage).toContain("@app/components/SafeAvatarImage.svelte")
    expect(safeAvatar).toContain("{#if safeSrc}")
    expect(safeAvatar).toContain("<BaseAvatarImage")
  })
})
