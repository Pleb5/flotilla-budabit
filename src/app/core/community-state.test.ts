import {describe, expect, it} from "vitest"
import {get} from "svelte/store"
import {repository} from "@welshman/app"
import * as nip19 from "nostr-tools/nip19"
import {BADGE_DEFINITION, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  FORM_TEMPLATE_KIND,
  PROFILE_LIST_KIND,
  parseCommunityInput,
  parseCommunityDefinition,
} from "./community"
import {
  getBadgeDefinitionRefs,
  getCommunityBootstrapRelays,
  COMMUNITY_DISCOVERY_RELAYS,
  activeCommunityAdmissionFormEvents,
  activeCommunityAdmissionForms,
  getProfileListRefs,
  makeCommunityAdmissionFormFilters,
  makeCommunityBadgeDefinitionFilters,
  makeCommunityDefinitionFilter,
  makeCommunityProfileListFilters,
  makeCommunitySession,
  selectLatestCommunityDefinition,
  activeCommunityDefinition,
  activeCommunityBadgeDefinitionEvents,
  activeCommunityProfile,
  activeCommunityProfileListEvents,
  activeCommunityRelays,
  activeCommunitySession,
  clearActiveCommunity,
  setActiveCommunityDefinition,
  setActiveCommunityInput,
  type CommunityProfile,
} from "./community-state"
import {makeCommunityDefinitionAddress, type CommunityAdmissionForm} from "./community-forms"

const communityPubkey = "a".repeat(64)
const listPubkey = "b".repeat(64)
const badgePubkey = "c".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: communityPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeCommunityDefinitionEvent = (created_at: number, id = `definition-${created_at}`) =>
  makeEvent({
    id,
    kind: COMMUNITY_DEFINITION_KIND,
    created_at,
    pubkey: communityPubkey,
    tags: [
      ["r", "wss://relay.example.com"],
      ["content", "General"],
      ["k", "1111"],
      ["a", `${PROFILE_LIST_KIND}:${listPubkey}:General`, "wss://relay.example.com"],
      ["badge", `${BADGE_DEFINITION}:${badgePubkey}:member`],
    ],
  })

const waitForActiveCommunityProfile = (name: string) =>
  new Promise<CommunityProfile>(resolve => {
    let unsubscribe = () => {}

    unsubscribe = activeCommunityProfile.subscribe(profile => {
      if (profile?.name === name) {
        queueMicrotask(unsubscribe)
        resolve(profile)
      }
    })
  })

const waitForAdmissionForm = (sectionName: string) =>
  new Promise<Record<string, CommunityAdmissionForm>>(resolve => {
    let unsubscribe = () => {}

    unsubscribe = activeCommunityAdmissionForms.subscribe(forms => {
      if (forms[sectionName]) {
        queueMicrotask(unsubscribe)
        resolve(forms)
      }
    })
  })

describe("community state helpers", () => {
  it("creates community sessions from parsed input", () => {
    const parsed = parseCommunityInput(
      `ncommunity://${communityPubkey}?relay=${encodeURIComponent("wss://relay.example.com")}`,
    )!
    const session = makeCommunitySession(parsed)

    expect(session).toEqual({
      communityPubkey,
      communityRelayHints: ["wss://relay.example.com/"],
      communityDefinitionId: undefined,
    })
  })

  it("preserves relay hints when the same community input omits them", () => {
    clearActiveCommunity()

    setActiveCommunityInput(
      `ncommunity://${communityPubkey}?relay=${encodeURIComponent("wss://relay.example.com")}`,
    )
    expect(get(activeCommunitySession)?.communityRelayHints).toEqual(["wss://relay.example.com/"])

    setActiveCommunityInput(nip19.npubEncode(communityPubkey))
    expect(get(activeCommunitySession)).toEqual({
      communityPubkey,
      communityRelayHints: ["wss://relay.example.com/"],
      communityDefinitionId: undefined,
    })

    clearActiveCommunity()
  })

  it("builds bootstrap relay lists from hints", () => {
    expect(getCommunityBootstrapRelays(["wss://relay.example.com", "bad-relay"])).toEqual([
      "wss://relay.example.com/",
      ...COMMUNITY_DISCOVERY_RELAYS,
    ])
  })

  it("builds community definition filters", () => {
    expect(makeCommunityDefinitionFilter(communityPubkey)).toEqual({
      kinds: [COMMUNITY_DEFINITION_KIND],
      authors: [communityPubkey],
      limit: 1,
    })
  })

  it("selects the latest valid community definition for the pubkey", () => {
    const older = makeCommunityDefinitionEvent(1, "older")
    const newer = makeCommunityDefinitionEvent(2, "newer")
    const wrongAuthor = makeEvent({
      ...makeCommunityDefinitionEvent(3, "wrong"),
      pubkey: "d".repeat(64),
    })

    expect(
      selectLatestCommunityDefinition([older, wrongAuthor, newer], communityPubkey)?.event.id,
    ).toBe("newer")
  })

  it("extracts profile-list and badge refs from definitions", () => {
    const definition = parseCommunityDefinition(makeCommunityDefinitionEvent(1))!

    expect(getProfileListRefs(definition)).toMatchObject([
      {kind: PROFILE_LIST_KIND, pubkey: listPubkey, identifier: "General"},
    ])
    expect(getBadgeDefinitionRefs(definition)).toMatchObject([
      {kind: BADGE_DEFINITION, pubkey: badgePubkey, identifier: "member"},
    ])
    expect(makeCommunityProfileListFilters(definition)).toEqual([
      {kinds: [PROFILE_LIST_KIND], authors: [listPubkey], "#d": ["General"], limit: 1},
    ])
    expect(makeCommunityBadgeDefinitionFilters(definition)).toEqual([
      {kinds: [BADGE_DEFINITION], authors: [badgePubkey], "#d": ["member"], limit: 1},
    ])
  })

  it("builds and selects moderator admission form filters", async () => {
    const definition = parseCommunityDefinition(
      makeEvent({
        kind: COMMUNITY_DEFINITION_KIND,
        pubkey: communityPubkey,
        tags: [
          ["r", "wss://relay.example.com"],
          ["content", "Repositories"],
          ["k", "30617"],
          ["a", `${PROFILE_LIST_KIND}:${badgePubkey}:Repositories`, "wss://relay.example.com"],
          ["badge", `${BADGE_DEFINITION}:${badgePubkey}:repo-curator`],
        ],
      }),
    )!
    const form = makeEvent({
      id: "repo-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: badgePubkey,
      created_at: 2,
      tags: [
        ["d", "repo-form"],
        ["a", makeCommunityDefinitionAddress(communityPubkey)],
        ["content", "Repositories"],
        ["name", "Repository application"],
      ],
    })
    const wrongSectionForm = makeEvent({
      id: "forum-form",
      kind: FORM_TEMPLATE_KIND,
      pubkey: badgePubkey,
      created_at: 3,
      tags: [
        ["d", "forum-form"],
        ["a", makeCommunityDefinitionAddress(communityPubkey)],
        ["content", "Forum"],
      ],
    })

    expect(makeCommunityAdmissionFormFilters(definition)).toEqual([
      {
        kinds: [FORM_TEMPLATE_KIND],
        authors: [badgePubkey],
        "#a": [makeCommunityDefinitionAddress(communityPubkey)],
      },
    ])

    setActiveCommunityDefinition(definition)
    repository.publish(form)
    repository.publish(wrongSectionForm)

    expect((await waitForAdmissionForm("Repositories")).Repositories?.event.id).toBe("repo-form")

    repository.removeEvent(form.id)
    repository.removeEvent(wrongSectionForm.id)
    repository.removeEvent(definition.event.id)
    clearActiveCommunity()
  })

  it("derives active community relays from the loaded definition", () => {
    const definition = parseCommunityDefinition(makeCommunityDefinitionEvent(1))!

    activeCommunitySession.set({
      communityPubkey,
      communityRelayHints: ["wss://hint.example.com/"],
    })
    expect(get(activeCommunityRelays)).toEqual([
      "wss://hint.example.com/",
      ...COMMUNITY_DISCOVERY_RELAYS,
    ])

    setActiveCommunityDefinition(definition)
    expect(get(activeCommunityDefinition)?.event.id).toBe("definition-1")
    expect(get(activeCommunityRelays)).toEqual(["wss://relay.example.com/"])

    clearActiveCommunity()
    expect(get(activeCommunitySession)).toBeUndefined()
    expect(get(activeCommunityDefinition)).toBeUndefined()
    expect(get(activeCommunityProfileListEvents)).toEqual([])
    expect(get(activeCommunityBadgeDefinitionEvents)).toEqual([])
    expect(get(activeCommunityAdmissionFormEvents)).toEqual([])
  })

  it("derives active community profile metadata from Welshman cache", async () => {
    repository.publish(
      makeEvent({
        id: "profile-older",
        kind: 0,
        created_at: 1,
        content: JSON.stringify({name: "Older"}),
      }),
    )
    repository.publish(
      makeEvent({
        id: "profile-newer",
        kind: 0,
        created_at: 2,
        content: JSON.stringify({name: "Community", picture: "https://example.com/logo.png"}),
      }),
    )

    activeCommunitySession.set({
      communityPubkey,
      communityRelayHints: [],
    })

    expect(await waitForActiveCommunityProfile("Community")).toMatchObject({
      name: "Community",
      picture: "https://example.com/logo.png",
    })

    repository.removeEvent("profile-older")
    repository.removeEvent("profile-newer")
    clearActiveCommunity()
  })
})
