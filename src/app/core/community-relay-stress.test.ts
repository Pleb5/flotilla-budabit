import {describe, expect, it, vi} from "vitest"
import {
  ClientMessageType,
  getRequestSchedulerSnapshots,
  RelayMessageType,
  requestOne,
  setRequestPolicy,
  Socket,
  SocketAdapter,
  SocketEvent,
  type ClientMessage,
} from "@welshman/net"
import {
  COMMENT,
  EVENT_TIME,
  MESSAGE,
  THREAD,
  ZAP_GOAL,
  type Filter,
  type TrustedEvent,
} from "@welshman/util"
import {buildTargetedPublication, TARGETED_PUBLICATION_KIND} from "./community"
import {
  makeCommunityRoomMessagesFilter,
  makeCommunityThreadRepliesFilter,
  makeTargetedPublicationOriginalFilters,
} from "./community-feeds"
import {buildCommunityHistoricalDiscoveryFilters} from "./community-live"

const relay = "wss://relay.budabit.club/"
const communityPubkey = "a".repeat(64)
const authorPubkey = "b".repeat(64)

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: authorPubkey,
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

describe("community relay stress", () => {
  it("loads cold community data at the public 28/24/18 budget", async () => {
    const restorePolicy = setRequestPolicy(() => ({
      maxSubscriptions: 28,
      maxFiltersPerSubscription: 10,
      maxLiveSubscriptions: 24,
      maxBackgroundLiveSubscriptions: 18,
      criticalLivePriority: 200,
      maxMessageBytes: 128 * 1024,
    }))
    const socket = new Socket(relay, [])
    const send = vi.fn<(message: ClientMessage) => void>()
    socket.send = send
    const context = {getAdapter: () => new SocketAdapter(socket)}
    const controllers: AbortController[] = []
    const pending: Array<PromiseLike<unknown>> = []
    const getMessages = () => send.mock.calls.map(([message]) => message)
    const getReqs = () => getMessages().filter(message => message[0] === ClientMessageType.Req)
    const loadFinite = (filters: Filter[], owner: string) => {
      const controller = new AbortController()
      controllers.push(controller)
      const result = requestOne({
        relay,
        filters,
        autoClose: true,
        signal: controller.signal,
        owner,
        isEventValid: () => true,
        isEventDeleted: () => false,
        context,
      })
      pending.push(result)
      return result
    }

    try {
      const backgroundControllers = Array.from({length: 18}, () => new AbortController())
      const criticalControllers = Array.from({length: 6}, () => new AbortController())
      controllers.push(...backgroundControllers, ...criticalControllers)
      const live = [
        ...backgroundControllers.map((controller, index) =>
          requestOne({
            relay,
            filters: [{kinds: [10_000 + index]}],
            signal: controller.signal,
            priority: 0,
            owner: "background-stress",
            context,
          }),
        ),
        ...criticalControllers.map((controller, index) =>
          requestOne({
            relay,
            filters: [{kinds: [20_000 + index]}],
            signal: controller.signal,
            priority: 200,
            owner: "critical-stress",
            context,
          }),
        ),
      ]
      pending.push(...live)

      expect(getReqs()).toHaveLength(24)

      const roomRoot = makeEvent({
        id: "room-root",
        kind: THREAD,
        tags: [
          ["h", communityPubkey],
          ["room", "General"],
        ],
      })
      const threadRoot = makeEvent({
        id: "thread-root",
        kind: THREAD,
        tags: [["h", communityPubkey]],
      })
      const calendarWrapper = makeEvent({
        id: "calendar-wrapper",
        kind: TARGETED_PUBLICATION_KIND,
        tags: buildTargetedPublication({
          id: "calendar-target",
          kind: EVENT_TIME,
          ref: {type: "a", value: `${EVENT_TIME}:${authorPubkey}:calendar-event`},
          communities: [{pubkey: communityPubkey}],
        }).tags,
      })
      const goalWrapper = makeEvent({
        id: "goal-wrapper",
        kind: TARGETED_PUBLICATION_KIND,
        tags: buildTargetedPublication({
          id: "goal-target",
          kind: ZAP_GOAL,
          ref: {type: "e", value: "goal-original"},
          communities: [{pubkey: communityPubkey}],
        }).tags,
      })
      const discovery = loadFinite(
        buildCommunityHistoricalDiscoveryFilters(communityPubkey),
        "community-discovery",
      )
      const discoveryReq = getReqs()[24]

      for (const event of [roomRoot, threadRoot, calendarWrapper, goalWrapper]) {
        socket.emit(SocketEvent.Receive, [RelayMessageType.Event, discoveryReq[1], event], relay)
      }

      const roomMessage = makeEvent({
        id: "room-message",
        kind: MESSAGE,
        tags: [
          ["h", communityPubkey],
          ["E", roomRoot.id],
        ],
      })
      const threadReply = makeEvent({
        id: "thread-reply",
        kind: COMMENT,
        tags: [
          ["h", communityPubkey],
          ["K", String(THREAD)],
          ["E", threadRoot.id],
        ],
      })
      const calendarOriginal = makeEvent({
        id: "calendar-original",
        kind: EVENT_TIME,
        tags: [["d", "calendar-event"]],
      })
      const goalOriginal = makeEvent({id: "goal-original", kind: ZAP_GOAL})
      const room = loadFinite(
        [makeCommunityRoomMessagesFilter(communityPubkey, roomRoot.id)],
        "community-room",
      )
      const thread = loadFinite(
        [makeCommunityThreadRepliesFilter(communityPubkey, {"#E": [threadRoot.id]})],
        "community-thread",
      )
      const calendar = loadFinite(
        makeTargetedPublicationOriginalFilters([calendarWrapper]),
        "community-calendar",
      )
      const goal = loadFinite(
        makeTargetedPublicationOriginalFilters([goalWrapper]),
        "community-goal",
      )

      expect(getReqs()).toHaveLength(28)
      expect(getRequestSchedulerSnapshots()).toContainEqual(
        expect.objectContaining({
          relay,
          active: {
            total: 28,
            finite: 4,
            live: 24,
            criticalLive: 6,
            backgroundLive: 18,
          },
          queued: expect.objectContaining({total: 1, finite: 1}),
        }),
      )

      socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, discoveryReq[1]], relay)
      expect(getReqs()).toHaveLength(29)

      const finiteEvents = [roomMessage, threadReply, calendarOriginal, goalOriginal]
      const finiteReqs = getReqs().slice(25)
      finiteReqs.forEach((req, index) => {
        socket.emit(
          SocketEvent.Receive,
          [RelayMessageType.Event, req[1], finiteEvents[index]],
          relay,
        )
        socket.emit(SocketEvent.Receive, [RelayMessageType.Eose, req[1]], relay)
      })

      await expect(discovery).resolves.toEqual([roomRoot, threadRoot, calendarWrapper, goalWrapper])
      await expect(Promise.all([room, thread, calendar, goal])).resolves.toEqual([
        [roomMessage],
        [threadReply],
        [calendarOriginal],
        [goalOriginal],
      ])

      let active = 0
      let maxActive = 0
      for (const message of getMessages()) {
        if (message[0] === ClientMessageType.Req) active += 1
        if (message[0] === ClientMessageType.Close) active -= 1
        maxActive = Math.max(maxActive, active)
      }

      expect(maxActive).toBe(28)
      expect(
        getReqs().every(
          message =>
            message.slice(2).length <= 10 &&
            new TextEncoder().encode(JSON.stringify(message)).byteLength <= 128 * 1024,
        ),
      ).toBe(true)
      expect(getMessages().some(message => message[0] === ClientMessageType.Auth)).toBe(false)
    } finally {
      controllers.forEach(controller => controller.abort())
      await Promise.all(pending)
      restorePolicy()
      socket.cleanup()
    }
  })
})
