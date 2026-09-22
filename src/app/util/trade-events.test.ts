import {describe, expect, it} from "vitest"
import {decode} from "nostr-tools/nip19"
import type {TrustedEvent} from "@welshman/util"
import {getTradeEventDetails, isTradeEventKind} from "./trade-events"

const event = (kind: number, tags: string[][] = []): TrustedEvent => ({
  id: "a".repeat(64),
  pubkey: "b".repeat(64),
  sig: "c".repeat(128),
  created_at: 100,
  kind,
  tags: [["d", "listing"], ...tags],
  content: "A useful listing",
})

describe("shared trade events", () => {
  it("recognizes all widget listing kinds without replacing unknown-event rendering", () => {
    for (const kind of [30402, 32765, 32766, 32767, 32768])
      expect(isTradeEventKind(kind)).toBe(true)
    for (const kind of [1, 30023, 12345, 1986]) expect(isTradeEventKind(kind)).toBe(false)
  })

  it("distinguishes a giveaway, sold item, expired listing and malformed price", () => {
    expect(getTradeEventDetails(event(30402, [["price", "0.00", "SATS"]]))).toMatchObject({
      price: "Free",
      status: "Giveaway",
    })
    expect(
      getTradeEventDetails(
        event(30402, [
          ["price", "0", "SATS"],
          ["status", "sold"],
        ]),
      ),
    ).toMatchObject({status: "Given away"})
    expect(
      getTradeEventDetails(
        event(30402, [
          ["price", "25.50", "USD", "day"],
          ["status", "sold"],
        ]),
      ),
    ).toMatchObject({price: "25.50 USD / day", status: "Sold"})
    expect(getTradeEventDetails(event(30402, [["expiration", "100"]]), [], 101).status).toBe(
      "Unavailable",
    )
    expect(getTradeEventDetails(event(30402)).price).toBe("Ask for price")
    for (const prices of [
      [["price", "-1", "SATS"]],
      [["price", "0", ""]],
      [
        ["price", "0", "SATS"],
        ["price", "20", "SATS"],
      ],
    ]) {
      expect(getTradeEventDetails(event(30402, prices)).price).toBe("Price unavailable")
    }
  })

  it("renders fixed/hourly terms and states without inventing offer acceptance", () => {
    expect(getTradeEventDetails(event(32767, [["s", "1"]]))).toMatchObject({
      label: "Job",
      status: "In progress",
      price: "Price set by proposals",
    })
    expect(
      getTradeEventDetails(
        event(32765, [
          ["s", "0"],
          ["amount", "500"],
          ["pricing", "1"],
        ]),
      ),
    ).toMatchObject({status: "Inactive", price: "500 sats / hour"})
    expect(
      getTradeEventDetails(
        event(32766, [
          ["s", "1"],
          ["amount", "500"],
          ["pricing", "0"],
        ]),
      ),
    ).toMatchObject({title: "Service order", status: "Fulfilled", price: "500 sats · Fixed price"})
    expect(getTradeEventDetails(event(32766, [["s", "0"]])).status).toBe("Open")
    expect(getTradeEventDetails(event(32768)).status).toBe("")
    expect(
      getTradeEventDetails(
        event(32765, [
          ["s", "99"],
          ["amount", "9007199254740992"],
          ["pricing", "0"],
        ]),
      ),
    ).toMatchObject({status: "Status unavailable", price: "Price unavailable"})
  })

  it("links title-less offers to their parent, preserving identifiers and excluding acceptance timestamps", () => {
    const pubkey = "d".repeat(64)
    const offer = event(32768, [
      ["a", `32767:${pubkey}:job:with:colons`, "1700000000"],
      ["a", `32222:${pubkey}:community`, "wss://community.example", "community"],
    ])
    const view = getTradeEventDetails(offer, ["wss://trade.example/"])
    expect(view.title).toBe("Job proposal")
    expect(view.parent?.label).toBe("View job")
    expect(decode(view.parent!.href.slice(1))).toEqual({
      type: "naddr",
      data: {kind: 32767, pubkey, identifier: "job:with:colons", relays: ["wss://trade.example/"]},
    })
    expect(
      getTradeEventDetails(event(32766, [["a", `32765:${pubkey}:service`, "", "community"]]))
        .parent,
    ).toBeUndefined()
    expect(getTradeEventDetails(event(32768, [["a", "32767:invalid:job"]])).parent).toBeUndefined()
  })

  it("orders and deduplicates photos, rejecting unsafe media while keeping text escaped by the view", () => {
    const view = getTradeEventDetails(
      event(30402, [
        ["title", "<img src=x onerror=alert(1)>"],
        ["image", "javascript:alert(1)"],
        ["image", "https://user:pass@example.com/a"],
        ["image", "https://example.com/b", "", "2"],
        ["image", "https://example.com/a", "", "1"],
        ["image", "https://example.com/a", "", "3"],
        ["t", "tools"],
        ["t", "tools"],
      ]),
    )
    expect(view.images).toEqual(["https://example.com/a", "https://example.com/b"])
    expect(view.categories).toEqual(["tools"])
    expect(view.title).toBe("<img src=x onerror=alert(1)>")
  })
})
