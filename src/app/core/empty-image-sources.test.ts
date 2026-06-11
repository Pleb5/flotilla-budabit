import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("empty image source guards", () => {
  it("prevents ImageIcon from rendering an img for empty sources", () => {
    const source = readProjectFile("../../lib/components/ImageIcon.svelte")

    expect(source).toContain("fallbackSrc?: string | null")
    expect(source).toContain('const safeSrc = $derived(String(src || "").trim())')
    expect(source).toContain("const safeFallbackSrc = $derived")
    expect(source).toContain(
      "const activeSrc = $derived(!safeSrc || imageFailed ? safeFallbackSrc : safeSrc)",
    )
    expect(source).toContain("warnEmptyImageSource")
    expect(source).toContain("{#if !activeSrc || activeImageFailed}")
    expect(source).toContain("{:else if activeSrc.includes")
    expect(source).toContain("src={activeSrc}")
    expect(source).toContain("onerror={markImageFailed}")
  })

  it("uses the fallback avatar icon when profile images fail", () => {
    const source = readProjectFile("../components/ProfileCircle.svelte")

    expect(source).toContain("fallbackSrc={UserRounded}")
    expect(source).toContain("src={$profile?.picture}")
    expect(source).not.toContain("src={$profile?.picture || UserRounded}")
  })

  it("uses profile avatar fallback instead of empty ChannelMessage picture src", () => {
    const source = readProjectFile("../components/ChannelMessage.svelte")

    expect(source).toContain("ProfileCircle")
    expect(source).not.toContain('$profile?.picture || ""')
  })

  it("uses safe AvatarImage for Nostr Git UI avatar fallbacks", () => {
    const layout = readProjectFile("../../routes/+layout.svelte")
    const safeAvatar = readProjectFile("../components/SafeAvatarImage.svelte")

    expect(layout).toContain("@app/components/SafeAvatarImage.svelte")
    expect(safeAvatar).toContain("{#if safeSrc && !imageFailed}")
    expect(safeAvatar).toContain("warnEmptyImageSource")
    expect(safeAvatar).toContain("onerror={markImageFailed}")
    expect(safeAvatar).toContain("<BaseAvatarImage")
  })

  it("uses profile avatar fallback for Git page profile avatars", () => {
    const gitPage = readProjectFile("../../routes/git/+page.svelte")

    expect(gitPage).toContain("ProfileCircle")
    expect(gitPage).not.toContain("AvatarImage src={prof?.picture}")
  })

  it("falls back when community profile images fail to load", () => {
    const preview = readProjectFile("../components/community/CommunityPreviewCard.svelte")
    const link = readProjectFile("../components/community/CommunityLinkCard.svelte")
    const menu = readProjectFile("../components/CommunityMenu.svelte")
    const home = readProjectFile("../../routes/c/[community]/+page.svelte")

    expect(preview).toContain("failedPicture")
    expect(preview).toContain("onerror={() => (failedPicture = picture)}")
    expect(link).toContain("failedPicture")
    expect(link).toContain("onerror={() => (failedPicture = picture)}")
    expect(menu).toContain("showCommunityPicture")
    expect(menu).toContain("onerror={() => (failedPicture = communityPicture)}")
    expect(home).toContain("showCommunityPicture")
    expect(home).toContain("onerror={() => (failedPicture = communityPicture)}")
  })
})
