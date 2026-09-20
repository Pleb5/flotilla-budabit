import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {pubkey, repository} from "@welshman/app"
import {AuthStatus, Pool, Socket, SocketStatus} from "@welshman/net"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {buildCommunityDefinition, makeCommunityPointer} from "./community-protocol"
import {connectCommunityInvitation} from "./community-relay-access"
import {authenticateRelay} from "./relay-auth-coordinator"
import {loadCommunityEventsWithStatus} from "./community-state"
import {communityReadRecovery} from "./community-read-recovery"

vi.mock("@welshman/app", async original => {
  const signing = {sign: vi.fn()}
  return {...(await original<typeof import("@welshman/app")>()), signer: {get: () => signing}}
})
vi.mock("./relay-auth-coordinator", () => ({authenticateRelay: vi.fn()}))
vi.mock("./relay-policy", () => ({recordRelayAuthRequired: vi.fn()}))
vi.mock("./community-state", () => ({
  loadCommunityEventsWithStatus: vi.fn(),
  makeExactCommunityDefinitionFilter: (pointer: {ownerPubkey: string; communityId: string}) => ({
    kinds: [32222],
    authors: [pointer.ownerPubkey],
    "#d": [pointer.communityId],
  }),
}))

const key = new Uint8Array(32).fill(27)
const owner = getPublicKey(key)
const relay = "wss://invitation-connection.test/"
const pointer = makeCommunityPointer({
  ownerPubkey: owner,
  communityId: "d".repeat(64),
  relayHints: [relay],
})!
const scope = {pointer, relays: [relay]}
const definition = finalizeEvent(
  {
    ...buildCommunityDefinition({
      communityId: pointer.communityId,
      name: "Members",
      readAccess: "members",
      relays: [relay],
      sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
    }),
    created_at: 100,
  },
  key,
)
let pool: Pool
beforeEach(() => {
  communityReadRecovery(pointer.address, owner).reset([relay])
  vi.clearAllMocks()
  pool = new Pool({makeSocket: url => new Socket(url, [])})
  vi.spyOn(Pool, "get").mockReturnValue(pool)
  pubkey.set(owner)
  vi.mocked(authenticateRelay).mockImplementation(async socket => {
    socket.status = SocketStatus.Open
    socket.auth.setStatus(AuthStatus.Ok)
  })
  vi.mocked(loadCommunityEventsWithStatus).mockImplementation(async () => {
    repository.publish(definition)
    return {events: [definition], complete: true, failedRelays: [], timedOutRelays: []}
  })
})
afterEach(() => {
  pool.clear()
  repository.removeEvent(definition.id)
  pubkey.set(undefined)
  vi.restoreAllMocks()
})
describe("invitation connection with ordinary client data handling", () => {
  it("authenticates the pooled socket and loads into the shared repository", async () => {
    expect(await connectCommunityInvitation(scope, new AbortController().signal)).toEqual([
      {relay, outcome: "complete"},
    ])
    expect(authenticateRelay).toHaveBeenCalledWith(
      pool.get(relay),
      expect.objectContaining({retry: true}),
    )
    const options = vi.mocked(loadCommunityEventsWithStatus).mock.calls[0][2]
    expect(options).not.toHaveProperty("publishEvents", false)
    expect(options).not.toHaveProperty("context")
    expect(repository.getEvent(definition.id)).toEqual(definition)
  })
  it.each([SocketStatus.Open, SocketStatus.Opening])(
    "keeps a shared %s connection across retries",
    async status => {
      const socket = pool.get(relay)
      socket.status = status
      if (status === SocketStatus.Open) socket.auth.setStatus(AuthStatus.Ok)
      await connectCommunityInvitation(scope, new AbortController().signal)
      expect(pool.get(relay)).toBe(socket)
      expect(socket._disposed).toBe(false)
    },
  )
  it("distinguishes membership denial from AUTH and reconnects explicitly after disconnect", async () => {
    vi.mocked(loadCommunityEventsWithStatus).mockResolvedValueOnce({
      events: [],
      complete: false,
      failedRelays: [relay],
      timedOutRelays: [],
      outcomes: {[relay]: "denied"},
    })
    expect(await connectCommunityInvitation(scope, new AbortController().signal)).toEqual([
      {relay, outcome: "denied"},
    ])
    expect(authenticateRelay).toHaveBeenCalledTimes(1)
    expect(communityReadRecovery(pointer.address, owner).blocked(relay)).toBe(true)
    const denied = pool.get(relay)
    denied.close()
    expect(await connectCommunityInvitation(scope, new AbortController().signal)).toEqual([
      {relay, outcome: "complete"},
    ])
    expect(pool.get(relay)).not.toBe(denied)
    expect(denied._disposed).toBe(true)
    expect(communityReadRecovery(pointer.address, owner).blocked(relay)).toBe(false)
  })
  it("never purges received events on disconnect or account change", async () => {
    await connectCommunityInvitation(scope, new AbortController().signal)
    pool.get(relay).close()
    pubkey.set(undefined)
    expect(repository.getEvent(definition.id)).toEqual(definition)
  })
  it("does not query after cancellation", async () => {
    const controller = new AbortController()
    vi.mocked(authenticateRelay).mockImplementation(async () => controller.abort())
    await expect(connectCommunityInvitation(scope, controller.signal)).rejects.toThrow(/cancelled/)
    expect(loadCommunityEventsWithStatus).not.toHaveBeenCalled()
  })
  it("does not query after an account switch while authentication is pending", async () => {
    vi.mocked(authenticateRelay).mockImplementation(async () => {
      pubkey.set("e".repeat(64))
    })
    await expect(connectCommunityInvitation(scope, new AbortController().signal)).rejects.toThrow(
      /cancelled/,
    )
    expect(loadCommunityEventsWithStatus).not.toHaveBeenCalled()
  })
  it("requires an account and valid invitation before touching transport", async () => {
    pubkey.set(undefined)
    await expect(connectCommunityInvitation(scope, new AbortController().signal)).rejects.toThrow(
      /signing account/,
    )
    pubkey.set(owner)
    await expect(
      connectCommunityInvitation({...scope, relays: []}, new AbortController().signal),
    ).rejects.toThrow(/Missing invitation relays/)
    expect(authenticateRelay).not.toHaveBeenCalled()
    expect(loadCommunityEventsWithStatus).not.toHaveBeenCalled()
  })
})
