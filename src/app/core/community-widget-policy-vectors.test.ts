import {writeFileSync} from "node:fs"
import {describe, expect, it} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools/pure"
import {
  buildCommunityDefinition,
  parseCommunityDefinition,
  type CommunityDefinitionSectionInput,
} from "./community"
import {COMMUNITY_WRITE_TARGETS, canWriteCommunityTarget} from "./community-permissions"
import {getEffectiveCommunityReportState} from "./community-reports"

// Export the real host's Widget permissions for Blossom's independent policy tests.
const keys = [1, 2, 3, 4, 5, 6].map(n => new Uint8Array(32).fill(n))
const people = keys.map(getPublicKey)
const [owner, curator, moderator, generalMember] = people
const communityId = "b".repeat(64)
const branch = `32222:${owner}:${communityId}`
const list = `30000:${moderator}:${communityId}-widgets`
const general = `30000:${owner}:${communityId}-general`
const sign = (kind: number, tags: string[][], key = keys[0], created_at = 100) =>
  finalizeEvent({kind, tags, content: "", created_at}, key)
const widgets: CommunityDefinitionSectionInput = {
  name: "Widget curators",
  kinds: [{kind: 30033}],
  profileLists: [{address: list}],
}
const generalSection: CommunityDefinitionSectionInput = {
  name: "General",
  kinds: [{kind: 7}],
  profileLists: [{address: general}],
}
const definition = (sections = [generalSection, widgets]) => {
  const template = buildCommunityDefinition({
    communityId,
    name: "Widget permissions",
    relays: ["wss://authority.example"],
    sections,
  })
  return finalizeEvent({...template, created_at: 100}, keys[0])
}
const grant = sign(
  30000,
  [
    ["d", `${communityId}-widgets`],
    ["a", list],
    ["p", curator],
  ],
  keys[2],
)
const members = sign(30000, [
  ["d", `${communityId}-general`],
  ["a", general],
  ["p", generalMember],
])
const declined = sign(30000, [...grant.tags, ["status", "declined"]], keys[2], 101)
const removed = sign(
  30000,
  grant.tags.filter(t => t[0] !== "p"),
  keys[2],
  101,
)
const deleted = sign(5, [["a", list]], keys[2], 101)
const wrongDelete = sign(5, [["a", list]], keys[4], 101)
const banned = sign(1984, [
  ["h", communityId],
  ["a", branch, "", "community"],
  ["p", curator, "", "spam"],
])
const banModerator = sign(1984, [
  ["h", communityId],
  ["a", branch, "", "community"],
  ["p", moderator, "", "spam"],
])
const def = definition()
const cases = [
  {name: "current grants", events: [def, grant, members], allowed: [owner, curator, moderator]},
  {
    name: "newer list removes curator",
    events: [def, grant, removed, members],
    allowed: [owner, moderator],
  },
  {name: "declined list", events: [def, grant, declined, members], allowed: [owner, moderator]},
  {
    name: "missing list keeps structural moderator only",
    events: [def, members],
    allowed: [owner, moderator],
  },
  {name: "deleted list", events: [def, grant, deleted, members], allowed: [owner, moderator]},
  {
    name: "foreign deletion ignored",
    events: [def, grant, wrongDelete, members],
    allowed: [owner, curator, moderator],
  },
  {name: "person ban", events: [def, grant, banned, members], allowed: [owner, moderator]},
  {
    name: "banned structural moderator",
    events: [def, grant, banModerator, members],
    allowed: [owner, curator],
  },
  {
    name: "renamed Widgets section",
    events: [definition([generalSection, {...widgets, name: "Tools"}]), grant, members],
    allowed: [owner, curator, moderator],
  },
  {name: "Widget kind absent", events: [definition([generalSection]), grant, members], allowed: []},
  {
    name: "subtyped Widget kind is distinct",
    events: [
      definition([generalSection, {...widgets, kinds: [{kind: 30033, subtype: "other"}]}]),
      grant,
      members,
    ],
    allowed: [],
  },
  {
    name: "list from wrong author",
    events: [def, sign(30000, grant.tags, keys[4]), members],
    allowed: [owner, moderator],
  },
]

describe("Widget publisher policy oracle", () => {
  it("exports the same decisions as the host's current Widget permission gate", () => {
    const scenarios = cases.map(test => {
      const definition = parseCommunityDefinition(test.events[0])!
      expect(definition, test.name).toBeTruthy()
      const reportState = getEffectiveCommunityReportState({
        community: definition.pointer,
        definition,
        profileListEvents: test.events,
        reportEvents: test.events.filter(e => e.kind === 1984),
        deleteEvents: test.events.filter(e => e.kind === 5),
      })
      const allowed = people.filter(userPubkey =>
        canWriteCommunityTarget({
          definition,
          userPubkey,
          profileListEvents: test.events,
          reportState,
          target: COMMUNITY_WRITE_TARGETS.widget,
        }),
      )
      expect(allowed.sort(), test.name).toEqual(test.allowed.slice().sort())
      return {
        name: test.name,
        eventIds: test.events.map(event => event.id),
        allowedPubkeys: allowed,
      }
    })
    const events = Object.fromEntries(cases.flatMap(test => test.events).map(e => [e.id, e]))
    if (process.env.WIDGET_POLICY_VECTORS_OUT)
      writeFileSync(
        process.env.WIDGET_POLICY_VECTORS_OUT,
        JSON.stringify({branch, people, events, scenarios}, null, 2) + "\n",
      )
  })
})
