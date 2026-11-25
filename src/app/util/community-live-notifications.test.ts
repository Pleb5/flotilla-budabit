import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {
  buildCommunityLiveCallNotificationRows,
  buildCommunityLiveStreamNotificationRows,
  makeCommunityCallConfigIdentifier,
} from "./community-live-notifications"

const OWNER = "0a8ecba4868c13e1e84cc5cb58c02c1fd0880d9e5a25a5050ee96ad8a166d7c8"
const MOD = "d04ecf33a303a59852fdb681ed8b412201ba85d8d2199aec73cb62681d62aa90"
const MEMBER = "1111111111111111111111111111111111111111111111111111111111111111"
const PROVIDER = "cf45a6ba1363ad7ed213a078e710d24115ae721c9b47bd1ebf4458eaefb4c2a5"
const ATTACKER = "2222222222222222222222222222222222222222222222222222222222222222"

const makeRef = (): ActiveUserCommunityRef =>
  ({
    community: {
      address: `32222:${OWNER}:${OWNER}`,
      ownerPubkey: OWNER,
      communityId: OWNER,
      relays: ["wss://relay.budabit.club"],
    },
    relayHints: ["wss://relay.budabit.club"],
    definition: {
      metadata: {name: "BudaBit"},
      ownerPubkey: OWNER,
      relays: ["wss://relay.budabit.club"],
      pointer: {address: `32222:${OWNER}:${OWNER}`, ownerPubkey: OWNER, communityId: OWNER},
      sections: [
        {
          name: "General",
          kinds: [{kind: 9, subtype: "room-message"}],
          profileLists: [
            {
              address: `30000:${MOD}:${OWNER}-general`,
              pubkey: MOD,
              identifier: `${OWNER}-general`,
              relay: "wss://relay.budabit.club",
            },
          ],
        },
      ],
    },
  }) as unknown as ActiveUserCommunityRef

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent => ({
  id: overrides.id || "evt1",
  kind: overrides.kind ?? 30078,
  pubkey: overrides.pubkey || MOD,
  created_at: overrides.created_at ?? 1_795_000_000,
  tags: overrides.tags || [],
  content: overrides.content ?? "",
  sig: "0".repeat(128),
})

const modProfileListEvent = makeEvent({
  id: "mod-list-1",
  kind: 30000,
  pubkey: MOD,
  created_at: 1_794_999_000,
  tags: [
    ["d", `${OWNER}-general`],
    ["p", MEMBER],
  ],
})

describe("community-live-notifications", () => {
  it("notifies members when a moderator launches a live community call and opens HiveTalk directly", () => {
    const ref = makeRef()
    const now = 1_795_000_050
    const dTag = makeCommunityCallConfigIdentifier(ref.community.address)
    const callEvent = makeEvent({
      id: "call-live-1",
      kind: 30078,
      pubkey: MOD,
      created_at: now - 20,
      tags: [
        ["d", dTag],
        ["descriptor", "9", "room-message"],
      ],
      content: JSON.stringify({
        status: "live",
        title: "Demo Day Call",
        room: "budabit-demo-room",
        hivetalkBase: "https://calls.budabit.club",
        startedAt: now - 20,
        expiresAt: now + 3600,
        startedBy: MOD,
        audio: 1,
        video: 1,
      }),
    })
    const spoofed = makeEvent({
      id: "call-spoof",
      kind: 30078,
      pubkey: ATTACKER,
      created_at: now - 5,
      tags: [
        ["d", dTag],
        ["descriptor", "9", "room-message"],
      ],
      content: JSON.stringify({
        status: "live",
        title: "Spoof",
        room: "budabit-spoof",
        hivetalkBase: "https://evil.example",
        startedAt: now - 5,
        expiresAt: now + 3600,
        startedBy: ATTACKER,
      }),
    })

    const rows = buildCommunityLiveCallNotificationRows({
      refs: [ref],
      events: [callEvent, spoofed],
      profileListEvents: [modProfileListEvent],
      currentPubkey: MEMBER,
      viewerName: "Alice",
      now,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Community call started")
    expect(rows[0].preview).toBe("Demo Day Call")
    expect(rows[0].path).toBe(
      "https://calls.budabit.club/join?room=budabit-demo-room&roomPassword=0&name=Alice&audio=1&video=1&screen=0&notify=1",
    )
    expect(rows[0].detail?.path).toContain("/c/")

    // Moderator who started the call does not get self-notified
    expect(
      buildCommunityLiveCallNotificationRows({
        refs: [ref],
        events: [callEvent],
        currentPubkey: MOD,
        now,
      }),
    ).toHaveLength(0)

    // Ended call delists notification
    const endedEvent = makeEvent({
      id: "call-ended-1",
      kind: 30078,
      pubkey: MOD,
      created_at: now,
      tags: [
        ["d", dTag],
        ["descriptor", "9", "room-message"],
      ],
      content: JSON.stringify({status: "ended", endedAt: now, endedBy: MOD}),
    })
    expect(
      buildCommunityLiveCallNotificationRows({
        refs: [ref],
        events: [callEvent, endedEvent],
        currentPubkey: MEMBER,
        now,
      }),
    ).toHaveLength(0)
  })

  it("notifies members on authorized live NIP-53 community streams and ignores ended/unauthorized streams", () => {
    const ref = makeRef()
    const liveStream = makeEvent({
      id: "stream-live-1",
      kind: 30311,
      pubkey: PROVIDER,
      created_at: 1_795_000_100,
      tags: [
        ["d", "demo-1"],
        ["title", "BudaBit Demo Day Stream"],
        ["status", "live"],
        ["streaming", "https://stream.example.com/live/demo.m3u8"],
        ["t", `budabit-community:${OWNER}`],
        ["p", MOD, "", "host"],
      ],
    })
    const unauthorizedStream = makeEvent({
      id: "stream-unauth",
      kind: 30311,
      pubkey: ATTACKER,
      created_at: 1_795_000_120,
      tags: [
        ["d", "spam"],
        ["title", "Spam"],
        ["status", "live"],
        ["t", `budabit-community:${OWNER}`],
      ],
    })

    const rows = buildCommunityLiveStreamNotificationRows({
      refs: [ref],
      events: [liveStream, unauthorizedStream],
      profileListEvents: [modProfileListEvent],
      currentPubkey: MEMBER,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0].title).toBe("Live stream started")
    expect(rows[0].preview).toBe("BudaBit Demo Day Stream")
    expect(rows[0].path).toContain("/c/")
    expect(rows[0].detail?.path).toMatch(/^https:\/\/[0-9a-z]{50}stream\.nsite\.run\/$/)

    // Ended replacement clears live notification
    const endedStream = makeEvent({
      id: "stream-ended-1",
      kind: 30311,
      pubkey: PROVIDER,
      created_at: 1_795_000_200,
      tags: [
        ["d", "demo-1"],
        ["title", "BudaBit Demo Day Stream"],
        ["status", "ended"],
        ["t", `budabit-community:${OWNER}`],
        ["p", MOD, "", "host"],
      ],
    })
    expect(
      buildCommunityLiveStreamNotificationRows({
        refs: [ref],
        events: [liveStream, endedStream],
        currentPubkey: MEMBER,
      }),
    ).toHaveLength(0)
  })
})
