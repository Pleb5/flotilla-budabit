import {describe, expect, it} from "vitest"
import {
  getDeclaredRepoRelays,
  getRepoPublicationAddress,
  getRepoPublicationCoordinates,
  requireRepoPublicationScope,
} from "./repo-publication"

const owner = "a".repeat(64)
const otherOwner = "b".repeat(64)
const repoAddress = `30617:${owner}:repo`
const relay = "wss://repo.example.com"

describe("repository publication authority", () => {
  it("normalizes explicit authority and accepts repeated matching coordinates", () => {
    const event = {
      kind: 1621,
      tags: [
        ["a", repoAddress],
        ["A", repoAddress],
        ["q", repoAddress],
        ["repo", repoAddress],
      ],
    }

    expect(requireRepoPublicationScope({event, relays: [relay, `${relay}/`], repoAddress})).toEqual(
      [`${relay}/`],
    )
    expect(getRepoPublicationCoordinates(event)).toEqual([repoAddress])
  })

  it("accepts URL-valued repo metadata on a permalink", () => {
    const event = {
      kind: 1623,
      tags: [
        ["a", repoAddress],
        ["repo", "https://github.com/budabit/budabit"],
      ],
    }

    expect(requireRepoPublicationScope({event, relays: [relay], repoAddress})).toEqual([
      `${relay}/`,
    ])
    expect(getRepoPublicationCoordinates(event)).toEqual([repoAddress])
  })

  it("fails closed for empty relays", () => {
    expect(() =>
      requireRepoPublicationScope({event: {kind: 1621, tags: [["a", repoAddress]]}, relays: []}),
    ).toThrow("requires at least one valid relay declared")
  })

  it("rejects conflicting coordinate-valued permalink tags", () => {
    expect(() =>
      requireRepoPublicationScope({
        event: {
          kind: 1623,
          tags: [
            ["a", repoAddress],
            ["repo", `30617:${otherOwner}:other`],
          ],
        },
        relays: [relay],
        repoAddress,
      }),
    ).toThrow("conflicting repository coordinates")
  })

  it("rejects malformed coordinate-like tag values", () => {
    expect(() => getRepoPublicationCoordinates({tags: [["repo", "30617"]]})).toThrow(
      "malformed repository coordinate",
    )
    expect(() =>
      getRepoPublicationCoordinates({tags: [["repo", "30617:not-a-pubkey:repo"]]}),
    ).toThrow("must be a valid 30617")
  })

  it("requires announcements to declare a relay", () => {
    const event = {kind: 30617, pubkey: owner, tags: [["d", "repo"]]}

    expect(getDeclaredRepoRelays(event)).toEqual([])
    expect(() => requireRepoPublicationScope({event, relays: [relay]})).toThrow(
      "must declare at least one valid repository relay",
    )
  })

  it("validates unsigned state identifiers against the authoritative coordinate", () => {
    expect(() =>
      requireRepoPublicationScope({
        event: {kind: 30618, tags: [["d", "other"]]},
        relays: [relay],
        repoAddress,
      }),
    ).toThrow("Repository state targets other")

    expect(
      requireRepoPublicationScope({
        event: {kind: 30618, tags: [["d", "repo"]]},
        relays: [relay],
        repoAddress,
      }),
    ).toEqual([`${relay}/`])
  })

  it("derives announcement and state addresses for rollback scoping", () => {
    expect(getRepoPublicationAddress({kind: 30617, pubkey: owner, tags: [["d", "repo"]]})).toBe(
      repoAddress,
    )
    expect(getRepoPublicationAddress({kind: 30618, pubkey: owner, tags: [["d", "repo"]]})).toBe(
      repoAddress,
    )
  })
})
