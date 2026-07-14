import {describe, expect, it} from "vitest"
import {
  buildGraspRepoDeleteRequest,
  buildRepoDeleteTags,
  buildRepoOwnedDeleteFilters,
  canDeleteLocalRepoAfterRemoteResults,
  getGraspRepoDeleteTarget,
  getMetadataDeleteRelays,
  getRepoDeleteAddresses,
  matchesRepoDeleteEvent,
} from "./repo-delete"
import {nip19} from "nostr-tools"

describe("repo delete helpers", () => {
  it("deduplicates repo delete addresses and keeps fallback", () => {
    expect(
      getRepoDeleteAddresses(
        ["30617:alice:repo", "30617:alice:repo", "30617:alice:repo-renamed"],
        "30617:alice:repo",
      ),
    ).toEqual(["30617:alice:repo", "30617:alice:repo-renamed"])
  })

  it("matches delete events against any effective repo address", () => {
    const event = {
      tags: [["repo", "30617:alice:repo-renamed"]],
    }

    expect(matchesRepoDeleteEvent(event, ["30617:alice:repo-renamed"], "30617:alice:repo")).toBe(
      true,
    )
    expect(matchesRepoDeleteEvent(event, ["30617:alice:repo-other"], "30617:alice:repo")).toBe(
      false,
    )
  })

  it("builds repo-owned delete filters across all effective addresses", () => {
    const filters = buildRepoOwnedDeleteFilters({
      pubkey: "a".repeat(64),
      repoName: "repo",
      repoAddresses: ["30617:alice:repo", "30617:alice:repo-renamed"],
    })

    expect(filters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({"#d": ["repo"]}),
        expect.objectContaining({"#a": ["30617:alice:repo", "30617:alice:repo-renamed"]}),
      ]),
    )
  })

  it("derives an owner-matched GRASP relay from a clone URL", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/repo.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toEqual({
      relay: "wss://grasp.example",
      ownerNpub,
      identifier: "repo",
    })
  })

  it("requires clone bases to match relay hints and preserves deployment paths", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/git/${ownerNpub}/repo.git`,
        ownerPubkey,
        identifier: "repo",
        relayHints: ["wss://grasp.example/git/"],
      }),
    ).toEqual({relay: "wss://grasp.example/git", ownerNpub, identifier: "repo"})
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/repo.git`,
        ownerPubkey,
        identifier: "repo",
        relayHints: ["wss://other.example"],
      }),
    ).toBeNull()
  })

  it("rejects GRASP clone URLs for another owner or repository", () => {
    const ownerPubkey = "a".repeat(64)
    const ownerNpub = nip19.npubEncode(ownerPubkey)

    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${ownerNpub}/other.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toBeNull()
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: `https://grasp.example/${nip19.npubEncode("b".repeat(64))}/repo.git`,
        ownerPubkey,
        identifier: "repo",
      }),
    ).toBeNull()
  })

  it("builds a coordinate-only GRASP repository deletion request", () => {
    const ownerPubkey = "a".repeat(64)
    const request = buildGraspRepoDeleteRequest({
      event: {
        kind: 30617,
        pubkey: ownerPubkey,
        created_at: 110,
        tags: [["d", "repo"]],
      },
      ownerPubkey,
      now: 100,
    })

    expect(request).toEqual({
      createdAt: 110,
      coordinate: `30617:${ownerPubkey}:repo`,
      tags: [
        ["a", `30617:${ownerPubkey}:repo`],
        ["k", "30617"],
        ["repo", `30617:${ownerPubkey}:repo`],
      ],
    })
    expect(request.tags.some(tag => tag[0] === "e")).toBe(false)
  })

  it("uses coordinates for replaceable metadata and ids for regular events", () => {
    const ownerPubkey = "a".repeat(64)
    const tags = buildRepoDeleteTags([
      {
        id: "announcement-id",
        kind: 30617,
        pubkey: ownerPubkey,
        created_at: 100,
        tags: [["d", "repo"]],
      } as any,
      {
        id: "issue-id",
        kind: 1621,
        pubkey: ownerPubkey,
        created_at: 100,
        tags: [],
      } as any,
    ])

    expect(tags).toContainEqual(["a", `30617:${ownerPubkey}:repo`])
    expect(tags).toContainEqual(["e", "issue-id"])
    expect(tags).not.toContainEqual(["e", "announcement-id"])
  })

  it("keeps GRASP hosts out of broad metadata deletion even when target validation fails", () => {
    expect(
      getMetadataDeleteRelays({
        relays: ["wss://grasp.example", "wss://metadata.example"],
        remoteTargets: [
          {
            vendor: "grasp",
            url: "https://grasp.example/invalid/repo.git",
          },
        ],
      }),
    ).toEqual(["wss://metadata.example"])
  })

  it("preserves the local clone after partial metadata or selected remote failure", () => {
    const base = {
      metadataDeliveriesAttempted: 2,
      metadataDeliveriesAccepted: 2,
      selectedRemoteIds: new Set(["grasp:a"]),
      remoteResults: [{id: "grasp:a", status: "accepted"}],
    }

    expect(canDeleteLocalRepoAfterRemoteResults(base)).toBe(true)
    expect(canDeleteLocalRepoAfterRemoteResults({...base, metadataDeliveriesAccepted: 1})).toBe(
      false,
    )
    expect(
      canDeleteLocalRepoAfterRemoteResults({
        ...base,
        remoteResults: [{id: "grasp:a", status: "failed"}],
      }),
    ).toBe(false)
    expect(canDeleteLocalRepoAfterRemoteResults({...base, inventoryError: "relay timeout"})).toBe(
      false,
    )
  })

  it("rejects unauthorized and far-future GRASP deletion requests", () => {
    const ownerPubkey = "a".repeat(64)
    const event = {
      kind: 30617,
      pubkey: ownerPubkey,
      created_at: 1_000,
      tags: [["d", "repo"]],
    }

    expect(() =>
      buildGraspRepoDeleteRequest({event, ownerPubkey: "b".repeat(64), now: 1_000}),
    ).toThrow("Only the repository announcement author")
    expect(() => buildGraspRepoDeleteRequest({event, ownerPubkey, now: 600})).toThrow(
      "timestamp is too far in the future",
    )
  })

  it("rejects malformed percent-encoding in GRASP clone URLs", () => {
    expect(
      getGraspRepoDeleteTarget({
        cloneUrl: "https://grasp.example/%E0%A4%A/repo.git",
        ownerPubkey: "a".repeat(64),
        identifier: "repo",
      }),
    ).toBeNull()
  })
})
