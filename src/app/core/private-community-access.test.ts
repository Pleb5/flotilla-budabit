import {afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {Socket, AuthStatus, type RequestOneOptions} from "@welshman/net"
import {repository as sharedRepository, pubkey} from "@welshman/app"
import {PrivateCommunityAccess, privateAccessHeading} from "./private-community-access"
import {makeCommunityPointer, buildCommunityDefinition} from "./community-protocol"
import {makeCommunityEventReport, makeCommunityPersonReport} from "./community-reports"
import {PRIVATE_AUTHORITY_KINDS} from "./private-relay-profile"

vi.mock("./relay-auth-consent", () => ({
  allowRelayAuthentication: vi.fn(),
  requireExplicitRelayAuthConsent: vi.fn(),
}))
vi.mock("./relay-auth-coordinator", () => ({
  authenticateRelay: vi.fn(),
  cancelRelayAuthentication: vi.fn(),
}))
const key = new Uint8Array(32).fill(27),
  owner = getPublicKey(key)
const community = "d".repeat(64),
  relay = "wss://private-access.test/"
const pointer = makeCommunityPointer({
  ownerPubkey: owner,
  communityId: community,
  relayHints: [relay],
})!
const definition = finalizeEvent(
  {
    kind: 32222,
    tags: [
      ["d", community],
      ["name", "Private fixture"],
      ["r", relay.slice(0, -1)],
      ["content", "General"],
      ["k", "1"],
    ],
    content: "",
    created_at: 100,
  },
  key,
)
const textTags = [
  ["h", community],
  ["a", pointer.address],
]
const note = finalizeEvent(
  {kind: 1, tags: textTags, content: "retained secret", created_at: 101},
  key,
)
const controls: PrivateCommunityAccess[] = []
afterEach(() => {
  controls.splice(0).forEach(control => control.dispose())
  vi.useRealTimers()
})
const setup = (
  relays = [relay],
  cap: unknown = 200,
  unfiltered: unknown = [1, ...PRIVATE_AUTHORITY_KINDS],
) => {
  pubkey.set(owner)
  const reads: RequestOneOptions[] = []
  const socket = vi.fn(url => new Socket(url))
  const authenticate = vi.fn(async (socket: Socket) => {
    socket.auth.setStatus(AuthStatus.Ok)
  })
  const request = vi.fn(options => {
    reads.push(options)
    return Promise.resolve([])
  }) as any
  const control = new PrivateCommunityAccess({pointer, relays}, owner, {
    socket,
    authenticate,
    request,
    profiles: async relays =>
      new Map(
        relays.map(url => [
          url,
          {limitation: {max_limit: cap}, budabit: {read_control: {unfiltered_kinds: unfiltered}}},
        ]),
      ),
  })
  controls.push(control)
  return {control, reads, socket, authenticate, request}
}

describe("private access lifecycle", () => {
  it("derives login/signer/auth/access states without confusing denial with empty data", () => {
    expect(privateAccessHeading(undefined, false, "ready")).toMatch(/Sign in/)
    expect(privateAccessHeading(owner, false, "ready")).toMatch(/signer/)
    expect(privateAccessHeading(owner, true, "signing")).toMatch(/signer/)
    expect(privateAccessHeading(owner, true, "denied")).toBe("Access denied")
    expect(privateAccessHeading(owner, true, "partial")).toMatch(/incomplete/)
  })
  it("does no network work until consent; stores only in the private repository", async () => {
    const {control, reads, socket} = setup()
    expect(socket).not.toHaveBeenCalled()
    await control.start()
    expect(reads[0].relay).toBe(relay)
    expect(reads[0].filters).toEqual([
      {kinds: PRIVATE_AUTHORITY_KINDS, limit: 200},
      {kinds: [1], limit: 200},
    ])
    reads[0].onEvent!(definition, relay)
    reads[0].onEvent!(note, relay)
    reads[0].onEose!(relay)
    expect(get(control.view).access).toBe("ready")
    expect(get(control.view).definition?.metadata.name).toBe("Private fixture")
    expect(sharedRepository.query([{ids: [definition.id, note.id]}])).toEqual([])
  })
  it("denial after ACK preserves the authenticated socket; retry refetches history", async () => {
    const {control, reads, socket} = setup()
    await control.start()
    reads[0].onClosed!("restricted: not eligible", relay)
    expect(get(control.view).access).toBe("denied")
    const connection = control.sockets.get(relay)
    expect(connection?.auth.status).toBe(AuthStatus.Ok)
    await control.start()
    expect(socket).toHaveBeenCalledOnce()
    expect(control.sockets.get(relay)).toBe(connection)
    expect(reads[1].filters).toEqual(reads[0].filters)
    reads[1].onEvent!(definition, relay)
    reads[1].onEvent!(note, relay)
    reads[1].onEose!(relay)
    expect(get(control.view).access).toBe("ready")
  })
  it("cannot turn timeout, missing definition, or invalid events into complete empty history", async () => {
    vi.useFakeTimers()
    const {control, reads} = setup()
    await control.start()
    await vi.advanceTimersByTimeAsync(15000)
    expect(get(control.view).access).toBe("unavailable")
    reads[0].onEose!(relay)
    expect(get(control.view).access).toBe("partial")
    reads[0].onEvent!(definition, relay)
    reads[0].onInvalid!({}, relay)
    reads[0].onEose!(relay)
    expect(get(control.view).access).toBe("partial")
  })
  it("exposes degraded per-relay status and clears data on revoked connection", async () => {
    const second = "wss://second.test/"
    const {control, reads} = setup([relay, second])
    await control.start()
    reads[0].onEvent!(definition, relay)
    reads[0].onEose!(relay)
    reads[1].onClosed!("error: policy unavailable", second)
    expect(get(control.view).access).toBe("partial")
    expect(get(control.view).relays[second]).toBe("unavailable")
    reads[1].onEose!(second)
    expect(get(control.view).access).toBe("ready")
    reads[0].onDisconnect!(relay)
    expect(get(control.view).access).toBe("revoked")
    expect(get(control.view).events).toEqual([])
  })
  it("drops callbacks after cancellation, disposal and replaced generations", async () => {
    const {control, reads} = setup()
    await control.start()
    await control.start()
    reads[0].onEvent!(note, relay)
    expect(get(control.view).events).toEqual([])
    control.dispose()
    reads[1].onEvent!(definition, relay)
    reads[1].onEose!(relay)
    expect(get(control.view).events).toEqual([])
    expect(get(control.view).access).toBe("cancelled")
  })

  it.each([undefined, 0, -1, "200", 1.5, NaN])(
    "does not infer complete authority from an unknown/invalid cap %s",
    async cap => {
      // Pass null for undefined because setup's default is the normal known cap.
      const {control, reads} = setup([relay], cap ?? null)
      await control.start()
      reads[0].onEvent!(definition, relay)
      reads[0].onEvent!(note, relay)
      reads[0].onEose!(relay)
      expect(get(control.view).access).toBe("partial")
      expect(get(control.view).events).toEqual([])
    },
  )

  it.each(["grant", "ban", "deletion"])(
    "keeps a smaller-cap page partial when older %s evidence was not fetched",
    async kind => {
      const {control, reads} = setup([relay], 2)
      await control.start()
      expect(reads[0].filters).toEqual([
        {kinds: PRIVATE_AUTHORITY_KINDS, limit: 2},
        {kinds: [1], limit: 2},
      ])
      const older =
        kind === "ban"
          ? makeCommunityPersonReport({community: pointer, pubkey: owner})
          : kind === "deletion"
            ? {kind: 5, tags: [["e", note.id]], content: ""}
            : {kind: 30000, tags: [["d", `${community}-general`]], content: ""}
      const history = [
        finalizeEvent({...older, created_at: 90}, key),
        definition,
        finalizeEvent(
          {kind: 30000, tags: [["d", "another-shard"]], content: "", created_at: 102},
          key,
        ),
      ]
      history.slice(-2).forEach(event => reads[0].onEvent!(event, relay))
      reads[0].onEvent!(note, relay)
      reads[0].onEose!(relay)
      expect(get(control.view).access).toBe("partial")
      expect(get(control.view).events).toEqual([])
    },
  )

  it("accepts a complete small relay below its known cap", async () => {
    const {control, reads} = setup([relay], 3)
    await control.start()
    reads[0].onEvent!(definition, relay)
    reads[0].onEvent!(note, relay)
    reads[0].onEose!(relay)
    expect(get(control.view).access).toBe("ready")
    expect(get(control.view).events.map(event => event.id)).toEqual([note.id])
  })

  it.each([
    null,
    [],
    [1, 5, 30000, 32222],
    [5, 1984, 30000, 32222],
    "all",
    [1, 5, 1984, 30000, "32222"],
  ])("withholds completeness without an unfiltered authority/text contract: %s", async kinds => {
    const {control, reads} = setup([relay], 3, kinds)
    await control.start()
    reads[0].onEvent!(definition, relay)
    reads[0].onEvent!(note, relay)
    reads[0].onEose!(relay)
    expect(get(control.view).access).toBe("partial")
    expect(get(control.view).events).toEqual([])
  })

  it("recomputes exact-branch text admission after grant removal, regrant, definition edits and section reports", async () => {
    const memberKey = new Uint8Array(32).fill(40),
      member = getPublicKey(memberKey)
    const profile = `30000:${owner}:${community}-general`
    const scoped = finalizeEvent(
      {
        ...buildCommunityDefinition({
          communityId: community,
          name: "Private fixture",
          relays: [relay],
          readAccess: "members",
          sections: [
            {name: "General", kinds: [{kind: 1}], profileLists: [{address: profile}]},
            {name: "Other", kinds: [{kind: 11}], profileLists: []},
          ],
        }),
        created_at: 102,
      },
      key,
    )
    const memberNote = finalizeEvent(
      {kind: 1, tags: textTags, content: "member text", created_at: 103},
      memberKey,
    )
    const {control, reads} = setup()
    await control.start()
    const receive = (event: ReturnType<typeof finalizeEvent>) => reads[0].onEvent!(event, relay)
    const visible = () => get(control.view).events.map(event => event.id)
    receive(scoped)
    receive(note)
    receive(memberNote)
    for (const tags of [
      [],
      [
        ["h", "e".repeat(64)],
        ["a", pointer.address],
      ],
      [
        ["h", community],
        ["a", `32222:${member}:${community}`],
      ],
    ])
      receive(finalizeEvent({kind: 1, tags, content: "wrong branch", created_at: 104}, key))
    receive(finalizeEvent({kind: 11, tags: textTags, content: "unsupported", created_at: 104}, key))
    reads[0].onEose!(relay)
    expect(visible()).toEqual([note.id])
    const grant = (members: string[], at: number) =>
      finalizeEvent(
        {
          kind: 30000,
          tags: [["d", `${community}-general`], ...members.map(key => ["p", key])],
          content: "",
          created_at: at,
        },
        key,
      )
    receive(grant([member], 105))
    expect(visible()).toContain(memberNote.id)
    receive(grant([], 106))
    expect(visible()).not.toContain(memberNote.id)
    receive(grant([member], 107))
    expect(visible()).toContain(memberNote.id)
    const report = (sectionName: string, at: number) =>
      finalizeEvent(
        {
          ...makeCommunityEventReport({
            community: pointer,
            sectionName,
            eventId: memberNote.id,
            eventPubkey: member,
            eventKind: 1,
          }),
          created_at: at,
        },
        key,
      )
    receive(report("Other", 108))
    expect(visible()).toContain(memberNote.id)
    receive(report("General", 109))
    expect(visible()).not.toContain(memberNote.id)
    receive(
      finalizeEvent(
        {
          ...scoped,
          tags: scoped.tags.map(tag => (tag[0] === "k" && tag[1] === "1" ? ["k", "7"] : tag)),
          created_at: 110,
        },
        key,
      ),
    )
    expect(visible()).toEqual([])
  })
})
