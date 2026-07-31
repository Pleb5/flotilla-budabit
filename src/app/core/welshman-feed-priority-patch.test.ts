import {describe, expect, it, vi} from "vitest"
import {FeedController, FeedType, type Feed} from "@welshman/feeds"
import {
  ClientMessageType,
  RelayMessageType,
  Socket,
  SocketAdapter,
  SocketEvent,
  getRequestSchedulerSnapshots,
  requestOne,
  setRequestPolicy,
  type ClientMessage,
} from "@welshman/net"

describe("Welshman feed priority patch", () => {
  it("queues an owned foreground feed before broad community work", async () => {
    const relay = "wss://priority-feed.example/"
    const restorePolicy = setRequestPolicy(() => ({
      maxSubscriptions: 1,
      maxFiltersPerSubscription: 10,
      maxLiveSubscriptions: 1,
      maxBackgroundLiveSubscriptions: 1,
      criticalLivePriority: 200,
      maxMessageBytes: 128 * 1024,
    }))
    const socket = new Socket(relay, [])
    const send = vi.fn<(message: ClientMessage) => void>()
    socket.send = send
    const context = {getAdapter: () => new SocketAdapter(socket)}
    const blockerController = new AbortController()
    const blocker = requestOne({
      relay,
      filters: [{kinds: [1]}],
      signal: blockerController.signal,
      priority: 200,
      owner: "community-live",
      context,
    })
    const broad = requestOne({
      relay,
      filters: [{kinds: [8]}],
      autoClose: true,
      priority: 300,
      owner: "community-discovery",
      context,
    })
    const feed: Feed = [FeedType.Intersection, [FeedType.Relay, relay], [FeedType.Kind, 9]]
    const controller = new FeedController({
      feed,
      priority: 350,
      owner: "active-room:test",
      context,
      getPubkeysForScope: () => [],
      getPubkeysForWOTRange: () => [],
    })
    const room = controller.load(100)

    try {
      await vi.waitFor(() =>
        expect(
          getRequestSchedulerSnapshots()
            .find(snapshot => snapshot.relay === relay)
            ?.owners.some(owner => owner.owner === "active-room:test"),
        ).toBe(true),
      )

      blockerController.abort()
      await blocker

      const requests = send.mock.calls
        .map(([message]) => message)
        .filter(message => message[0] === ClientMessageType.Req)
      expect(requests).toHaveLength(2)
      expect(requests[1].slice(2)).toEqual([expect.objectContaining({kinds: [9]})])

      socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, requests[1][1]], relay)
      await room

      const broadRequest = send.mock.calls
        .map(([message]) => message)
        .filter(message => message[0] === ClientMessageType.Req)[2]
      expect(broadRequest.slice(2)).toEqual([expect.objectContaining({kinds: [8]})])
      socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, broadRequest[1]], relay)
      await broad
    } finally {
      blockerController.abort()
      restorePolicy()
      socket.cleanup()
    }
  })
})
