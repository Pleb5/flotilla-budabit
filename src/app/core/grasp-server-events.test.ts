import {describe, expect, it} from "vitest"
import {DEFAULT_GRASP_SET_ID, GIT_USER_GRASP_LIST, GRASP_SET_KIND} from "@nostr-git/core/events"
import type {TrustedEvent} from "@welshman/util"

import {
  getPreferredGraspServerUrls,
  makeGraspServerListFilters,
  parseUserGraspServerUrls,
} from "./grasp-server-events"

const pubkey = "a".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: overrides.id || `${overrides.kind || 1}`.padStart(64, "0"),
    pubkey,
    created_at: overrides.created_at ?? 1,
    kind: overrides.kind ?? 1,
    tags: overrides.tags || [],
    content: overrides.content || "",
    sig: "0".repeat(128),
  }) as TrustedEvent

describe("grasp server events", () => {
  it("builds new and legacy filters for migration fallback", () => {
    expect(makeGraspServerListFilters(pubkey)).toEqual([
      {kinds: [GIT_USER_GRASP_LIST], authors: [pubkey]},
      {kinds: [GRASP_SET_KIND], authors: [pubkey], "#d": [DEFAULT_GRASP_SET_ID]},
    ])
  })

  it("parses ordered websocket URLs from a user grasp list", () => {
    const event = makeEvent({
      kind: GIT_USER_GRASP_LIST,
      tags: [
        ["g", "wss://one.example/"],
        ["g", "https://not-websocket.example"],
        ["g", "wss://two.example"],
        ["g", "wss://one.example"],
      ],
    })

    expect(parseUserGraspServerUrls(event)).toEqual(["wss://one.example", "wss://two.example"])
  })

  it("prefers kind 10317 over legacy kind 30002", () => {
    const legacy = makeEvent({
      kind: GRASP_SET_KIND,
      created_at: 20,
      tags: [["d", DEFAULT_GRASP_SET_ID]],
      content: JSON.stringify({urls: ["wss://legacy.example"]}),
    })
    const current = makeEvent({
      kind: GIT_USER_GRASP_LIST,
      created_at: 10,
      tags: [["g", "wss://current.example"]],
    })

    expect(getPreferredGraspServerUrls([legacy, current])).toEqual(["wss://current.example"])
  })

  it("treats an empty kind 10317 list as authoritative", () => {
    const legacy = makeEvent({
      kind: GRASP_SET_KIND,
      tags: [["d", DEFAULT_GRASP_SET_ID]],
      content: JSON.stringify({urls: ["wss://legacy.example"]}),
    })
    const emptyCurrent = makeEvent({
      kind: GIT_USER_GRASP_LIST,
      created_at: 2,
      tags: [],
    })

    expect(getPreferredGraspServerUrls([legacy, emptyCurrent])).toEqual([])
  })

  it("uses legacy kind 30002 only when no kind 10317 list exists", () => {
    const legacy = makeEvent({
      kind: GRASP_SET_KIND,
      tags: [["d", DEFAULT_GRASP_SET_ID]],
      content: JSON.stringify({urls: ["wss://legacy.example/"]}),
    })

    expect(getPreferredGraspServerUrls([legacy])).toEqual(["wss://legacy.example"])
  })
})
