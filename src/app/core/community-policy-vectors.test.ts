/**
 * Golden policy vectors for relay-side enforcement.
 *
 * Builds fixture communities with the production helpers and records, for a
 * matrix of candidate events, whether the Budabit client would admit each one
 * under the current community state. The strfry write-control plugin
 * (`deploy/budabit/tests/test_vectors.py` in the Pleb5 strfry fork) replays
 * the same authority events and must reach the same decision for every case.
 *
 * Run normally it only checks that the vectors are self-consistent. Set
 * `POLICY_VECTORS_OUT=/path/to/budabit-policy-vectors.json` to write them:
 *
 *   POLICY_VECTORS_OUT=../strfry/deploy/budabit/tests/vectors/budabit-policy-vectors.json \
 *     pnpm exec vitest run src/app/core/community-policy-vectors.test.ts
 *
 * See docs/architecture/Budabit-Community-Architecture.md, "Optional
 * Relay-Side Enforcement".
 */

import {execSync} from "node:child_process"
import {createHash} from "node:crypto"
import {mkdirSync, writeFileSync} from "node:fs"
import {dirname} from "node:path"
import {describe, expect, it} from "vitest"
import {getEventHash, getPublicKey} from "nostr-tools"
import {DELETE, type TrustedEvent} from "@welshman/util"
import {
  COMMUNITY_DEFINITION_KIND,
  COMMUNITY_SECTION_GENERAL,
  COMMUNITY_SECTION_REPO_CURATOR,
  COMMUNITY_SECTION_ROOMS,
  COMMUNITY_SECTION_THREADS,
  COMMUNITY_SUBTYPE_ROOM,
  COMMUNITY_SUBTYPE_ROOM_MESSAGE,
  COMMUNITY_SUBTYPE_THREADS,
  PROFILE_LIST_KIND,
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
  parseTargetedPublication,
  type CommunityDefinition,
} from "./community"
import {
  canWriteCommunityTarget,
  getCommunityWriteTarget,
  getCommunityWriteTargetSections,
} from "./community-permissions"
import {
  COMMUNITY_REPORT_KIND,
  canPublishCommunityContentReport,
  canPublishCommunityEventReport,
  canPublishCommunityPersonReport,
  getEffectiveCommunityReportState,
  makeCommunityEventReport,
  makeCommunityPersonReport,
  makeCommunityReportDelete,
  parseCommunityReport,
} from "./community-reports"

// --- deterministic identities -------------------------------------------------

const secret = (name: string) =>
  new Uint8Array(createHash("sha256").update(`budabit-policy-vectors:${name}`).digest())
const key = (name: string) => getPublicKey(secret(name))
const bytesToHex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex")

const OWNER = key("owner")
const MOD_GENERAL = key("mod-general")
const MOD_CODE = key("mod-code")
const MOD_ALL = key("mod-all")
const MEMBER = key("member")
const MEMBER2 = key("member2")
const OUTSIDER = key("outsider")
const STRANGER = key("stranger")
const COMMUNITY_ID = bytesToHex(secret("community-id"))
const OTHER_COMMUNITY_ID = bytesToHex(secret("other-community-id"))
const RELAY = "wss://relay.example"

const pointer = makeCommunityPointer({ownerPubkey: OWNER, communityId: COMMUNITY_ID})!
const ADDRESS = pointer.address

let clock = 1_700_000_000

const event = (
  kind: number,
  pubkey: string,
  tags: string[][],
  content = "",
  createdAt?: number,
): TrustedEvent => {
  clock += 1
  const created_at = createdAt ?? clock
  const unsigned = {kind, pubkey, created_at, tags, content}
  return {...unsigned, id: getEventHash(unsigned), sig: "0".repeat(128)} as TrustedEvent
}

const shardAddress = (owner: string, purpose: string, shard?: number) =>
  `${PROFILE_LIST_KIND}:${owner}:${COMMUNITY_ID}-${purpose}${shard ? `.${shard}` : ""}`

const authority = (): string[][] => [
  ["h", COMMUNITY_ID],
  ["a", ADDRESS, "", "community"],
]

// --- fixture community -----------------------------------------------------------

// The builder normalises and validates relays; raw r values are substituted
// afterwards so that non-canonical inputs reach the parser unchanged.
const definitionEvent = (overrides: {relays?: string[]} = {}) => {
  const built = buildCommunityDefinition({
      communityId: COMMUNITY_ID,
      name: "Vector Community",
      relays: [RELAY],
      sections: [
        {
          name: COMMUNITY_SECTION_GENERAL,
          kinds: [
            {kind: 9, subtype: COMMUNITY_SUBTYPE_ROOM_MESSAGE},
            {kind: 1111},
            {kind: 7},
            {kind: 1984},
            {kind: 1985},
          ],
          profileLists: [
            {address: shardAddress(OWNER, "general")},
            {address: shardAddress(MOD_GENERAL, "general", 2)},
          ],
          badges: [],
          retention: [],
        },
        {
          name: COMMUNITY_SECTION_ROOMS,
          kinds: [{kind: 11, subtype: COMMUNITY_SUBTYPE_ROOM}],
          profileLists: [{address: shardAddress(OWNER, "room-creator")}],
          badges: [],
          retention: [],
        },
        {
          name: COMMUNITY_SECTION_THREADS,
          kinds: [{kind: 11, subtype: COMMUNITY_SUBTYPE_THREADS}],
          profileLists: [
            {address: shardAddress(OWNER, "thread-creator")},
            {address: shardAddress(MOD_ALL, "thread-creator", 2)},
          ],
          badges: [],
          retention: [],
        },
        {
          name: COMMUNITY_SECTION_REPO_CURATOR,
          kinds: [{kind: 30617}, {kind: 1623}],
          profileLists: [
            {address: shardAddress(MOD_CODE, "code-curator")},
            {address: shardAddress(MOD_ALL, "code-curator", 2)},
          ],
          badges: [],
          retention: [],
        },
        {
          name: "Calendar-event-creator",
          kinds: [{kind: 31922}, {kind: 31923}],
          profileLists: [],
          badges: [],
          retention: [],
        },
      ],
    })
  const relays = overrides.relays ?? [RELAY]
  const tags = built.tags.filter(tag => tag[0] !== "r")
  const insertAt = tags.findIndex(tag => tag[0] === "name") + 1
  tags.splice(insertAt, 0, ...relays.map(relay => ["r", relay]))
  return event(COMMUNITY_DEFINITION_KIND, OWNER, tags)
}

const shard = (
  owner: string,
  purpose: string,
  pubkeys: string[],
  {shard: shardNo, declined = false}: {shard?: number; declined?: boolean} = {},
) =>
  event(PROFILE_LIST_KIND, owner, [
    ["d", `${COMMUNITY_ID}-${purpose}${shardNo ? `.${shardNo}` : ""}`],
    ...pubkeys.map(pubkey => ["p", pubkey]),
    ...(declined ? [["status", "declined"]] : []),
  ])

const personReport = (reporter: string, target: string) =>
  event(COMMUNITY_REPORT_KIND, reporter, makeCommunityPersonReport({community: pointer, pubkey: target}).tags)

const eventReport = (reporter: string, targetPubkey: string, targetId: string, sectionName: string) =>
  event(
    COMMUNITY_REPORT_KIND,
    reporter,
    makeCommunityEventReport({
      community: pointer,
      eventId: targetId,
      eventPubkey: targetPubkey,
      sectionName,
    }).tags,
  )

// --- client-side oracle -----------------------------------------------------------

type Oracle = {
  definition: CommunityDefinition
  profileListEvents: TrustedEvent[]
  reportEvents: TrustedEvent[]
  deleteEvents: TrustedEvent[]
}

const deriveSubtype = (candidate: TrustedEvent) => {
  if (candidate.kind === 11) {
    return candidate.tags.some(tag => tag[0] === "room") ? COMMUNITY_SUBTYPE_ROOM : COMMUNITY_SUBTYPE_THREADS
  }
  if (candidate.kind === 9) return COMMUNITY_SUBTYPE_ROOM_MESSAGE
  return undefined
}

/** What the Budabit client decides for a community-scoped candidate. */
const clientAdmits = (oracle: Oracle, candidate: TrustedEvent): boolean => {
  const reportState = getEffectiveCommunityReportState({
    community: pointer,
    definition: oracle.definition,
    profileListEvents: oracle.profileListEvents,
    reportEvents: oracle.reportEvents,
    deleteEvents: oracle.deleteEvents,
  })
  const common = {
    definition: oracle.definition,
    profileListEvents: oracle.profileListEvents,
    reportState,
  }

  if (candidate.kind === COMMUNITY_REPORT_KIND) {
    const report = parseCommunityReport(candidate, pointer)
    if (!report) return false
    if (report.target === "person") {
      return canPublishCommunityPersonReport({
        ...common,
        reporterPubkey: candidate.pubkey,
        targetPubkey: report.targetPubkey,
      })
    }
    return (
      canPublishCommunityEventReport({
        ...common,
        reporterPubkey: candidate.pubkey,
        targetPubkey: report.targetPubkey,
        sectionName: report.sectionName || "",
      }) ||
      canPublishCommunityContentReport({
        ...common,
        reporterPubkey: candidate.pubkey,
        targetPubkey: report.targetPubkey,
      })
    )
  }

  if (candidate.kind === 30222) {
    const wrapper = parseTargetedPublication(candidate)
    if (!wrapper) return false
    if (!wrapper.communities.some(community => community.address === ADDRESS)) return false
    const target = getCommunityWriteTarget(wrapper.kind)
    if (!target) return false
    return canWriteCommunityTarget({...common, userPubkey: candidate.pubkey, target})
  }

  const target = getCommunityWriteTarget(candidate.kind, deriveSubtype(candidate))
  if (!target) return false
  if (getCommunityWriteTargetSections(oracle.definition, target).length === 0) return false
  return canWriteCommunityTarget({...common, userPubkey: candidate.pubkey, target})
}

// --- vector construction -------------------------------------------------------

type Case = {name: string; event: TrustedEvent; expect: "accept" | "reject"; note?: string}
type Scenario = {
  name: string
  authority: TrustedEvent[]
  cases: Case[]
}

const thread = (pubkey: string, content = "thread") => event(11, pubkey, [["h", COMMUNITY_ID]], content)
const roomRoot = (pubkey: string) => event(11, pubkey, [["h", COMMUNITY_ID], ["room", ""]], "room")
const roomMessage = (pubkey: string) => event(9, pubkey, [["h", COMMUNITY_ID], ["e", "ab".repeat(32)]], "hi")
const comment = (pubkey: string) => event(1111, pubkey, [["h", COMMUNITY_ID], ["e", "cd".repeat(32)]], "c")
const repo = (pubkey: string) => event(30617, pubkey, [["h", COMMUNITY_ID], ["d", "repo"]])
const wrapper = (pubkey: string, kind: number) =>
  event(30222, pubkey, [["d", "targeting"], ["k", String(kind)], ["h", COMMUNITY_ID], ["a", ADDRESS, RELAY]])

const contentMatrix = (pubkeys: Record<string, string>): TrustedEvent[] =>
  Object.entries(pubkeys).flatMap(([label, pubkey]) => [
    Object.assign(thread(pubkey), {__label: `${label} thread`}),
    Object.assign(roomRoot(pubkey), {__label: `${label} room root`}),
    Object.assign(roomMessage(pubkey), {__label: `${label} room message`}),
    Object.assign(comment(pubkey), {__label: `${label} comment`}),
    Object.assign(repo(pubkey), {__label: `${label} repo announcement`}),
    Object.assign(wrapper(pubkey, 31922), {__label: `${label} calendar wrapper`}),
    Object.assign(wrapper(pubkey, 9041), {__label: `${label} goal wrapper (kind not enabled)`}),
    Object.assign(event(1, pubkey, [["h", COMMUNITY_ID]], "note"), {__label: `${label} kind 1 (not enabled)`}),
  ])

const PEOPLE = {owner: OWNER, modGeneral: MOD_GENERAL, modCode: MOD_CODE, modAll: MOD_ALL, member: MEMBER, member2: MEMBER2, outsider: OUTSIDER}

const buildScenario = (name: string, authority: TrustedEvent[], candidates: TrustedEvent[]): Scenario => {
  const definitionEvents = authority.filter(item => item.kind === COMMUNITY_DEFINITION_KIND)
  const definition = definitionEvents.length
    ? parseCommunityDefinition(definitionEvents[definitionEvents.length - 1])
    : undefined
  if (!definition) throw new Error(`scenario ${name} has no valid definition`)
  const oracle: Oracle = {
    definition,
    profileListEvents: authority.filter(item => item.kind === PROFILE_LIST_KIND || item.kind === DELETE),
    reportEvents: authority.filter(item => item.kind === COMMUNITY_REPORT_KIND),
    deleteEvents: authority.filter(item => item.kind === DELETE),
  }
  return {
    name,
    authority,
    cases: candidates.map(candidate => {
      const label = (candidate as TrustedEvent & {__label?: string}).__label || `${candidate.kind} by ${candidate.pubkey.slice(0, 8)}`
      const {__label: _ignored, ...clean} = candidate as TrustedEvent & {__label?: string}
      return {name: label, event: clean as TrustedEvent, expect: clientAdmits(oracle, clean as TrustedEvent) ? "accept" : "reject"}
    }),
  }
}

const baseAuthority = () => [
  definitionEvent(),
  shard(OWNER, "general", [MEMBER]),
  shard(MOD_GENERAL, "general", [MEMBER2], {shard: 2}),
  shard(OWNER, "room-creator", [MEMBER]),
  shard(OWNER, "thread-creator", [MEMBER]),
  shard(MOD_ALL, "thread-creator", [], {shard: 2}),
  shard(MOD_CODE, "code-curator", []),
  shard(MOD_ALL, "code-curator", [], {shard: 2}),
]

const buildScenarios = (): Scenario[] => {
  const scenarios: Scenario[] = []

  scenarios.push(buildScenario("baseline grants", baseAuthority(), contentMatrix(PEOPLE)))

  scenarios.push(
    buildScenario(
      "declined invitation keeps structural write, removes moderator authority",
      [...baseAuthority(), shard(MOD_CODE, "code-curator", [], {declined: true})],
      [
        ...contentMatrix({modCode: MOD_CODE}),
        Object.assign(eventReport(MOD_CODE, OUTSIDER, "ef".repeat(32), COMMUNITY_SECTION_REPO_CURATOR), {
          __label: "declined moderator event report in own section (falls back to content report via General)",
        }),
        Object.assign(personReport(MOD_CODE, OUTSIDER), {__label: "declined moderator person report"}),
      ],
    ),
  )

  scenarios.push(
    buildScenario(
      "revocation by shard replacement",
      [...baseAuthority(), shard(OWNER, "thread-creator", [])],
      contentMatrix({member: MEMBER, member2: MEMBER2}),
    ),
  )

  scenarios.push(
    buildScenario(
      "shard union across two lists",
      [...baseAuthority(), shard(MOD_GENERAL, "general", [MEMBER2, OUTSIDER], {shard: 2})],
      contentMatrix({outsider: OUTSIDER, member2: MEMBER2}),
    ),
  )

  scenarios.push(
    buildScenario(
      "owner tombstones a shard by address",
      [
        ...baseAuthority(),
        event(DELETE, OWNER, [["a", shardAddress(OWNER, "thread-creator")]], "", clock + 100),
      ],
      contentMatrix({member: MEMBER}),
    ),
  )

  {
    const authority = [...baseAuthority(), personReport(OWNER, MEMBER)]
    scenarios.push(
      buildScenario("owner person-bans a member", authority, [
        ...contentMatrix({member: MEMBER, member2: MEMBER2}),
        Object.assign(personReport(MEMBER, OUTSIDER), {__label: "banned member person report"}),
        Object.assign(eventReport(MEMBER, OUTSIDER, "ef".repeat(32), COMMUNITY_SECTION_GENERAL), {__label: "banned member content report"}),
      ]),
    )
  }

  {
    const report = personReport(OWNER, MEMBER)
    const authority = [...baseAuthority(), report, event(DELETE, OWNER, makeCommunityReportDelete({community: pointer, reportId: report.id, reporterPubkey: OWNER}).tags)]
    scenarios.push(buildScenario("owner retracts a person ban", authority, contentMatrix({member: MEMBER})))
  }

  scenarios.push(
    buildScenario(
      "report authority matrix",
      baseAuthority(),
      [
        ...Object.entries(PEOPLE).flatMap(([label, pubkey]) => [
          Object.assign(personReport(pubkey, STRANGER), {__label: `${label} person report on stranger`}),
          Object.assign(personReport(pubkey, MOD_GENERAL), {__label: `${label} person report on a moderator`}),
          Object.assign(personReport(pubkey, OWNER), {__label: `${label} person report on the owner`}),
          Object.assign(eventReport(pubkey, STRANGER, "ef".repeat(32), COMMUNITY_SECTION_GENERAL), {__label: `${label} event report in General`}),
          Object.assign(eventReport(pubkey, STRANGER, "ef".repeat(32), COMMUNITY_SECTION_REPO_CURATOR), {__label: `${label} event report in Code-curator`}),
          Object.assign(eventReport(pubkey, MOD_CODE, "ef".repeat(32), COMMUNITY_SECTION_GENERAL), {__label: `${label} event report targeting a moderator`}),
          Object.assign(eventReport(pubkey, STRANGER, "ef".repeat(32), "Nope"), {__label: `${label} event report in unknown section`}),
        ]),
        Object.assign(personReport(OWNER, OWNER), {__label: "owner self report"}),
      ],
    ),
  )

  {
    // MOD_ALL owns an active list in every section that has lists? No: General
    // and Room-creator lack a MOD_ALL list, so MOD_ALL is *not* an
    // all-sections moderator in the baseline. This scenario gives them one.
    const authority = [
      event(
        COMMUNITY_DEFINITION_KIND,
        OWNER,
        buildCommunityDefinition({
          communityId: COMMUNITY_ID,
          name: "Vector Community",
          relays: [RELAY],
          sections: [
            {
              name: COMMUNITY_SECTION_GENERAL,
              kinds: [{kind: 1111}, {kind: 1984}, {kind: 7}],
              profileLists: [{address: shardAddress(MOD_ALL, "general")}],
              badges: [],
              retention: [],
            },
            {
              name: COMMUNITY_SECTION_THREADS,
              kinds: [{kind: 11, subtype: COMMUNITY_SUBTYPE_THREADS}],
              profileLists: [{address: shardAddress(MOD_ALL, "thread-creator")}, {address: shardAddress(MOD_GENERAL, "thread-creator", 2)}],
              badges: [],
              retention: [],
            },
          ],
        }).tags,
      ),
      shard(MOD_ALL, "general", [MEMBER]),
      shard(MOD_ALL, "thread-creator", [MEMBER]),
      shard(MOD_GENERAL, "thread-creator", [], {shard: 2}),
      personReport(MOD_ALL, OUTSIDER),
      personReport(MOD_ALL, MOD_GENERAL),
      personReport(MOD_GENERAL, OUTSIDER),
    ]
    scenarios.push(
      buildScenario("all-sections moderator bans; moderators are protected", authority, [
        ...contentMatrix({outsider: OUTSIDER, modGeneral: MOD_GENERAL, member: MEMBER}),
        Object.assign(personReport(MOD_ALL, STRANGER), {__label: "all-sections moderator person report"}),
        Object.assign(personReport(MOD_GENERAL, STRANGER), {__label: "single-section moderator person report"}),
        Object.assign(personReport(MOD_ALL, MOD_GENERAL), {__label: "all-sections moderator person report on a moderator (protected)"}),
        Object.assign(personReport(MOD_ALL, OWNER), {__label: "all-sections moderator person report on the owner (protected)"}),
        Object.assign(personReport(OWNER, MOD_GENERAL), {__label: "owner person report on a moderator"}),
      ]),
    )

    scenarios.push(
      buildScenario(
        "owner bans the banning moderator: their bans stop counting",
        [...authority, personReport(OWNER, MOD_ALL)],
        contentMatrix({outsider: OUTSIDER, modAll: MOD_ALL, member: MEMBER}),
      ),
    )
  }

  return scenarios
}

// --- definition validity vectors ---------------------------------------------------

type DefinitionCase = {name: string; event: TrustedEvent; valid: boolean}

const buildDefinitionCases = (): DefinitionCase[] => {
  const base = definitionEvent()
  const withTags = (mutate: (tags: string[][]) => string[][], extra: Partial<TrustedEvent> = {}) =>
    event(COMMUNITY_DEFINITION_KIND, OWNER, mutate(base.tags.map(tag => [...tag])), extra.content ?? "")
  const cases: Array<[string, TrustedEvent]> = [
    ["valid baseline", base],
    ["unknown top-level tag preserved", withTags(tags => [...tags.slice(0, 3), ["enforced-relay", RELAY], ...tags.slice(3)])],
    ["unknown section-local tag", withTags(tags => [...tags, ["custom", "x"]])],
    ["duplicate d", withTags(tags => [...tags, ["d", COMMUNITY_ID]])],
    ["h tag present", withTags(tags => [...tags, ["h", COMMUNITY_ID]])],
    ["no r tags", withTags(tags => tags.filter(tag => tag[0] !== "r"))],
    ["r with legacy enforced marker", withTags(tags => tags.map(tag => (tag[0] === "r" ? [...tag, "enforced"] : tag)))],
    ["non-canonical r (uppercase host)", definitionEvent({relays: ["wss://Relay.Example"]})],
    ["non-canonical r (dot segment)", definitionEvent({relays: ["wss://relay.example/a/./b"]})],
    ["non-canonical r (space)", definitionEvent({relays: ["wss://relay.example/a b"]})],
    ["non-canonical r (uncompressed IPv6)", definitionEvent({relays: ["wss://[2001:0db8:0000:0000:0000:0000:0000:0001]"]})],
    ["canonical r (compressed IPv6)", definitionEvent({relays: ["wss://[2001:db8::1]"]})],
    ["canonical r with path", definitionEvent({relays: ["wss://relay.example/path"]})],
    ["ws scheme", definitionEvent({relays: ["ws://relay.example"]})],
    ["section k before first content", withTags(tags => [["k", "1"], ...tags])],
    ["duplicate kind across sections", withTags(tags => [...tags, ["k", "1111"]])],
    ["duplicate section name (case-folded)", withTags(tags => [...tags, ["content", "general"], ["k", "40000"]])],
    ["section without k", withTags(tags => [...tags, ["content", "Empty"]])],
    ["shard identifier without community prefix", withTags(tags => [...tags, ["content", "X"], ["k", "40001"], ["a", `30000:${OWNER}:general`]])],
    ["non-empty content", withTags(tags => tags, {content: "x"})],
    ["name too long", withTags(tags => tags.map(tag => (tag[0] === "name" ? ["name", "n".repeat(101)] : tag)))],
    ["too many r tags", withTags(tags => [...tags, ...Array.from({length: 20}, (_, i) => ["r", `wss://r${i}.example`])])],
  ]
  return cases.map(([name, candidate]) => ({name, event: candidate, valid: Boolean(parseCommunityDefinition(candidate))}))
}

// --- test / export -------------------------------------------------------------

const gitCommit = () => {
  try {
    return execSync("git rev-parse HEAD", {encoding: "utf-8"}).trim()
  } catch {
    return "unknown"
  }
}

describe("community policy vectors", () => {
  const scenarios = buildScenarios()
  const definitions = buildDefinitionCases()

  it("builds a non-trivial matrix with both outcomes", () => {
    const outcomes = scenarios.flatMap(scenario => scenario.cases.map(item => item.expect))
    expect(outcomes.filter(item => item === "accept").length).toBeGreaterThan(20)
    expect(outcomes.filter(item => item === "reject").length).toBeGreaterThan(20)
    expect(definitions.filter(item => item.valid).length).toBeGreaterThan(3)
    expect(definitions.filter(item => !item.valid).length).toBeGreaterThan(10)
  })

  it("pins a few decisions the relay must reproduce", () => {
    const baseline = scenarios[0]
    const find = (label: string) => baseline.cases.find(item => item.name === label)!.expect
    expect(find("owner thread")).toBe("accept")
    expect(find("member thread")).toBe("accept")
    expect(find("outsider thread")).toBe("reject")
    expect(find("member2 thread")).toBe("reject")
    expect(find("modCode thread")).toBe("accept") // structural member
    expect(find("member calendar wrapper")).toBe("reject") // section without lists: owner and structural members only
    expect(find("modCode calendar wrapper")).toBe("accept")
    expect(find("owner goal wrapper (kind not enabled)")).toBe("reject")
    const bans = scenarios.find(item => item.name === "owner person-bans a member")!
    expect(bans.cases.find(item => item.name === "member thread")!.expect).toBe("reject")
    expect(bans.cases.find(item => item.name === "member2 thread")!.expect).toBe("reject")
  })

  it("writes vectors when POLICY_VECTORS_OUT is set", () => {
    const out = process.env.POLICY_VECTORS_OUT
    if (!out) return
    const payload = {
      format: 1,
      budabitCommit: gitCommit(),
      generatedAt: new Date().toISOString(),
      branches: [ADDRESS],
      communityId: COMMUNITY_ID,
      otherCommunityId: OTHER_COMMUNITY_ID,
      people: {...PEOPLE, stranger: STRANGER},
      scenarios,
      definitions,
    }
    mkdirSync(dirname(out), {recursive: true})
    writeFileSync(out, JSON.stringify(payload, null, 1) + "\n")
  })
})
