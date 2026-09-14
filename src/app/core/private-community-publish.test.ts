import {describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {Socket, AuthStatus, SocketEvent, type ClientMessage} from "@welshman/net"
import {buildCommunityDefinition, parseCommunityDefinition} from "./community-protocol"
import {publishPrivateCommunityEvent} from "./private-community-publish"
import {installPrivateCommunityBoundary} from "./private-community-boundary"
import {repository} from "@welshman/app"

const key = new Uint8Array(32).fill(32),
  owner = getPublicKey(key),
  relay = "wss://private-publisher.test/"
const definition = parseCommunityDefinition(
  finalizeEvent(
    {
      ...buildCommunityDefinition({
        communityId: "b".repeat(64),
        name: "Private publish",
        readAccess: "members",
        relays: [relay],
        sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
      }),
      created_at: 100,
    },
    key,
  ),
)!
const setup = () => {
  const socket = new Socket(relay, []),
    controller = new AbortController()
  socket.auth.setStatus(AuthStatus.Ok)
  const sent: ClientMessage[] = []
  socket.send = message => {
    sent.push(message)
    if (message[0] === "EVENT")
      socket.emit(SocketEvent.Receive, ["OK", message[1].id, true, ""], relay)
  }
  const options = {
    definition,
    event: {kind: 1, tags: [["h", definition.communityId]], content: "memory only"},
    relays: [relay],
    profiles: new Map([
      [
        relay,
        {
          limitation: {auth_required: true},
          budabit: {read_control: {version: 1, mode: "members", scope: "relay"}},
        },
      ],
    ]),
    sockets: new Map([[relay, socket]]),
    identity: owner,
    currentIdentity: () => owner,
    signal: controller.signal,
    sign: vi.fn(async event => finalizeEvent(event, key)),
  }
  return {socket, controller, sent, options}
}
describe("private publish lifecycle", () => {
  it("allows only verified dedicated destinations without optimistic shared insertion", async () => {
    const {socket, options, sent} = setup(),
      restore = installPrivateCommunityBoundary()
    try {
      const {event} = await publishPrivateCommunityEvent(options)
      expect(sent.map(message => message[0])).toEqual(["EVENT"])
      expect(repository.query([{ids: [event.id]}])).toEqual([])
      expect(options.sign).toHaveBeenCalledOnce()
    } finally {
      restore()
      socket.cleanup()
    }
  })
  it("ignores signer completion after identity change", async () => {
    const {socket, options, sent} = setup()
    let resolve!: (event: any) => void
    let template: any
    options.sign = vi.fn(event => {
      template = event
      return new Promise(done => {
        resolve = done
      })
    })
    const result = publishPrivateCommunityEvent(options)
    options.currentIdentity = () => "other"
    resolve(finalizeEvent(template, key))
    await expect(result).rejects.toThrow(/identity/)
    expect(sent).toEqual([])
    socket.cleanup()
  })
  it("cancels an uncooperative signer and suppresses already-popped queued sends", async () => {
    const first = setup()
    first.options.sign = vi.fn(() => new Promise(() => {}))
    const signing = publishPrivateCommunityEvent(first.options)
    first.controller.abort()
    await expect(signing).rejects.toThrow(/cancelled/)
    expect(first.sent).toEqual([])
    first.socket.cleanup()
    const {socket, controller, options} = setup()
    let queued: ClientMessage | undefined
    socket.send = message => {
      queued = message
    }
    const publication = publishPrivateCommunityEvent(options)
    await vi.waitFor(() => expect(queued).toBeTruthy())
    expect(socket._sendGuards.get(queued!)?.()).toBe(true)
    controller.abort()
    expect(socket._sendGuards.get(queued!)?.()).toBe(false)
    await expect(publication).rejects.toThrow(/acknowledged/)
    socket.cleanup()
  })
})
