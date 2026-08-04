import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const source = readFileSync(
  new URL("../../routes/settings/notifications/+page.svelte", import.meta.url),
  "utf8",
)
const profileSource = readFileSync(new URL("../components/Profile.svelte", import.meta.url), "utf8")

describe("email digest notification settings UI", () => {
  it("uses profile identity and recommendation evidence instead of pubkeys in provider options", () => {
    expect(source).toContain('import Profile from "@app/components/Profile.svelte"')
    expect(source).toContain("showPubkey")
    expect(profileSource).toContain("Copy profile npub")
    expect(source).toContain("Community evidence")
    expect(source).toContain("<InlinePopover")
    expect(source).not.toContain("provider.servicePubkey.slice")
    expect(source).not.toContain("endorsed by")
  })

  it("keeps email verification guidance on the page after a successful subscription", () => {
    expect(source).toContain("verificationRequired")
    expect(source).toContain("Verify your delivery email")
    expect(source).toContain("We sent a verification email")
    expect(source).toContain("I've verified, refresh status")
  })
})
