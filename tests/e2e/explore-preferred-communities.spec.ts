import {expect, test} from "@playwright/test"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {DEV_PUBKEY, seedDevSession} from "./helpers/dev-session"
import {MockRelay} from "./helpers/mock-relay"

const currentCommunityPubkey = "a".repeat(64)
const memberCommunitySecret = Uint8Array.from({length: 32}, (_, index) => index + 1)
const profileListSecret = Uint8Array.from({length: 32}, (_, index) => index + 33)
const profileListPubkey = getPublicKey(profileListSecret)
const currentCommunityRelay = "wss://current-community.example/"
const memberCommunityRelay = "wss://member-community.example/"

test("discovers a cold member community when another community is already visible", async ({
  page,
}) => {
  const memberCommunityDefinition = finalizeEvent(
    {
      kind: 10222,
      created_at: 1,
      content: "",
      tags: [
        ["r", memberCommunityRelay],
        ["content", "General"],
        ["k", "1111"],
        ["a", `30000:${profileListPubkey}:General`, memberCommunityRelay],
      ],
    },
    memberCommunitySecret,
  )
  const memberProfileList = finalizeEvent(
    {
      kind: 30000,
      created_at: 1,
      content: "",
      tags: [
        ["d", "General"],
        ["p", DEV_PUBKEY],
      ],
    },
    profileListSecret,
  )
  const mockRelay = new MockRelay({
    seedEvents: [memberCommunityDefinition],
    seedEventsByRelay: {[memberCommunityRelay]: [memberProfileList]},
  })

  await seedDevSession(page)
  await page.addInitScript(
    ({communityPubkey, relay}) => {
      localStorage.setItem(
        "budabit/community-session",
        JSON.stringify({communityPubkey, communityRelayHints: [relay]}),
      )
    },
    {communityPubkey: currentCommunityPubkey, relay: currentCommunityRelay},
  )
  await mockRelay.setup(page)

  await page.goto("/explore")

  await expect(page.getByText("Last visited", {exact: true})).toBeVisible()
  await expect(page.getByText("Member", {exact: true})).toBeVisible({timeout: 15_000})
})
