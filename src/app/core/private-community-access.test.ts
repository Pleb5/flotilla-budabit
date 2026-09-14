import {afterEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {Socket, AuthStatus, type RequestOneOptions} from "@welshman/net"
import {repository as sharedRepository, pubkey} from "@welshman/app"
import {PrivateCommunityAccess, privateAccessHeading} from "./private-community-access"
import {makeCommunityPointer} from "./community-protocol"

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
const note = finalizeEvent({kind: 1, tags: [], content: "retained secret", created_at: 101}, key)
const controls: PrivateCommunityAccess[] = []
afterEach(() => {
  controls.splice(0).forEach(control => control.dispose())
  vi.useRealTimers()
})
const setup = (relays = [relay]) => {
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
    expect(reads[0].filters).toEqual([{limit: 200}])
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
})
