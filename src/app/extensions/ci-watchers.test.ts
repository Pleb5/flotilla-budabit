import {describe, expect, it} from "vitest"
import {getPublicKey} from "nostr-tools/pure"
import type {TrustedEvent} from "@welshman/util"
import {buildCommunityDefinition, parseCommunityDefinition} from "@app/core/community"
import {
  filterExcludedCommunityRefs,
  selectUserCommunityRefs,
  type ActiveUserCommunityRef,
} from "@app/core/community-membership"
import {selectPreferredCommunities} from "@app/util/community-preferences"
import {parseRepoCommunityBinding} from "@nostr-git/core/events"
import {selectRepoCiWatchers} from "./ci-watchers"
import {buildRepoExtensionUpdate} from "./repo-context"

const key = (n: number) => getPublicKey(new Uint8Array(32).fill(n))
function community(
  n: number,
  roles: ActiveUserCommunityRef["roles"],
  watchers = [{pubkey: key(n + 10), relays: ["wss://ci.example"]}],
): ActiveUserCommunityRef {
  const template = buildCommunityDefinition({
    communityId: key(n),
    name: `Community ${n}`,
    relays: ["wss://community.example"],
    ciRepoWatchers: watchers,
    sections: [{name: "General", kinds: [{kind: 1111}], profileLists: []}],
  })
  const definition = parseCommunityDefinition({
    ...template,
    id: key(n + 30),
    pubkey: key(n),
    created_at: n,
    sig: "",
  } as TrustedEvent)!
  return {community: definition.pointer, definition, relayHints: [], roles, writableSections: []}
}

describe("eligible community CI watchers", () => {
  it("prioritizes an h-only repo community over admin elsewhere, then admin/moderator/member", () => {
    const refs = [
      community(1, ["member"]),
      community(2, ["moderator"]),
      community(3, ["admin"]),
      community(4, ["member"]),
    ]
    const association = parseRepoCommunityBinding({tags: [["h", key(1)]]})
    const choices = selectRepoCiWatchers(refs, [], association)
    expect(choices.map(c => c.communityName)).toEqual([
      "Community 1",
      "Community 3",
      "Community 2",
      "Community 4",
    ])
    expect(choices.map(c => c.repoMatch)).toEqual([true, false, false, false])
  })

  it("respects exact legacy branch hints and does not confuse sibling controllers", () => {
    const first = community(1, ["member"])
    const second = community(2, ["member"])
    second.community = {...second.community, communityId: first.community.communityId}
    const choices = selectRepoCiWatchers([first, second], [], {
      communityId: key(1),
      address: second.community.address,
    })
    expect(choices[0].communityAddress).toBe(second.community.address)
    expect(choices[1].repoMatch).toBe(false)
  })

  it("uses existing community preferences for same-role ties and deterministic keys after that", () => {
    const refs = [community(1, ["member"]), community(2, ["member"])]
    const preferences = selectPreferredCommunities({memberCommunityRefs: refs})
    expect(selectRepoCiWatchers(refs, preferences).map(c => c.communityAddress)).toEqual(
      preferences.map(p => p.communityAddress),
    )
    expect(selectRepoCiWatchers(refs, [])).toEqual(selectRepoCiWatchers([...refs].reverse(), []))
  })

  it("deduplicates service identities, keeping strongest attribution and merging advertised relays", () => {
    const refs = [
      community(1, ["member"], [{pubkey: key(11), relays: ["wss://one.example"]}]),
      community(2, ["admin"], [{pubkey: key(11), relays: ["wss://two.example"]}]),
    ]
    expect(selectRepoCiWatchers(refs, [])).toEqual([
      expect.objectContaining({
        pubkey: key(11),
        communityName: "Community 2",
        role: "admin",
        relays: ["wss://two.example", "wss://one.example"],
      }),
    ])
  })

  it("does not turn preferences, repo association, renounced membership or empty roles into eligibility", () => {
    const ref = community(1, ["member"])
    const preferences = selectPreferredCommunities({memberCommunityRefs: [ref]})
    const unrelated = selectUserCommunityRefs({author: key(99), definitions: [ref.definition]})
    expect(selectRepoCiWatchers(unrelated, preferences, {communityId: key(1)})).toEqual([])
    expect(
      selectRepoCiWatchers(
        filterExcludedCommunityRefs([ref], [ref.community.address]),
        preferences,
      ),
    ).toEqual([])
    expect(selectRepoCiWatchers([{...ref, roles: []}], preferences)).toEqual([])
  })

  it("carries the ranked choices in both push context shapes", () => {
    const ciWatchers = selectRepoCiWatchers([community(1, ["member"])], [])
    const update = buildRepoExtensionUpdate({pubkey: key(1), name: "repo", ciWatchers}, key(2))
    expect(update.repo.ciWatchers).toEqual(ciWatchers)
    expect(JSON.parse(JSON.stringify(update)).repo.ciWatchers).toEqual(ciWatchers)
  })
})
