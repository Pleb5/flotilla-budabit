// @vitest-environment jsdom

import {beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"

const {
  gotoMock,
  loadMock,
  repositoryGetEvent,
  repositoryQuery,
  requestMock,
  waitAndScrollToEventMock,
} = vi.hoisted(() => ({
  gotoMock: vi.fn(() => Promise.resolve()),
  loadMock: vi.fn(() => Promise.resolve([])),
  repositoryGetEvent: vi.fn(),
  repositoryQuery: vi.fn(() => []),
  requestMock: vi.fn(() => Promise.resolve(undefined)),
  waitAndScrollToEventMock: vi.fn(() => Promise.resolve(true)),
}))

vi.mock("$app/navigation", () => ({goto: gotoMock}))
vi.mock("@lib/html", () => ({
  waitAndScrollToEvent: waitAndScrollToEventMock,
}))
vi.mock("@app/core/state", () => ({
  makeChatId: (recipient: string) => recipient,
  DM_KIND: 4,
}))
vi.mock("@app/core/community-feeds", () => ({
  GIT_PERMALINK_KIND: 1623,
  SMART_WIDGET_KIND: 30033,
}))
vi.mock("@welshman/net", () => ({load: loadMock, request: requestMock}))
vi.mock("@welshman/router", () => ({
  Router: {
    get: () => ({
      FromPubkey: () => ({getUrls: () => []}),
      FromUser: () => ({getUrls: () => []}),
    }),
  },
}))
vi.mock("@welshman/app", () => ({
  pubkey: {get: vi.fn()},
  repository: {getEvent: repositoryGetEvent, query: repositoryQuery},
  tracker: {getRelays: vi.fn(() => [])},
}))
vi.mock("@welshman/lib", () => ({
  identity: (value: unknown) => Boolean(value),
  sleep: vi.fn(),
}))
vi.mock("@welshman/util", () => ({
  COMMENT: 1111,
  EVENT_DATE: 31922,
  EVENT_TIME: 31923,
  MESSAGE: 9,
  THREAD: 11,
  ZAP_GOAL: 9041,
  getPubkeyTagValues: vi.fn(() => []),
  getTagValue: (name: string, tags: string[][]) => tags.find(tag => tag[0] === name)?.[1] || "",
  normalizeRelayUrl: (url: string) => (url.endsWith("/") ? url : `${url}/`),
  isRelayUrl: (url: string) => url.startsWith("wss://"),
  isReplaceable: (event: {kind: number}) => event.kind >= 10000 && event.kind < 40000,
  Address: class {
    kind: number
    pubkey: string
    identifier: string
    relays: string[]

    constructor(kind: number, pubkey: string, identifier: string, relays: string[] = []) {
      this.kind = kind
      this.pubkey = pubkey
      this.identifier = identifier
      this.relays = relays
    }

    static fromEvent(event: {kind: number; pubkey: string; tags: string[][]}) {
      return new this(event.kind, event.pubkey, event.tags.find(tag => tag[0] === "d")?.[1] || "")
    }

    toString() {
      return `${this.kind}:${this.pubkey}:${this.identifier}`
    }

    toNaddr() {
      return `naddr:${this.kind}:${this.pubkey}:${this.identifier}`
    }
  },
}))

const makeEvent = (overrides: Record<string, unknown> = {}) => ({
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  created_at: 1,
  kind: 1,
  tags: [],
  content: "",
  sig: "3".repeat(128),
  ...overrides,
})

const EVENT_TIME = 31923

describe("routes", () => {
  beforeEach(() => {
    gotoMock.mockReset()
    gotoMock.mockResolvedValue(undefined)
    loadMock.mockReset()
    loadMock.mockResolvedValue([])
    repositoryGetEvent.mockReset()
    repositoryQuery.mockReset()
    repositoryQuery.mockReturnValue([])
    requestMock.mockReset()
    requestMock.mockResolvedValue(undefined)
    waitAndScrollToEventMock.mockReset()
    waitAndScrollToEventMock.mockResolvedValue(true)
    window.history.replaceState(null, "", "/")
  })

  it("does not expose ambiguous community route APIs", async () => {
    const routes = await import("./routes")

    for (const name of [
      "parseCommunityRouteParam",
      "encodeCommunityRouteParam",
      "makeCommunityPath",
      "makeCommunityRoomPath",
      "makeCommunityThreadPath",
      "makeCommunityCalendarPath",
      "makeCommunityGoalPath",
      "makeCommunityGitPath",
      "makeCommunityPermalinkPath",
      "makeCommunityWidgetPath",
      "getCommunityReportTargetPath",
    ]) {
      expect(routes).not.toHaveProperty(name)
    }
  })

  it("builds explicit one-shot git entry paths", async () => {
    const {makeExactGitCommunityEntryPath, makePersonalGitEntryPath} = await import("./routes")
    const community = {
      naddr: "naddr1community",
      address: `32222:${"1".repeat(64)}:community`,
      ownerPubkey: "1".repeat(64),
      communityId: "community",
      relayHints: [],
    } as unknown as Parameters<typeof makeExactGitCommunityEntryPath>[0]

    expect(makePersonalGitEntryPath()).toBe("/git?entry=personal")
    expect(makeExactGitCommunityEntryPath(community)).toBe(
      "/git?entry=community&community=naddr1community",
    )
  })

  it("builds exact community paths only from kind-32222 definition pointers", async () => {
    const {
      makeExactCommunityCalendarPath,
      makeExactCommunityPath,
      makeExactCommunityRoomPath,
      parseExactCommunityRouteParam,
    } = await import("./routes")
    const owner = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    const communityId = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    const naddr = nip19.naddrEncode({
      kind: 32222,
      pubkey: owner,
      identifier: communityId,
      relays: ["wss://relay.example"],
    })
    const pointer = parseExactCommunityRouteParam(naddr)!

    expect(pointer.address).toBe(`32222:${owner}:${communityId}`)
    expect(makeExactCommunityPath(pointer)).toBe(`/c/${naddr}`)
    expect(makeExactCommunityRoomPath(pointer, "room/id")).toBe(`/c/${naddr}/rooms/room%2Fid`)
    expect(makeExactCommunityCalendarPath(pointer, "event-id")).toBe(
      `/c/${naddr}/calendar/event-id`,
    )
    expect(parseExactCommunityRouteParam(nip19.npubEncode(owner))).toBeUndefined()
    expect(parseExactCommunityRouteParam(owner)).toBeUndefined()
    expect(parseExactCommunityRouteParam(`ncommunity://${communityId}`)).toBeUndefined()
    expect(
      parseExactCommunityRouteParam(
        nip19.naddrEncode({kind: 30023, pubkey: owner, identifier: communityId}),
      ),
    ).toBeUndefined()
  })

  it("compares hint variants by exact coordinate and preserves URL suffix, query, and hash", async () => {
    const {
      getExactCommunityRouteContext,
      makeCanonicalExactCommunityUrl,
      parseExactCommunityRouteParam,
    } = await import("./routes")
    const owner = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    const communityId = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    const withoutHints = nip19.naddrEncode({
      kind: 32222,
      pubkey: owner,
      identifier: communityId,
    })
    const withHints = nip19.naddrEncode({
      kind: 32222,
      pubkey: owner,
      identifier: communityId,
      relays: ["wss://relay.example"],
    })
    const pointer = parseExactCommunityRouteParam(withHints)!
    const current = new URL(
      `https://budabit.test/c/${withoutHints}/rooms/general?view=compact#event-id`,
    )

    expect(getExactCommunityRouteContext(current)).toBe(
      `community:${pointer.address}:rooms:general:?view=compact`,
    )
    expect(makeCanonicalExactCommunityUrl(current, pointer)).toBe(
      `/c/${withHints}/rooms/general?view=compact#event-id`,
    )
  })

  it("requires exact selected context to route h-only community events", async () => {
    const {getExactCommunityEventPath, parseExactCommunityRouteParam} = await import("./routes")
    const owner = "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f"
    const communityId = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"
    const otherCommunityId = "531fe6068134503d2723133227c867ac8fa6c83c537e9a44c3c5bdbdcb1fe337"
    const pointer = parseExactCommunityRouteParam(
      nip19.naddrEncode({kind: 32222, pubkey: owner, identifier: communityId}),
    )!
    const event = makeEvent({id: "thread-root", kind: 11, tags: [["h", communityId]]})

    expect(getExactCommunityEventPath(event as any)).toBeUndefined()
    expect(
      getExactCommunityEventPath(event as any, {...pointer, communityId: otherCommunityId as any}),
    ).toBeUndefined()
    expect(getExactCommunityEventPath(event as any, pointer)).toBe(
      `/c/${pointer.naddr}/threads/thread-root`,
    )
  })

  it("does not choose the first target from an ambiguous multi-community wrapper", async () => {
    const {buildTargetedPublication, makeCommunityPointer} = await import("@app/core/community")
    const {getExactCommunityEventPath} = await import("./routes")
    const first = makeCommunityPointer({
      ownerPubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    })!
    const second = makeCommunityPointer({
      ownerPubkey: "552c630b64b54bf50210c9e253d38bd4949c72e22873500f6285c2bede312a84",
      communityId: "2f1b310f4c065331bc0d79ba4661bb9822d67d7c4a1b0a1892e1fd0cd23aa68d",
    })!
    const template = buildTargetedPublication({
      id: "goal-id",
      kind: 9041,
      communities: [first, second],
    })
    const wrapper = makeEvent({kind: 30222, tags: template.tags})

    expect(getExactCommunityEventPath(wrapper as any)).toBeUndefined()
    expect(getExactCommunityEventPath(wrapper as any, second)).toBe(`/c/${second.naddr}/goals`)
  })

  it("builds npub profile paths when no relay hints are provided", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "a".repeat(64)
    const profileNpub = nip19.npubEncode(profilePubkey)

    expect(makeProfilePath(profilePubkey)).toBe(`/people/${profileNpub}`)
    expect(nip19.decode(profileNpub)).toEqual({type: "npub", data: profilePubkey})
  })

  it("builds nprofile profile paths when relay hints are provided", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "b".repeat(64)
    const path = makeProfilePath(profilePubkey, [
      "wss://profile-relay.example.com",
      "",
      "wss://backup-relay.example.com",
    ])
    const encodedProfile = decodeURIComponent(path.replace(/^\/people\//, ""))
    const decoded = nip19.decode(encodedProfile)

    expect(path.startsWith("/people/nprofile1")).toBe(true)
    expect(decoded.type).toBe("nprofile")
    expect(decoded.data).toMatchObject({
      pubkey: profilePubkey,
      relays: ["wss://profile-relay.example.com", "wss://backup-relay.example.com"],
    })
  })

  it("builds git parent paths without using browser history", async () => {
    const {getGitParentPath} = await import("./routes")
    const repoPath = "/git/naddr1repo"

    expect(getGitParentPath(`${repoPath}/issues/issue-id`)).toBe(`${repoPath}/issues`)
    expect(getGitParentPath(`${repoPath}/prs/pr-id`)).toBe(`${repoPath}/prs`)
    expect(getGitParentPath(`${repoPath}/commits/commit-id`)).toBe(`${repoPath}/commits`)
    expect(getGitParentPath(`${repoPath}/extensions/widget-id`)).toBe(repoPath)
    expect(getGitParentPath(`${repoPath}/issues`)).toBe(repoPath)
    expect(getGitParentPath(repoPath)).toBe("/git")
    expect(getGitParentPath("/git")).toBe("/")
  })

  it("labels git parent targets by destination", async () => {
    const {getGitParentTarget} = await import("./routes")
    const repoPath = "/git/naddr1repo"

    expect(getGitParentTarget(`${repoPath}/issues/issue-id`)).toMatchObject({label: "Issues"})
    expect(getGitParentTarget(`${repoPath}/prs/pr-id`)).toMatchObject({label: "PRs"})
    expect(getGitParentTarget(`${repoPath}/commits/commit-id`)).toMatchObject({
      label: "Commits",
    })
    expect(getGitParentTarget(`${repoPath}/issues`)).toMatchObject({label: "Overview"})
    expect(getGitParentTarget(repoPath)).toMatchObject({label: "Repos"})
  })

  it("steps up code query breadcrumb paths", async () => {
    const {getGitParentPath} = await import("./routes")
    const codePath = "/git/naddr1repo/code"

    expect(getGitParentPath(codePath, "path=src/app/routes.ts")).toBe(`${codePath}?dir=src%2Fapp`)
    expect(getGitParentPath(codePath, "dir=src/app")).toBe(`${codePath}?dir=src`)
    expect(getGitParentPath(codePath, "dir=src")).toBe(codePath)
    expect(getGitParentPath(codePath)).toBe("/git/naddr1repo")
  })

  it("labels code query breadcrumb parent targets", async () => {
    const {getGitParentTarget} = await import("./routes")
    const codePath = "/git/naddr1repo/code"

    expect(getGitParentTarget(codePath, "path=src/app/routes.ts")).toMatchObject({
      label: "src/app",
    })
    expect(getGitParentTarget(codePath, "dir=src/app")).toMatchObject({label: "src"})
    expect(getGitParentTarget(codePath, "dir=src")).toMatchObject({label: "Code"})
    expect(getGitParentTarget(codePath)).toMatchObject({label: "Overview"})
  })

  it("keeps existing npub and nprofile route identifiers unchanged", async () => {
    const {makeProfilePath} = await import("./routes")
    const profilePubkey = "c".repeat(64)
    const profileNpub = nip19.npubEncode(profilePubkey)
    const profileNprofile = nip19.nprofileEncode({
      pubkey: profilePubkey,
      relays: ["wss://profile-relay.example.com"],
    })

    expect(makeProfilePath(profileNpub, ["wss://ignored.example.com"])).toBe(
      `/people/${profileNpub}`,
    )
    expect(makeProfilePath(profileNprofile, ["wss://ignored.example.com"])).toBe(
      `/people/${profileNprofile}`,
    )
  })

  it("does not invent community routes from raw h-tag identifiers", async () => {
    const {getCommunityEventPath, getEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const event = makeEvent({kind: 11, tags: [["h", communityPubkey]]})

    expect(getCommunityEventPath(event as any)).toBeUndefined()
    expect(await getEventPath(event as any, [])).toMatch(/^\/nevent1/)
  })

  it("does not invent an exact branch route from h-only targetable events", async () => {
    const {getCommunityEventPath} = await import("./routes")
    const communityId = "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9"

    expect(
      getCommunityEventPath(makeEvent({kind: EVENT_TIME, tags: [["h", communityId]]}) as any),
    ).toBeUndefined()
    expect(
      getCommunityEventPath(makeEvent({kind: 9041, tags: [["h", communityId]]}) as any),
    ).toBeUndefined()
    expect(
      getCommunityEventPath(makeEvent({kind: 30033, tags: [["h", communityId]]}) as any),
    ).toBeUndefined()
  })

  it("routes targeted original events using cached targeting events", async () => {
    const {buildTargetedPublication, makeCommunityPointer} = await import("@app/core/community")
    const {getCommunityEventPath} = await import("./routes")
    const community = makeCommunityPointer({
      ownerPubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    })!

    repositoryQuery.mockReturnValue([
      makeEvent({
        kind: 30222,
        tags: buildTargetedPublication({
          id: "target-1",
          kind: EVENT_TIME,
          communities: [community],
        }).tags,
      }),
    ] as any)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: EVENT_TIME,
          tags: [
            ["h", "target-1"],
            ["d", "calendar-1"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${community.naddr}/calendar/${"1".repeat(64)}`)
  })

  it("loads targeting events before falling back to the basic event view", async () => {
    const {buildTargetedPublication, makeCommunityPointer} = await import("@app/core/community")
    const {getEventPath} = await import("./routes")
    const community = makeCommunityPointer({
      ownerPubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    })!
    const targeting = makeEvent({
      kind: 30222,
      tags: buildTargetedPublication({
        id: "target-1",
        kind: 9041,
        communities: [community],
      }).tags,
    })

    repositoryQuery
      .mockReturnValueOnce([])
      .mockReturnValueOnce([])
      .mockReturnValueOnce([targeting] as any)

    await expect(
      getEventPath(makeEvent({kind: 9041, tags: [["h", "target-1"]]}) as any, [
        "wss://relay.example.com",
      ]),
    ).resolves.toBe(`/c/${community.naddr}/goals/${"1".repeat(64)}`)
    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({relays: ["wss://relay.example.com/"], autoClose: true}),
    )
  })

  it("routes targeted publication events to their community sections", async () => {
    const {buildTargetedPublication, makeCommunityPointer} = await import("@app/core/community")
    const {getCommunityEventPath} = await import("./routes")
    const community = makeCommunityPointer({
      ownerPubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    })!

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 30222,
          tags: buildTargetedPublication({
            id: "target-1",
            kind: 30033,
            communities: [community],
          }).tags,
        }) as any,
      ),
    ).toBe(`/c/${community.naddr}/widgets`)
  })

  it("routes comments through the exact community in the current URL", async () => {
    const {getCommunityEventPath, makeCommunityPointer} = {
      ...(await import("./routes")),
      ...(await import("@app/core/community")),
    }
    const community = makeCommunityPointer({
      ownerPubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    })!
    window.history.replaceState(null, "", `/c/${community.naddr}/threads/root`)

    expect(
      getCommunityEventPath(
        makeEvent({
          kind: 1111,
          tags: [
            ["h", community.communityId],
            ["E", "root"],
            ["K", "11"],
          ],
        }) as any,
      ),
    ).toBe(`/c/${community.naddr}/threads/root`)
  })

  it("updates the hash before scrolling a quoted event in the same exact route", async () => {
    const {goToEventPath, makeCommunityPointer} = {
      ...(await import("./routes")),
      ...(await import("@app/core/community")),
    }
    const community = makeCommunityPointer({
      ownerPubkey: "1b84c5567b126440995d3ed5aaba0565d71e1834604819ff9c17f5e9d5dd078f",
      communityId: "f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9",
    })!
    const event = makeEvent({
      kind: 9,
      tags: [["E", "room-root"]],
    })
    const path = `/c/${community.naddr}/rooms/room-root`
    window.history.replaceState(null, "", path)
    waitAndScrollToEventMock.mockImplementationOnce(() => {
      expect(window.location.hash).toBe(`#event-${event.id}`)
      return Promise.resolve(true)
    })

    await expect(goToEventPath(event as any, path)).resolves.toBe(true)

    expect(gotoMock).not.toHaveBeenCalled()
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(event.id, {behavior: "auto"})
    expect(window.location.hash).toBe(`#event-${event.id}`)
  })

  it("does not let a source-page marker suppress cross-route navigation", async () => {
    const {goToEventPath} = await import("./routes")
    const event = makeEvent({
      kind: 9,
      tags: [["E", "room-root"]],
    })
    await expect(goToEventPath(event as any, "/c/naddr1exact/rooms/room-root")).resolves.toBe(true)

    expect(gotoMock).toHaveBeenCalledOnce()
    expect(gotoMock).toHaveBeenCalledWith(expect.stringMatching(/\/rooms\/room-root#event-/), {})
  })

  it("awaits cross-route navigation before waiting for the event target", async () => {
    const {goToEventPath} = await import("./routes")
    const event = makeEvent({
      kind: 9,
      tags: [["E", "room-root"]],
    })
    let resolveNavigation!: () => void
    gotoMock.mockReturnValueOnce(
      new Promise<void>(resolve => {
        resolveNavigation = resolve
      }),
    )

    const navigation = goToEventPath(event as any, "/c/naddr1exact/rooms/room-root")
    await vi.waitFor(() => expect(gotoMock).toHaveBeenCalledOnce())
    expect(waitAndScrollToEventMock).not.toHaveBeenCalled()

    resolveNavigation()
    await expect(navigation).resolves.toBe(true)
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(event.id, {behavior: "smooth"})
  })

  it("routes supported git events and comments to internal detail targets", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const issue = makeEvent({kind: 1621, tags: [["a", repoAddress]]})
    const pullRequest = makeEvent({kind: 1618, tags: [["a", repoAddress]]})
    const issueComment = makeEvent({
      kind: 1111,
      tags: [
        ["E", issue.id],
        ["K", "1621"],
        ["q", repoAddress],
      ],
    })
    const commitComment = makeEvent({
      kind: 1111,
      tags: [
        ["I", "git:commit:abc123"],
        ["K", "commit"],
        ["q", repoAddress],
      ],
    })

    await expect(getGitEventPath(issue as any, [])).resolves.toMatch(/\/issues\/1{64}$/)
    await expect(getGitEventPath(pullRequest as any, [])).resolves.toMatch(/\/prs\/1{64}$/)
    await expect(getGitEventPath(issueComment as any, [])).resolves.toMatch(
      /\/issues\/1{64}#comment-1{64}$/,
    )
    await expect(getGitEventPath(commitComment as any, [])).resolves.toMatch(
      /\/commits\/abc123#comment-1{64}$/,
    )
  })

  it("routes multi-target git roots instead of discarding them as ambiguous", async () => {
    const {getGitEventPath} = await import("./routes")
    const firstAddress = `30617:${"a".repeat(64)}:first`
    const secondAddress = `30617:${"b".repeat(64)}:second`
    const issue = makeEvent({
      kind: 1621,
      tags: [
        ["a", firstAddress],
        ["a", secondAddress],
      ],
    })

    await expect(getGitEventPath(issue as any, [])).resolves.toMatch(/\/issues\/1{64}$/)
  })

  it("resolves git updates and statuses through their root events", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const root = makeEvent({id: "root-id", kind: 1618, tags: [["a", repoAddress]]})
    repositoryGetEvent.mockReturnValue(root)
    const update = makeEvent({
      kind: 1619,
      tags: [
        ["E", root.id],
        ["a", repoAddress],
      ],
    })
    const status = makeEvent({
      kind: 1632,
      tags: [
        ["e", root.id, "", "root"],
        ["a", repoAddress],
      ],
    })
    const coverLetter = makeEvent({
      kind: 1624,
      tags: [
        ["e", root.id],
        ["a", repoAddress],
      ],
    })

    await expect(getGitEventPath(update as any, [])).resolves.toMatch(/\/prs\/root-id$/)
    await expect(getGitEventPath(status as any, [])).resolves.toMatch(/\/prs\/root-id$/)
    await expect(getGitEventPath(coverLetter as any, [])).resolves.toMatch(/\/prs\/root-id$/)
  })

  it("loads legacy git comment and label roots to recover their repository routes", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const root = makeEvent({id: "root-id", kind: 1621, tags: [["a", repoAddress]]})
    repositoryGetEvent.mockReturnValue(root)
    const legacyComment = makeEvent({
      kind: 1111,
      tags: [
        ["E", root.id],
        ["K", "1621"],
      ],
    })
    const label = makeEvent({
      kind: 1985,
      tags: [["e", root.id]],
    })

    await expect(getGitEventPath(legacyComment as any, [])).resolves.toMatch(
      /\/issues\/root-id#comment-1{64}$/,
    )
    await expect(getGitEventPath(label as any, [])).resolves.toMatch(/\/issues\/root-id$/)

    const pullRequestRoot = makeEvent({
      id: "pr-root-id",
      kind: 1618,
      tags: [["a", repoAddress]],
    })
    repositoryGetEvent.mockReturnValue(pullRequestRoot)
    const staleImportedPrComment = makeEvent({
      kind: 1111,
      tags: [
        ["E", pullRequestRoot.id],
        ["K", "1621"],
      ],
    })

    await expect(getGitEventPath(staleImportedPrComment as any, [])).resolves.toMatch(
      /\/prs\/pr-root-id#comment-1{64}$/,
    )
  })

  it("focuses rendered git roots for metadata events and notification paths", async () => {
    const {goToEventIdPath, goToEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const rootId = "b".repeat(64)
    const repoNaddr = nip19.naddrEncode({
      kind: 30617,
      pubkey: owner,
      identifier: "quoted-navigation",
    })
    const path = `/git/${repoNaddr}/issues/${rootId}`
    const status = makeEvent({
      kind: 1632,
      tags: [["e", rootId, "", "root"]],
    })

    await expect(goToEventPath(status as any, path)).resolves.toBe(true)
    expect(gotoMock).toHaveBeenCalledWith(`${path}#event-${rootId}`, {})
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(rootId, {behavior: "smooth"})

    gotoMock.mockClear()
    waitAndScrollToEventMock.mockClear()

    await expect(goToEventIdPath(status.id, path)).resolves.toBe(true)
    expect(gotoMock).toHaveBeenCalledWith(`${path}#event-${rootId}`, {})
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(rootId, {behavior: "smooth"})
  })

  it("leaves git comment hash scrolling to the destination thread", async () => {
    const {goToEventPath} = await import("./routes")
    const comment = makeEvent({kind: 1111})
    const path = `/git/repository/prs/root#comment-${comment.id}`

    await expect(goToEventPath(comment as any, path)).resolves.toBe(true)

    expect(gotoMock).toHaveBeenCalledWith(path, {noScroll: true})
    expect(waitAndScrollToEventMock).not.toHaveBeenCalled()
  })

  it("routes git permalinks to their exact code targets", async () => {
    const {getGitEventPath} = await import("./routes")
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:quoted-navigation`
    const permalink = makeEvent({
      kind: 1623,
      tags: [
        ["a", repoAddress],
        ["file", "src/app.ts"],
        ["lines", "12", "15"],
      ],
    })

    await expect(getGitEventPath(permalink as any, [])).resolves.toMatch(
      /\/code\?path=src%2Fapp\.ts#L12-L15$/,
    )

    const dashRangePermalink = makeEvent({
      kind: 1623,
      tags: [
        ["a", repoAddress],
        ["file", "src/app.ts"],
        ["line", "20-24"],
      ],
    })

    await expect(getGitEventPath(dashRangePermalink as any, [])).resolves.toMatch(
      /\/code\?path=src%2Fapp\.ts#L20-L24$/,
    )
  })

  it("shows community comments without context in the basic event view", async () => {
    const {getEventPath, getGitEventPath} = await import("./routes")
    const communityPubkey = "a".repeat(64)
    const comment = makeEvent({
      kind: 1111,
      tags: [
        ["h", communityPubkey],
        ["E", "goal-id"],
        ["K", "9041"],
      ],
    })

    await expect(getGitEventPath(comment as any, [])).resolves.toBeUndefined()
    await expect(getEventPath(comment as any, [])).resolves.toMatch(/^\/nevent1/)
  })

  it("keeps non-community events inside Budabit with their relay hints", async () => {
    const {getCommunityEventPath, getDedicatedEventPath, getEventPath} = await import("./routes")
    const event = makeEvent()
    const path = await getEventPath(event as any, ["wss://relay.example.com"])

    expect(getCommunityEventPath(event as any)).toBeUndefined()
    expect(
      getCommunityEventPath(makeEvent({kind: 11, tags: [["h", "topic"]]}) as any),
    ).toBeUndefined()
    expect(path.startsWith("/nevent1")).toBe(true)
    expect(nip19.decode(path.slice(1))).toMatchObject({
      type: "nevent",
      data: {id: event.id, relays: ["wss://relay.example.com/"]},
    })
    await expect(getDedicatedEventPath(event as any, [])).resolves.toBeUndefined()
  })

  it("routes self-DMs to the signed-in user's chat", async () => {
    const {pubkey} = await import("@welshman/app")
    const {getEventPath} = await import("./routes")
    const selfPubkey = "a".repeat(64)
    vi.mocked(pubkey.get).mockReturnValue(selfPubkey)
    const selfDm = makeEvent({
      kind: 4,
      pubkey: selfPubkey,
      tags: [["p", selfPubkey]],
    })

    await expect(getEventPath(selfDm as any, [])).resolves.toBe(`/chat/${selfPubkey}`)
  })

  it("navigates to unsupported events without opening an external window", async () => {
    const {goToEvent} = await import("./routes")
    const open = vi.spyOn(window, "open").mockImplementation(() => null)

    await expect(goToEvent(makeEvent() as any)).resolves.toBe(true)

    expect(open).not.toHaveBeenCalled()
    expect(gotoMock).toHaveBeenCalledWith(expect.stringMatching(/^\/nevent1.*#event-/), {})
    open.mockRestore()
  })

  it("focuses the fallback event itself when a git status has no usable parent", async () => {
    const {goToEvent} = await import("./routes")
    const event = makeEvent({kind: 1630, tags: [["e", "a".repeat(64), "", "root"]]})
    await goToEvent(event as any)
    expect(gotoMock).toHaveBeenCalledWith(expect.stringContaining(`#event-${event.id}`), {})
    expect(waitAndScrollToEventMock).toHaveBeenCalledWith(event.id, expect.anything())
  })
})
