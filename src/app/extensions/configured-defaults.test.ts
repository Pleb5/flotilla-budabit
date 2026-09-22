import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import * as nip19 from "nostr-tools/nip19"
import type {TrustedEvent} from "@welshman/util"
import {loadConfiguredDefaultWidgets, parseDefaultWidgetNaddrs} from "./configured-defaults"

const mocks = vi.hoisted(() => ({load: vi.fn(), query: vi.fn()}))
vi.mock("@welshman/app", () => ({repository: {query: mocks.query}}))
vi.mock("@app/core/community-state", () => ({loadCommunityEventsWithStatus: mocks.load}))
vi.mock("@app/core/relay-policy", () => ({RELAY_REQUEST_PRIORITY: {background: -100}}))
vi.mock("@app/core/state", () => ({SMART_WIDGET_RELAYS: ["wss://fallback.example"]}))

const pubkey = "a".repeat(64)
const naddr = (identifier: string, relays: string[] = [], author = pubkey, kind = 30033) =>
  nip19.naddrEncode({identifier, pubkey: author, kind, relays})
const event = (identifier: string, created_at = 1, author = pubkey): TrustedEvent =>
  ({
    id: `${identifier}-${created_at}`,
    kind: 30033,
    pubkey: author,
    created_at,
    content: identifier,
    tags: [["d", identifier]],
  }) as TrustedEvent
const result = (events: TrustedEvent[] = [], complete = true) => ({
  events,
  complete,
  timedOutRelays: complete ? [] : ["wss://hint.example/"],
  failedRelays: [],
})

beforeEach(() => {
  mocks.query.mockReset().mockReturnValue([])
  mocks.load.mockReset().mockResolvedValue(result())
  vi.spyOn(console, "warn").mockImplementation(() => {})
})
afterEach(() => vi.restoreAllMocks())

describe("configured default widget addresses", () => {
  it("accepts a trimmed CSV, merges relay hints by address, and keeps different authors", () => {
    const pointers = parseDefaultWidgetNaddrs(
      ` , ${naddr("weather", ["wss://one.example"])}, nostr:${naddr("weather", ["wss://two.example", "wss://one.example/"])}, ${naddr("weather", [], "b".repeat(64))}, `,
    )

    expect(pointers).toEqual([
      {
        kind: 30033,
        pubkey,
        identifier: "weather",
        relays: ["wss://one.example/", "wss://two.example/"],
      },
      {kind: 30033, pubkey: "b".repeat(64), identifier: "weather", relays: []},
    ])
  })

  it("reports malformed and wrong-kind entries without losing valid addresses", () => {
    const pointers = parseDefaultWidgetNaddrs(
      `broken,${naddr("community", [], pubkey, 32222)},${nip19.npubEncode(pubkey)},${naddr("weather")}`,
    )

    expect(pointers.map(pointer => pointer.identifier)).toEqual(["weather"])
    expect(console.warn).toHaveBeenCalledTimes(3)
  })
})

describe("configured default widget loading", () => {
  it("does no relay work for an empty list", async () => {
    expect(await loadConfiguredDefaultWidgets(" , ")).toEqual([])
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.query).not.toHaveBeenCalled()
  })

  it("uses exact hinted lookups and selects the newest valid matching event", async () => {
    const older = event("weather", 1)
    const newest = event("weather", 3)
    const invalid = {
      ...event("weather", 4),
      tags: [
        ["d", "weather"],
        ["l", "tool"],
      ],
    }
    mocks.query.mockReturnValue([older])
    mocks.load.mockResolvedValue(
      result([
        older,
        event("wrong-address", 5),
        invalid,
        newest,
        event("weather", 6, "b".repeat(64)),
      ]),
    )

    const widgets = await loadConfiguredDefaultWidgets(naddr("weather", ["wss://hint.example"]))

    expect(widgets.map(widget => widget.id)).toEqual([newest.id])
    expect(mocks.load).toHaveBeenCalledExactlyOnceWith(
      ["wss://hint.example/"],
      [{kinds: [30033], authors: [pubkey], "#d": ["weather"], limit: 1}],
      {priority: -100},
    )
  })

  it.each(["empty", "timeout", "error", "invalid"])(
    "falls back from a %s hinted lookup to discovery relays",
    async failure => {
      if (failure === "error") mocks.load.mockRejectedValueOnce(new Error("unavailable"))
      else if (failure === "invalid") {
        mocks.load.mockResolvedValueOnce(
          result([
            {
              ...event("weather"),
              tags: [
                ["d", "weather"],
                ["l", "tool"],
              ],
            },
          ]),
        )
      } else mocks.load.mockResolvedValueOnce(result([], failure !== "timeout"))
      mocks.load.mockResolvedValueOnce(result([event("weather")]))

      const widgets = await loadConfiguredDefaultWidgets(naddr("weather", ["wss://hint.example"]))

      expect(widgets.map(widget => widget.identifier)).toEqual(["weather"])
      expect(mocks.load.mock.calls.map(call => call[0])).toEqual([
        ["wss://hint.example/"],
        ["wss://fallback.example/"],
      ])
    },
  )

  it("uses cached metadata when relay loading fails", async () => {
    mocks.query.mockReturnValue([event("weather")])
    mocks.load.mockRejectedValue(new Error("offline"))

    const widgets = await loadConfiguredDefaultWidgets(naddr("weather"))

    expect(widgets.map(widget => widget.identifier)).toEqual(["weather"])
  })

  it("delivers successful defaults while another address is pending, then keeps partial results", async () => {
    let finishMissing!: (value: ReturnType<typeof result>) => void
    const missing = new Promise<ReturnType<typeof result>>(resolve => {
      finishMissing = resolve
    })
    mocks.load.mockImplementation(async (_relays, filters) =>
      filters[0]["#d"][0] === "missing" ? missing : result([event("weather")]),
    )
    const onWidget = vi.fn()
    const pending = loadConfiguredDefaultWidgets(
      `${naddr("missing")},${naddr("weather")}`,
      onWidget,
    )

    await vi.waitFor(() => expect(onWidget).toHaveBeenCalledOnce())
    expect(onWidget.mock.calls[0][0].identifier).toBe("weather")
    finishMissing(result())

    expect((await pending).map(widget => widget.identifier)).toEqual(["weather"])
    expect(console.warn).toHaveBeenCalledWith(
      "[extensions] Failed to load configured default widget",
      expect.objectContaining({identifier: "missing"}),
      expect.any(Error),
    )
  })
})
