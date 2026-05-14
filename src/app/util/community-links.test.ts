import {describe, expect, it} from "vitest"
import {ParsedType, type ParsedLink} from "@welshman/content"
import {
  findNcommunityLinkStart,
  getNcommunityLinkAtStart,
  isCommunityLinkToken,
  parseNcommunityLink,
  replaceCommunityLinks,
} from "./community-links"

const pubkey = "a".repeat(64)
const ncommunity = `ncommunity://${pubkey}?relay=${encodeURIComponent("wss://relay.example.com")}`

describe("community link helpers", () => {
  it("parses documented ncommunity links", () => {
    expect(parseNcommunityLink(ncommunity)).toEqual({
      pubkey,
      relays: ["wss://relay.example.com/"],
      source: "ncommunity",
    })
  })

  it("finds standalone ncommunity links", () => {
    expect(findNcommunityLinkStart(`share ${ncommunity}`)).toBe(6)
    expect(findNcommunityLinkStart(`https://example.com/${ncommunity}`)).toBe(-1)
  })

  it("tokenizes ncommunity links at the current parser position", () => {
    expect(getNcommunityLinkAtStart(`${ncommunity}.`)).toMatchObject({
      type: "community",
      raw: ncommunity,
      value: {pubkey, relays: ["wss://relay.example.com/"], source: "ncommunity"},
    })
  })

  it("replaces parsed links with community tokens", () => {
    const parsedLink: ParsedLink = {
      type: ParsedType.Link,
      raw: ncommunity,
      value: {url: new URL(ncommunity), meta: {}},
    }

    const [token] = replaceCommunityLinks([parsedLink])

    expect(isCommunityLinkToken(token)).toBe(true)
    expect(token).toMatchObject({value: {pubkey, relays: ["wss://relay.example.com/"]}})
  })
})
