import {execFile} from "node:child_process"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {describe, expect, it} from "vitest"
import {
  DEFAULT_SEED,
  buildCommunityGraph,
  makeProgressLogger,
  normalizePubkey,
  parseCli,
  parseCommunityDefinition,
  parseCommunityInput,
  rankCandidates,
  renderRecommendationTable,
  selectLatestEvents,
} from "../scripts/discover-relay-defaults.mjs"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const script = path.join(projectRoot, "scripts/discover-relay-defaults.mjs")

const pubkey = (character: string) => character.repeat(64)
const event = ({
  kind,
  author,
  id,
  createdAt = 1,
  tags = [],
  content = "",
}: {
  kind: number
  author: string
  id: string
  createdAt?: number
  tags?: string[][]
  content?: string
}) => ({kind, pubkey: author, id, created_at: createdAt, tags, content, sig: "0".repeat(128)})

describe("relay default discovery CLI", () => {
  it("defaults to Five and all role groups", () => {
    const options = parseCli([])

    expect(options.seeds).toEqual([normalizePubkey(DEFAULT_SEED)])
    expect(options.roles).toEqual(["indexer", "search", "git", "widget", "signer", "blossom"])
    expect(options.outputDir).toBe(path.join(projectRoot, "relay-discovery-output"))
  })

  it("accepts multiple positional and flag seeds without adding social hops", () => {
    const first = pubkey("a")
    const second = pubkey("b")
    const options = parseCli([first, "--seed", second, "--role", "indexer,search"])

    expect(options.seeds).toEqual([first, second])
    expect(options.roles).toEqual(["indexer", "search"])
  })

  it("ignores pnpm's forwarded argument separator", () => {
    const options = parseCli(["--", "--role", "indexer"])

    expect(options.seeds).toEqual([normalizePubkey(DEFAULT_SEED)])
    expect(options.roles).toEqual(["indexer"])
  })

  it("rejects invalid seeds", () => {
    expect(() => parseCli(["not-an-npub"])).toThrow(/Every seed/)
  })

  it("prints help without touching the network", async () => {
    const {stdout, stderr} = await execFileAsync("node", [script, "--help"], {cwd: projectRoot})

    expect(stdout).toContain("discover:relay-defaults")
    expect(stdout).toContain(DEFAULT_SEED)
    expect(stderr).toBe("")
  })
})

describe("community and event parsing", () => {
  it("parses VITE_DEFAULT_COMMUNITY relay hints", () => {
    const community = pubkey("c")
    const parsed = parseCommunityInput(
      `ncommunity://${community}?relay=${encodeURIComponent("wss://one.example")}&relay=${encodeURIComponent("wss://two.example/")}`,
    )

    expect(parsed).toEqual({
      input: expect.stringContaining("ncommunity://"),
      pubkey: community,
      relays: ["wss://one.example/", "wss://two.example/"],
      source: "ncommunity",
    })
  })

  it("uses newest replaceable events and the smaller id on ties", () => {
    const author = pubkey("a")
    const older = event({kind: 10002, author, id: "f".repeat(64), createdAt: 1})
    const tieLarger = event({kind: 10002, author, id: "e".repeat(64), createdAt: 2})
    const preferred = event({kind: 10002, author, id: "d".repeat(64), createdAt: 2})

    expect(selectLatestEvents([older, tieLarger, preferred])).toEqual([preferred])
  })

  it("parses community relay and infrastructure tags", () => {
    const community = pubkey("c")
    const moderator = pubkey("d")
    const definition = parseCommunityDefinition(
      event({
        kind: 10222,
        author: community,
        id: "1".repeat(64),
        tags: [
          ["r", "wss://community.example"],
          ["blossom", "https://blossom.example/"],
          ["grasp", "wss://grasp.example"],
          ["content", "Code-curator"],
          ["a", `30000:${moderator}:Code-curator`, "wss://lists.example"],
        ],
      }),
    )

    expect(definition).toMatchObject({
      pubkey: community,
      relays: ["wss://community.example/"],
      blossomServers: ["https://blossom.example"],
      graspServers: ["wss://grasp.example/"],
    })
    expect(definition?.sections[0].profileLists[0]).toMatchObject({
      pubkey: moderator,
      address: `30000:${moderator}:Code-curator`,
      relay: "wss://lists.example/",
    })
  })
})

describe("community-first graph", () => {
  it("expands community roles and direct follows but never follows-of-follows", () => {
    const seed = pubkey("a")
    const directFollow = pubkey("b")
    const secondHop = pubkey("c")
    const community = pubkey("d")
    const moderator = pubkey("e")
    const member = pubkey("f")
    const listAddress = `30000:${moderator}:General`
    const definitionEvent = event({
      kind: 10222,
      author: community,
      id: "1".repeat(64),
      tags: [
        ["content", "General"],
        ["a", listAddress],
      ],
    })
    const definition = parseCommunityDefinition(definitionEvent)!
    const events = [
      event({kind: 3, author: seed, id: "2".repeat(64), tags: [["p", directFollow]]}),
      event({kind: 3, author: directFollow, id: "3".repeat(64), tags: [["p", secondHop]]}),
      event({
        kind: 30000,
        author: moderator,
        id: "4".repeat(64),
        tags: [
          ["d", "General"],
          ["p", seed],
          ["p", member],
        ],
      }),
      definitionEvent,
    ]

    const graph = buildCommunityGraph({seeds: [seed], events, definitions: [definition]})

    expect(graph.authors).toEqual(
      expect.arrayContaining([seed, directFollow, community, moderator, member]),
    )
    expect(graph.authors).not.toContain(secondHop)
    expect(graph.seedStates[0].activeCommunities).toEqual([
      {communityPubkey: community, roles: ["member"]},
    ])
    expect(graph.relationships.get(moderator)?.seeds.get(seed)).toContain("moderator")
    expect(graph.relationships.get(member)?.seeds.get(seed)).toContain("member")
  })

  it("uses the VITE default community as a community root without loading its follows", () => {
    const seed = pubkey("a")
    const community = pubkey("b")
    const moderator = pubkey("c")
    const communityFollow = pubkey("d")
    const definitionEvent = event({
      kind: 10222,
      author: community,
      id: "5".repeat(64),
      tags: [
        ["content", "General"],
        ["a", `30000:${moderator}:General`],
      ],
    })
    const definition = parseCommunityDefinition(definitionEvent)!
    const events = [
      definitionEvent,
      event({kind: 3, author: community, id: "6".repeat(64), tags: [["p", communityFollow]]}),
      event({
        kind: 30000,
        author: moderator,
        id: "7".repeat(64),
        tags: [["d", "General"]],
      }),
    ]

    const graph = buildCommunityGraph({
      seeds: [seed],
      events,
      definitions: [definition],
      defaultCommunityPubkey: community,
    })

    expect(graph.relationships.get(community)?.seeds.get("vite_default_community")).toContain(
      "community",
    )
    expect(graph.relationships.get(moderator)?.seeds.get("vite_default_community")).toContain(
      "moderator",
    )
    expect(graph.authors).not.toContain(communityFollow)
  })
})

describe("ranking and output", () => {
  it("keeps community authority ahead of a larger follow score", () => {
    const community = {
      url: "wss://community.example/",
      eligible: true,
      priority: 5,
      trustScore: 100,
      seeds: [],
      communities: [pubkey("a")],
      probe: {fitnessScore: 50},
    }
    const follows = {
      url: "wss://follows.example/",
      eligible: true,
      priority: 1,
      trustScore: 800,
      seeds: [pubkey("b"), pubkey("c")],
      communities: [],
      probe: {fitnessScore: 100},
    }

    expect(rankCandidates([follows, community])[0].url).toBe(community.url)
  })

  it("renders recommendation and environment tables", () => {
    const candidate = {
      rank: 1,
      role: "indexer",
      url: "wss://relay.example/",
      eligible: true,
      priority: 5,
      trustScore: 100,
      seeds: [pubkey("a")],
      communities: [pubkey("b")],
      authors: [],
      evidence: [{label: "community definition"}],
      probe: {fitnessScore: 90, reachable: true, totalMs: 100, referenceCoverage: 1},
    }
    const markdown = renderRecommendationTable({
      generatedAt: "2026-08-04T00:00:00.000Z",
      inputs: {seeds: [pubkey("a")], roles: ["indexer"]},
      defaultCommunity: null,
      roles: {indexer: {recommended: [candidate], alternates: [], rejected: []}},
      suggestedEnv: {VITE_INDEXER_RELAYS: candidate.url},
      warnings: [],
    })

    expect(markdown).toContain("| 1 | `wss://relay.example/`")
    expect(markdown).toContain("VITE_INDEXER_RELAYS=wss://relay.example/")
  })

  it("streams NDJSON progress through the injected writer", () => {
    let output = ""
    const progress = makeProgressLogger("ndjson", value => {
      output += value
    })

    progress("graph", "built", {authors: 5})

    expect(JSON.parse(output)).toMatchObject({phase: "graph", message: "built", authors: 5})
  })
})
