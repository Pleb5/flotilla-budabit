import {beforeEach, describe, expect, it, vi} from "vitest"
import {writable} from "svelte/store"

const signerStore = writable<any>(null)
const pubkeyStore = writable<string | null>(null)
const loadMock = vi.fn().mockResolvedValue(undefined)
const publishMock = vi.fn().mockResolvedValue(undefined)
const publishStatuses = {
  Sending: "sending",
  Pending: "pending",
  Success: "success",
  Failure: "failure",
  Timeout: "timeout",
  Aborted: "aborted",
} as const
const routerGetMock = vi.fn(() => ({
  FromUser: () => ({getUrls: () => ["wss://ambient-outbox.example.com"]}),
}))

const makePublishOutcome = (
  relay: string,
  status: (typeof publishStatuses)[keyof typeof publishStatuses],
  detail = "",
) => ({relay, status, detail})

vi.mock("@welshman/app", () => ({
  signer: signerStore,
  pubkey: pubkeyStore,
}))

vi.mock("@welshman/net", () => ({
  load: loadMock,
  publish: publishMock,
  PublishStatus: publishStatuses,
}))

vi.mock("@welshman/router", () => ({
  Router: {
    get: routerGetMock,
  },
}))

describe("event-io", () => {
  beforeEach(() => {
    signerStore.set(null)
    pubkeyStore.set(null)
    vi.clearAllMocks()
    publishMock.mockReset()
    publishMock.mockImplementation(async ({relays}: {relays: string[]}) =>
      Object.fromEntries(
        relays.map(relay => [relay, makePublishOutcome(relay, publishStatuses.Success)]),
      ),
    )
  })

  describe("createEventIO", () => {
    it("getCurrentPubkey returns null when no pubkey", async () => {
      pubkeyStore.set(null)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      expect(eventIO.getCurrentPubkey()).toBeNull()
    })

    it("getCurrentPubkey returns pubkey when set", async () => {
      const pk = "a".repeat(64)
      pubkeyStore.set(pk)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      expect(eventIO.getCurrentPubkey()).toBe(pk)
    })

    it("publishEvent returns error when no signer", async () => {
      signerStore.set(null)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const result = await eventIO.publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {relays: ["wss://repo.example.com"]},
      )

      expect(result).toEqual({ok: false, error: "No signer available"})
    })

    it("publishes only to normalized explicit relays without consulting the user outbox", async () => {
      const signed = {
        id: "evt",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      const sign = vi.fn().mockResolvedValue(signed)
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const result = await eventIO.publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {
          relays: [" WSS://EXPLICIT.RELAY.EXAMPLE/path/ ", "wss://explicit.relay.example/path"],
        },
      )

      expect(result).toMatchObject({
        ok: true,
        eventId: "evt",
        relays: ["wss://explicit.relay.example/path"],
        outcomes: {
          "wss://explicit.relay.example/path": makePublishOutcome(
            "wss://explicit.relay.example/path",
            publishStatuses.Success,
          ),
        },
      })
      expect(sign).toHaveBeenCalledTimes(1)
      expect(publishMock).toHaveBeenCalledWith({
        event: signed,
        relays: ["wss://explicit.relay.example/path"],
      })
      expect(routerGetMock).not.toHaveBeenCalled()
    })

    it("fails when a relay rejects the event", async () => {
      const relay = "wss://repo.example.com"
      const signed = {
        id: "evt-rejected",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})
      const outcomes = {
        [relay]: makePublishOutcome(relay, publishStatuses.Failure, "blocked"),
      }
      publishMock.mockResolvedValueOnce(outcomes)

      const {createEventIO} = await import("./event-io")
      const result = await createEventIO().publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {relays: [relay]},
      )

      expect(result).toEqual({
        ok: false,
        eventId: signed.id,
        relays: [],
        outcomes,
        error: "Event was not accepted by any relay",
      })
    })

    it("fails when publication times out", async () => {
      const relay = "wss://repo.example.com"
      const signed = {
        id: "evt-timeout",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})
      const outcomes = {
        [relay]: makePublishOutcome(relay, publishStatuses.Timeout, "timed out"),
      }
      publishMock.mockResolvedValueOnce(outcomes)

      const {createEventIO} = await import("./event-io")
      const result = await createEventIO().publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {relays: [relay]},
      )

      expect(result).toEqual({
        ok: false,
        eventId: signed.id,
        relays: [],
        outcomes,
        error: "Event was not accepted by any relay",
      })
    })

    it.each([
      ["undefined", undefined],
      ["empty", {}],
      [
        "invalid",
        {
          "wss://repo.example.com": {
            relay: "wss://repo.example.com",
            status: "unknown",
            detail: "",
          },
        },
      ],
      [
        "non-terminal",
        {
          "wss://repo.example.com": {
            relay: "wss://repo.example.com",
            status: publishStatuses.Pending,
            detail: "waiting",
          },
        },
      ],
    ])("fails closed on a %s publication outcome map", async (_name, outcomes) => {
      const signed = {
        id: "evt-malformed",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})
      publishMock.mockResolvedValueOnce(outcomes)

      const {createEventIO} = await import("./event-io")
      const result = await createEventIO().publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {relays: ["wss://repo.example.com"]},
      )

      expect(result).toEqual({
        ok: false,
        eventId: signed.id,
        error: "Publisher returned malformed relay outcomes",
      })
    })

    it("returns success and only accepted relays for mixed publication outcomes", async () => {
      const acceptedRelay = "wss://accepted.example.com"
      const rejectedRelay = "wss://rejected.example.com"
      const timeoutRelay = "wss://timeout.example.com"
      const signed = {
        id: "evt-mixed",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})
      const outcomes = {
        [acceptedRelay]: makePublishOutcome(acceptedRelay, publishStatuses.Success, "stored"),
        [rejectedRelay]: makePublishOutcome(rejectedRelay, publishStatuses.Failure, "blocked"),
        [timeoutRelay]: makePublishOutcome(timeoutRelay, publishStatuses.Timeout, "timed out"),
      }
      publishMock.mockResolvedValueOnce(outcomes)

      const {createEventIO} = await import("./event-io")
      const result = await createEventIO().publishEvent(
        {kind: 1, content: "", created_at: 0, tags: []},
        {relays: [acceptedRelay, rejectedRelay, timeoutRelay]},
      )

      expect(result).toEqual({
        ok: true,
        eventId: signed.id,
        relays: [acceptedRelay],
        outcomes,
      })
    })

    it("rejects an empty publish scope before signer or publisher work", async () => {
      const sign = vi.fn()
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()
      const result = await eventIO.publishEvent(
        {kind: 30618, content: "", created_at: 0, tags: [["d", "repo"]]},
        {relays: ["", "https://github.com/owner/repo.git"]},
      )

      expect(result).toEqual({
        ok: false,
        error: "Repository EventIO requires at least one explicit relay",
      })
      expect(sign).not.toHaveBeenCalled()
      expect(publishMock).not.toHaveBeenCalled()
      expect(routerGetMock).not.toHaveBeenCalled()
    })

    it("rejects a relayless repository announcement before signing", async () => {
      const sign = vi.fn()
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()
      const result = await eventIO.publishEvent(
        {kind: 30617, content: "", created_at: 0, tags: [["d", "repo"]]},
        {relays: ["wss://discovery.example.com"]},
      )

      expect(result).toEqual({
        ok: false,
        error: "Repository announcements must declare at least one valid relay",
      })
      expect(sign).not.toHaveBeenCalled()
      expect(publishMock).not.toHaveBeenCalled()
    })

    it("rejects repository announcement relays outside the publication scope before signing", async () => {
      const sign = vi.fn()
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()
      const result = await eventIO.publishEvent(
        {
          kind: 30617,
          content: "",
          created_at: 0,
          tags: [["relays", "wss://repo.example.com", "wss://missing.example.com"]],
        },
        {relays: ["wss://repo.example.com"]},
      )

      expect(result).toEqual({
        ok: false,
        error: "Repository announcement relays must be included in the publication scope",
      })
      expect(sign).not.toHaveBeenCalled()
      expect(publishMock).not.toHaveBeenCalled()
    })

    it("allows extra discovery relays when a declared repository relay accepts", async () => {
      const repoRelay = "wss://repo.example.com"
      const discoveryRelay = "wss://discovery.example.com"
      const signed = {
        id: "evt-announcement",
        kind: 30617,
        content: "",
        created_at: 0,
        tags: [["relays", repoRelay]],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})
      const repoOutcomes = {
        [repoRelay]: makePublishOutcome(repoRelay, publishStatuses.Success, "stored"),
      }
      const discoveryOutcomes = {
        [discoveryRelay]: makePublishOutcome(discoveryRelay, publishStatuses.Failure, "blocked"),
      }
      publishMock.mockResolvedValueOnce(repoOutcomes).mockResolvedValueOnce(discoveryOutcomes)

      const {createEventIO} = await import("./event-io")
      const result = await createEventIO().publishEvent(
        {kind: 30617, content: "", created_at: 0, tags: [["relays", repoRelay]]},
        {relays: [repoRelay, discoveryRelay]},
      )

      expect(result).toEqual({
        ok: true,
        eventId: signed.id,
        relays: [repoRelay],
        outcomes: {...repoOutcomes, ...discoveryOutcomes},
      })
      expect(publishMock).toHaveBeenNthCalledWith(1, {
        event: signed,
        relays: [repoRelay],
      })
      expect(publishMock).toHaveBeenNthCalledWith(2, {
        event: signed,
        relays: [discoveryRelay],
      })
    })

    it("fails a repository announcement when only an extra discovery relay accepts", async () => {
      const repoRelay = "wss://repo.example.com"
      const discoveryRelay = "wss://discovery.example.com"
      const signed = {
        id: "evt-announcement",
        kind: 30617,
        content: "",
        created_at: 0,
        tags: [["relays", repoRelay]],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})
      const outcomes = {
        [repoRelay]: makePublishOutcome(repoRelay, publishStatuses.Failure, "blocked"),
      }
      publishMock.mockResolvedValueOnce(outcomes)

      const {createEventIO} = await import("./event-io")
      const result = await createEventIO().publishEvent(
        {kind: 30617, content: "", created_at: 0, tags: [["relays", repoRelay]]},
        {relays: [repoRelay, discoveryRelay]},
      )

      expect(result).toEqual({
        ok: false,
        eventId: signed.id,
        relays: [],
        outcomes,
        error: "Repository announcement was not accepted by any declared relay",
      })
      expect(publishMock).toHaveBeenCalledOnce()
      expect(publishMock).toHaveBeenCalledWith({event: signed, relays: [repoRelay]})
    })

    it("rejects a signer that changes relay policy fields", async () => {
      const repoRelay = "wss://repo.example.com"
      const sign = vi.fn().mockResolvedValue({
        id: "evt-mutated",
        kind: 30617,
        content: "",
        created_at: 0,
        tags: [["relays", "wss://different.example.com"]],
        pubkey: "a".repeat(64),
        sig: "sig",
      })
      signerStore.set({sign})

      const {createEventIO} = await import("./event-io")
      const result = await createEventIO().publishEvent(
        {kind: 30617, content: "", created_at: 0, tags: [["relays", repoRelay]]},
        {relays: [repoRelay]},
      )

      expect(result).toEqual({
        ok: false,
        eventId: "evt-mutated",
        error: "Signer changed event policy fields",
      })
      expect(publishMock).not.toHaveBeenCalled()
    })

    it("fetches only from normalized explicit relays and rejects an empty fetch scope", async () => {
      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()
      const filters = [{kinds: [30618], "#d": ["repo"]}]

      await eventIO.fetchEvents(filters, {
        relays: ["wss://REPO.EXAMPLE.com/", "wss://repo.example.com"],
      })

      expect(loadMock).toHaveBeenCalledWith(
        expect.objectContaining({relays: ["wss://repo.example.com"], filters}),
      )
      expect(routerGetMock).not.toHaveBeenCalled()

      loadMock.mockClear()
      await expect(eventIO.fetchEvents(filters, {relays: []})).rejects.toThrow(
        "Repository EventIO requires at least one explicit relay",
      )
      expect(loadMock).not.toHaveBeenCalled()
    })

    it("signEvent throws when no signer", async () => {
      signerStore.set(null)

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      await expect(
        eventIO.signEvent!({kind: 1, content: "", created_at: 0, tags: []}),
      ).rejects.toThrow("No signer available")
    })

    it("signEvent returns signed event when signer available", async () => {
      const signed = {
        id: "evt",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }
      signerStore.set({sign: vi.fn().mockResolvedValue(signed)})

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const result = await eventIO.signEvent!({kind: 1, content: "", created_at: 0, tags: []})

      expect(result).toEqual(signed)
    })

    it("publishEvents applies per-relay success semantics to each event", async () => {
      const relay = "wss://repo.example.com"
      const sign = vi.fn().mockImplementation(async unsigned => ({
        ...unsigned,
        id: `evt-${unsigned.content}`,
        pubkey: "a".repeat(64),
        sig: "sig",
      }))
      signerStore.set({sign})
      publishMock.mockImplementation(async ({event}: {event: {id: string}}) => {
        const status = event.id === "evt-a" ? publishStatuses.Success : publishStatuses.Timeout
        return {
          [relay]: makePublishOutcome(
            relay,
            status,
            status === publishStatuses.Success ? "stored" : "timed out",
          ),
        }
      })

      const {createEventIO} = await import("./event-io")
      const eventIO = createEventIO()

      const results = await eventIO.publishEvents(
        [
          {kind: 1, content: "a", created_at: 0, tags: []},
          {kind: 1, content: "b", created_at: 0, tags: []},
        ],
        {relays: [relay]},
      )

      expect(results).toEqual([
        {
          ok: true,
          eventId: "evt-a",
          relays: [relay],
          outcomes: {
            [relay]: makePublishOutcome(relay, publishStatuses.Success, "stored"),
          },
        },
        {
          ok: false,
          eventId: "evt-b",
          relays: [],
          outcomes: {
            [relay]: makePublishOutcome(relay, publishStatuses.Timeout, "timed out"),
          },
          error: "Event was not accepted by any relay",
        },
      ])
      expect(sign).toHaveBeenCalledTimes(2)
      expect(publishMock).toHaveBeenCalledTimes(2)
    })
  })
})
