import {describe, expect, it} from "vitest"
import {Repository} from "@welshman/net"
import {matchFilter, type TrustedEvent} from "@welshman/util"
import {makeCommunityPointer} from "./community-protocol"
import {makeCommunityDeletionFilter} from "./community-deletes"

const community = makeCommunityPointer({ownerPubkey: "a".repeat(64), communityId: "b".repeat(64)})!

describe("community delete scope", () => {
  it("admits current h-only deletes without k/authority tags or a history cutoff", () => {
    const target: TrustedEvent = {
      id: "old-thread",
      pubkey: "c".repeat(64),
      kind: 11,
      created_at: 1,
      tags: [["h", community.communityId]],
      content: "",
      sig: "",
    }
    const deletion: TrustedEvent = {
      ...target,
      id: "delete",
      kind: 5,
      created_at: 2,
      tags: [
        ["h", community.communityId],
        ["e", target.id],
      ],
    }
    const filter = makeCommunityDeletionFilter(community)
    expect(filter).toEqual({kinds: [5], "#h": [community.communityId]})
    expect(matchFilter(filter, deletion)).toBe(true)
    const repo = new Repository()
    repo.publish(target)
    repo.publish({...deletion, id: "foreign", pubkey: "d".repeat(64)})
    expect(repo.isDeleted(target)).toBe(false)
    repo.publish(deletion)
    expect(repo.isDeleted(target)).toBe(true)
  })

  it("rejects inconsistent pointers", () => {
    expect(() => makeCommunityDeletionFilter({...community, address: "invalid"})).toThrow()
  })
})
