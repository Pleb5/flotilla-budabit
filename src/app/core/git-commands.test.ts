import {beforeEach, describe, expect, it, vi} from "vitest"

const mockPublishThunk = vi.fn((_opts?: unknown) => ({complete: Promise.resolve()}))
const mockPublishDelete = vi.fn((_opts?: unknown) => ({complete: Promise.resolve()}))
const mockLoad = vi.fn().mockResolvedValue(undefined)
const mockPublish = vi.fn()
const mockRepositoryPublish = vi.fn()
const mockSignerSign = vi.fn()

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  return {
    ...actual,
    publishThunk: (opts?: unknown) => mockPublishThunk(opts),
    abortThunk: vi.fn(),
    pubkey: {...actual.pubkey, get: () => "a".repeat(64)},
    signer: {
      ...actual.signer,
      get: () => ({sign: mockSignerSign}),
    },
    repository: {
      ...actual.repository,
      query: vi.fn(() => []),
      publish: (event: unknown) => mockRepositoryPublish(event),
    },
  }
})

vi.mock("@welshman/router", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/router")>()
  return {
    ...actual,
    Router: {
      ...actual.Router,
      get: vi.fn(() => ({
        FromUser: () => ({getUrls: () => ["wss://user.relay.example.com"]}),
      })),
    },
  }
})

vi.mock("@welshman/net", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/net")>()
  return {
    ...actual,
    load: (opts?: unknown) => mockLoad(opts),
    publish: (opts?: unknown) => mockPublish(opts),
  }
})

vi.mock("@app/core/commands", () => ({
  publishDelete: (opts?: unknown) => mockPublishDelete(opts),
}))

vi.mock("@app/core/community-relays", () => ({
  getUserDataPublishRelays: (relays: string[]) => [...relays, "wss://community.example.com"],
}))

vi.mock("./git-state", () => ({
  GIT_RELAYS: [],
  getRepoAnnouncementPublishRelays: ({repoRelays = []}: {repoRelays?: string[]}) => [
    ...repoRelays,
    "wss://announcement.example/",
  ],
}))

describe("budabit commands", () => {
  beforeEach(() => {
    mockPublishThunk.mockClear()
    mockPublishDelete.mockReset()
    mockPublishDelete.mockReturnValue({complete: Promise.resolve()})
    mockLoad.mockReset()
    mockLoad.mockResolvedValue(undefined)
    mockPublish.mockReset()
    mockRepositoryPublish.mockReset()
    mockSignerSign.mockReset()
  })

  describe("publishEvent", () => {
    it("uses only provided relays for repo-bound publish", async () => {
      const {publishEvent} = await import("./git-commands")
      const event = {
        id: "evt",
        kind: 1,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      }

      publishEvent(event, ["wss://custom.relay.com"])

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event,
          relays: ["wss://custom.relay.com/"],
        }),
      )
    })
  })

  describe("publishRepoEventWithRelayOutcomes", () => {
    it("keeps native auth-required rejections hidden for Welshman retry", async () => {
      const {parseNativeRepoPublishAck} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"

      expect(
        parseNativeRepoPublishAck(relay, "event-id", [
          "OK",
          "event-id",
          false,
          "auth-required: authenticate",
        ]),
      ).toBeUndefined()
      expect(
        parseNativeRepoPublishAck(relay, "event-id", [
          "OK",
          "event-id",
          true,
          "purgatory: accepted",
        ]),
      ).toEqual({relay, ok: true, detail: "purgatory: accepted"})
    })

    it("promotes an exact native OK when the publish aggregate reports a timeout", async () => {
      const {applyNativeRepoPublishAcks} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"

      expect(
        applyNativeRepoPublishAcks({[relay]: {relay, status: "timeout", detail: "timed out"}}, [
          {relay: "wss://grasp.example.com", ok: true, detail: "purgatory"},
        ]),
      ).toEqual({
        [relay]: {relay, status: "success", detail: "purgatory"},
      })
    })

    it("does not promote an explicit native rejection", async () => {
      const {applyNativeRepoPublishAcks} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"

      expect(
        applyNativeRepoPublishAcks({[relay]: {relay, status: "timeout", detail: "timed out"}}, [
          {relay, ok: false, detail: "blocked"},
        ]),
      ).toEqual({
        [relay]: {relay, status: "failure", detail: "blocked"},
      })
    })

    it("keeps an authoritative non-timeout publish result", async () => {
      const {applyNativeRepoPublishAcks} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"

      expect(
        applyNativeRepoPublishAcks({[relay]: {relay, status: "success", detail: "accepted"}}, [
          {relay, ok: false, detail: "late rejection"},
        ]),
      ).toEqual({
        [relay]: {relay, status: "success", detail: "accepted"},
      })
    })

    it("signs once before publishing and returns detailed relay outcomes", async () => {
      const {GRASP_RELAY_ACK_TIMEOUT_MS, publishRepoEventWithRelayOutcomes} =
        await import("./git-commands")
      const unsignedEvent = {
        kind: 30617,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
      }
      const relay = "wss://grasp.example.com/"
      mockSignerSign.mockImplementation(async event => ({...(event as object), sig: "signature"}))
      mockPublish.mockResolvedValue({
        [relay]: {relay, status: "success", detail: "stored in purgatory"},
      })

      const result = await publishRepoEventWithRelayOutcomes(unsignedEvent as any, [
        "wss://grasp.example.com",
      ])
      expect(result).toEqual({
        event: expect.objectContaining({
          kind: 30617,
          pubkey: "a".repeat(64),
          sig: "signature",
        }),
        relayOutcomes: [{relay, status: "success", detail: "stored in purgatory"}],
        ackedRelays: [relay],
        failedRelays: [],
        successCount: 1,
        hasRelayOutcomes: true,
      })

      expect(mockSignerSign).toHaveBeenCalledTimes(1)
      expect(mockPublish).toHaveBeenCalledWith(
        expect.objectContaining({
          event: result.event,
          relays: [relay],
          timeout: GRASP_RELAY_ACK_TIMEOUT_MS,
          context: {pool: expect.anything()},
        }),
      )
      expect(mockRepositoryPublish).toHaveBeenCalledWith(result.event)
    })

    it("reuses an isolated pool within one repository publication transport", async () => {
      const {createRepoPublishTransport} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"
      const event = {
        kind: 30617,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
        id: "e".repeat(64),
        pubkey: "a".repeat(64),
        sig: "signature",
      }
      mockPublish.mockResolvedValue({
        [relay]: {relay, status: "success", detail: "purgatory"},
      })
      const transport = createRepoPublishTransport()

      await transport.publish(event as any, [relay])
      await transport.publish(event as any, [relay])

      expect(mockPublish.mock.calls[0]?.[0].context.pool).toBe(
        mockPublish.mock.calls[1]?.[0].context.pool,
      )
      transport.dispose()
    })

    it("evicts a timed-out socket before the operation retries", async () => {
      const net = await import("@welshman/net")
      const removeSpy = vi.spyOn(net.Pool.prototype, "remove")
      const {createRepoPublishTransport} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"
      const event = {
        kind: 30617,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
        id: "e".repeat(64),
        pubkey: "a".repeat(64),
        sig: "signature",
      }
      mockPublish.mockResolvedValue({
        [relay]: {relay, status: "timeout", detail: "timed out"},
      })
      const transport = createRepoPublishTransport()

      await transport.publish(event as any, [relay])

      expect(removeSpy).toHaveBeenCalledWith(relay)
      transport.dispose()
      removeSpy.mockRestore()
    })

    it("uses a new socket but keeps the operation pool after a timeout", async () => {
      const {createRepoPublishTransport} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"
      const event = {
        kind: 30617,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
        id: "e".repeat(64),
        pubkey: "a".repeat(64),
        sig: "signature",
      }
      const pools: any[] = []
      const sockets: any[] = []
      mockPublish
        .mockImplementationOnce(async options => {
          pools.push(options.context.pool)
          sockets.push(options.context.pool.get(relay))
          return {[relay]: {relay, status: "timeout", detail: "timed out"}}
        })
        .mockImplementationOnce(async options => {
          pools.push(options.context.pool)
          sockets.push(options.context.pool.get(relay))
          return {[relay]: {relay, status: "success", detail: "purgatory"}}
        })
      const transport = createRepoPublishTransport()

      await transport.publish(event as any, [relay])
      await transport.publish(event as any, [relay])

      expect(pools[1]).toBe(pools[0])
      expect(sockets[1]).not.toBe(sockets[0])
      transport.dispose()
    })

    it("serializes publications sharing an operation transport", async () => {
      const {createRepoPublishTransport} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"
      const event = {
        kind: 30617,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
        id: "e".repeat(64),
        pubkey: "a".repeat(64),
        sig: "signature",
      }
      let finishFirst!: () => void
      mockPublish
        .mockImplementationOnce(
          () =>
            new Promise<Record<string, {relay: string; status: string; detail: string}>>(
              resolve => {
                finishFirst = () =>
                  resolve({
                    [relay]: {relay, status: "success", detail: "first"},
                  })
              },
            ),
        )
        .mockResolvedValueOnce({
          [relay]: {relay, status: "success", detail: "second"},
        })
      const transport = createRepoPublishTransport()

      const first = transport.publish(event as any, [relay])
      const second = transport.publish(event as any, [relay])
      await vi.waitFor(() => expect(mockPublish).toHaveBeenCalledTimes(1))
      finishFirst()
      await first
      await second

      expect(mockPublish).toHaveBeenCalledTimes(2)
      transport.dispose()
    })

    it("aborts an in-flight publication when its transport is disposed", async () => {
      const {createRepoPublishTransport} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"
      const event = {
        kind: 30617,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
        id: "e".repeat(64),
        pubkey: "a".repeat(64),
        sig: "signature",
      }
      mockPublish.mockImplementation(
        options =>
          new Promise(resolve => {
            options.signal.addEventListener(
              "abort",
              () =>
                resolve({
                  [relay]: {relay, status: "aborted", detail: "aborted"},
                }),
              {once: true},
            )
          }),
      )
      const transport = createRepoPublishTransport()

      const publication = transport.publish(event as any, [relay])
      await vi.waitFor(() => expect(mockPublish).toHaveBeenCalledOnce())
      transport.dispose()

      await expect(publication).resolves.toEqual(
        expect.objectContaining({
          relayOutcomes: [{relay, status: "aborted", detail: "aborted"}],
        }),
      )
    })

    it("replays an already-signed event without invoking the signer", async () => {
      const {publishRepoEventWithRelayOutcomes} = await import("./git-commands")
      const relay = "wss://grasp.example.com/"
      const event = {
        kind: 30618,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
        id: "e".repeat(64),
        pubkey: "a".repeat(64),
        sig: "signature",
      }
      mockPublish.mockResolvedValue({
        [relay]: {relay, status: "success", detail: "duplicate: in purgatory"},
      })

      const result = await publishRepoEventWithRelayOutcomes(event as any, [relay])

      expect(result.event).toBe(event)
      expect(mockSignerSign).not.toHaveBeenCalled()
      expect(mockPublish).toHaveBeenCalledWith(expect.objectContaining({event}))
    })

    it("can defer local publication until the caller validates relay ACKs", async () => {
      const {publishRepoEventWithRelayOutcomes} = await import("./git-commands")
      const relay = "wss://relay.example.com/"
      const event = {
        kind: 30617,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
        id: "e".repeat(64),
        pubkey: "a".repeat(64),
        sig: "signature",
      }
      mockPublish.mockResolvedValue({
        [relay]: {relay, status: "failure", detail: "denied"},
      })

      await publishRepoEventWithRelayOutcomes(event as any, [relay], {publishLocally: false})

      expect(mockRepositoryPublish).not.toHaveBeenCalled()
    })
  })

  describe("postComment", () => {
    it("publishes comments only to provided relays", async () => {
      const {postComment} = await import("./git-commands")
      const comment = {
        id: "c1",
        kind: 1311,
        content: "hi",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      } as any

      postComment(comment, ["wss://relay.example.com"])

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: comment,
          relays: ["wss://relay.example.com/"],
        }),
      )
    })
  })

  describe("postIssue", () => {
    it("publishes issues only to provided repo relays", async () => {
      const {postIssue} = await import("./git-commands")
      const issue = {
        id: "i1",
        kind: 1621,
        content: "issue",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      } as any

      postIssue(issue, ["wss://repo.example.com", "wss://repo.example.com/"])

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: issue,
          relays: ["wss://repo.example.com/"],
        }),
      )
    })
  })

  describe("postStatus", () => {
    it("publishes statuses only to provided repo relays", async () => {
      const {postStatus} = await import("./git-commands")
      const status = {
        id: "s1",
        kind: 1630,
        content: "status",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      } as any

      postStatus(status, ["wss://repo.example.com"])

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: status,
          relays: ["wss://repo.example.com/"],
        }),
      )
    })
  })

  describe("postGraspServersList", () => {
    it("merges user relays with active community relays", async () => {
      const {postGraspServersList} = await import("./git-commands")
      const graspEvent = {
        id: "g1",
        kind: 10317,
        content: "",
        created_at: 0,
        tags: [["g", "wss://grasp.example"]],
        pubkey: "a".repeat(64),
        sig: "sig",
      } as any

      postGraspServersList(graspEvent)

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: graspEvent,
          relays: expect.arrayContaining([
            "wss://user.relay.example.com",
            "wss://community.example.com",
          ]),
        }),
      )
    })
  })

  describe("postRepoAnnouncement", () => {
    it("uses repo announcement publish policy", async () => {
      const {postRepoAnnouncement} = await import("./git-commands")
      const repoEvent = {
        id: "r1",
        kind: 30617,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      } as any

      postRepoAnnouncement(repoEvent, ["wss://repo.example/"])

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: repoEvent,
          relays: ["wss://repo.example/", "wss://announcement.example/"],
        }),
      )
    })
  })

  describe("deleteIssueWithLabels", () => {
    it("returns labelsDeleted 0 when issue is null", async () => {
      const {deleteIssueWithLabels} = await import("./git-commands")

      const result = await deleteIssueWithLabels({issue: null as any})

      expect(result).toEqual({labelsDeleted: 0})
    })

    it("returns labelsDeleted 0 when issue kind is not 1621", async () => {
      const {deleteIssueWithLabels} = await import("./git-commands")
      const issue = {
        id: "i1",
        kind: 1,
        pubkey: "a".repeat(64),
        tags: [],
        content: "",
        created_at: 0,
        sig: "",
      } as any

      const result = await deleteIssueWithLabels({issue})

      expect(result).toEqual({labelsDeleted: 0})
    })

    it("reports progress and waits for issue and label delete acknowledgements", async () => {
      const {deleteIssueWithLabels} = await import("./git-commands")
      const issue = {
        id: "i1",
        kind: 1621,
        pubkey: "a".repeat(64),
        tags: [],
        content: "",
        created_at: 0,
        sig: "",
      } as any
      const labelEvent = {
        id: "l1",
        kind: 1985,
        pubkey: issue.pubkey,
        tags: [["e", issue.id]],
        content: "",
        created_at: 0,
        sig: "",
      } as any

      const progress: Array<{label: string; completed: number; total: number; current?: string}> =
        []
      const app = await import("@welshman/app")
      vi.mocked(app.repository.query).mockReturnValue([labelEvent] as any)

      const result = await deleteIssueWithLabels({
        issue,
        relays: ["wss://relay.example.com"],
        onProgress: next => progress.push(next),
      })

      expect(progress[0]).toEqual({
        label: "Loading author labels...",
        completed: 0,
        total: 1,
        current: "issue",
      })

      expect(result).toEqual({labelsDeleted: 1})
      expect(mockPublishDelete).toHaveBeenCalledTimes(2)
      expect(progress).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            label: "Waiting for relay acknowledgements...",
            total: 2,
            current: "issue",
          }),
          expect.objectContaining({
            label: "Waiting for relay acknowledgements...",
            total: 2,
            current: "label",
          }),
          expect.objectContaining({label: "Delete requests acknowledged.", completed: 2, total: 2}),
        ]),
      )
    })
  })

  describe("deletePullRequestWithRelated", () => {
    it("aborts while waiting for relay acknowledgements", async () => {
      const {deletePullRequestWithRelated} = await import("./git-commands")
      const root = {
        id: "pr1",
        kind: 1618,
        pubkey: "a".repeat(64),
        tags: [],
        content: "",
        created_at: 0,
        sig: "",
      } as any

      mockPublishDelete.mockImplementation(() => ({
        complete: new Promise<void>(() => {}),
      }))

      const controller = new AbortController()
      const deletion = deletePullRequestWithRelated({
        root,
        relays: ["wss://relay.example.com"],
        signal: controller.signal,
      })

      controller.abort()

      await expect(deletion).rejects.toMatchObject({name: "AbortError"})
    })
  })
})
