import {beforeEach, describe, expect, it, vi} from "vitest"

const makeMockThunk = (options: any = {}) => ({
  complete: Promise.resolve(),
  event: options.event,
  options: {...options, relays: options.relays || []},
})
const mockPublishThunk = vi.fn((options?: unknown) => makeMockThunk(options))
const mockPublishDelete = vi.fn((options?: any) =>
  makeMockThunk({
    ...options,
    event: {
      id: `delete-${options?.event?.id || "event"}`,
      kind: 5,
      content: "",
      created_at: 1,
      tags: [["e", options?.event?.id || ""]],
      pubkey: options?.event?.pubkey || "a".repeat(64),
      sig: "delete-signature",
    },
  }),
)
const mockLoad = vi.fn().mockResolvedValue(undefined)
const mockPublish = vi.fn()
const mockRepositoryPublish = vi.fn()
const mockRepositoryQuery = vi.fn((..._args: any[]): any[] => [])
const mockSignerSign = vi.fn()
const mockRetryThunk = vi.fn((thunk: any) => makeMockThunk({...thunk.options, event: thunk.event}))
const mockWaitForAnyRelayAck = vi.fn()
const mockAbortThunk = vi.fn()

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  return {
    ...actual,
    publishThunk: (opts?: unknown) => mockPublishThunk(opts),
    abortThunk: (thunk: unknown) => mockAbortThunk(thunk),
    retryThunk: (thunk: unknown) => mockRetryThunk(thunk),
    waitForAnyRelayAck: (thunk: unknown, relays?: string[]) =>
      mockWaitForAnyRelayAck(thunk, relays),
    pubkey: {...actual.pubkey, get: () => "a".repeat(64)},
    signer: {
      ...actual.signer,
      get: () => ({sign: mockSignerSign}),
    },
    repository: {
      ...actual.repository,
      query: mockRepositoryQuery,
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
    mockPublishThunk.mockReset()
    mockPublishThunk.mockImplementation((options?: unknown) => makeMockThunk(options))
    mockPublishDelete.mockReset()
    mockPublishDelete.mockImplementation((options?: any) =>
      makeMockThunk({
        ...options,
        event: {
          id: `delete-${options?.event?.id || "event"}`,
          kind: 5,
          content: "",
          created_at: 1,
          tags: [["e", options?.event?.id || ""]],
          pubkey: options?.event?.pubkey || "a".repeat(64),
          sig: "delete-signature",
        },
      }),
    )
    mockLoad.mockReset()
    mockLoad.mockResolvedValue(undefined)
    mockPublish.mockReset()
    mockRepositoryPublish.mockReset()
    mockRepositoryQuery.mockReset()
    mockRepositoryQuery.mockReturnValue([])
    mockSignerSign.mockReset()
    mockRetryThunk.mockReset()
    mockRetryThunk.mockImplementation((thunk: any) =>
      makeMockThunk({...thunk.options, event: thunk.event}),
    )
    mockWaitForAnyRelayAck.mockReset()
    mockWaitForAnyRelayAck.mockResolvedValue({relay: "wss://relay.example.com/"})
    mockAbortThunk.mockReset()
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
        tags: [
          ["d", "repo"],
          ["relays", "wss://grasp.example.com"],
        ],
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
        tags: [
          ["d", "repo"],
          ["relays", relay],
        ],
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
        tags: [
          ["d", "repo"],
          ["relays", relay],
        ],
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
        tags: [
          ["d", "repo"],
          ["relays", relay],
        ],
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
        tags: [
          ["d", "repo"],
          ["relays", relay],
        ],
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
        tags: [
          ["d", "repo"],
          ["relays", relay],
        ],
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
        tags: [
          ["d", "repo"],
          ["relays", relay],
        ],
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

  describe("publishRepoEventAfterAck", () => {
    it("pre-signs, waits for a successful ACK, and only then commits locally", async () => {
      const {publishRepoEventAfterAck} = await import("./git-commands")
      const owner = "a".repeat(64)
      const repoAddress = `30617:${owner}:repo`
      const relay = "wss://relay.example.com/"
      const signedEvent = {
        id: "signed-comment",
        kind: 1111,
        content: "comment",
        created_at: 1,
        tags: [["a", repoAddress]],
        pubkey: owner,
        sig: "signature",
      }
      let acknowledge!: () => void

      mockSignerSign.mockResolvedValue(signedEvent)
      mockWaitForAnyRelayAck.mockImplementation(
        () =>
          new Promise(resolve => {
            acknowledge = () => resolve({relay})
          }),
      )

      const publication = publishRepoEventAfterAck({
        publication: "comment",
        rootId: "issue-ack-timing",
        event: {
          kind: 1111,
          content: "comment",
          created_at: 1,
          tags: [["a", repoAddress]],
        } as any,
        relays: [relay],
        repoAddress,
      })

      await vi.waitFor(() => expect(mockPublishThunk).toHaveBeenCalledOnce())
      expect(mockSignerSign.mock.invocationCallOrder[0]).toBeLessThan(
        mockPublishThunk.mock.invocationCallOrder[0],
      )
      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({event: signedEvent, optimistic: false}),
      )
      expect(mockRepositoryPublish).not.toHaveBeenCalled()

      acknowledge()
      await publication

      expect(mockRepositoryPublish).toHaveBeenCalledWith(signedEvent)
    })

    it("retries the exact retained signed thunk for the same semantic comment", async () => {
      const {publishRepoEventAfterAck} = await import("./git-commands")
      const owner = "a".repeat(64)
      const repoAddress = `30617:${owner}:repo`
      const relay = "wss://relay.example.com/"
      const signedEvent = {
        id: "signed-retry-comment",
        kind: 1111,
        content: "retry me",
        created_at: 1,
        tags: [["a", repoAddress]],
        pubkey: owner,
        sig: "signature",
      }

      mockSignerSign.mockResolvedValue(signedEvent)
      mockWaitForAnyRelayAck.mockRejectedValueOnce(new Error("relay rejected"))

      const params = {
        publication: "comment" as const,
        rootId: "issue-exact-comment-retry",
        event: {
          kind: 1111,
          content: "retry me",
          created_at: 1,
          tags: [["a", repoAddress]],
        } as any,
        relays: [relay],
        repoAddress,
      }

      await expect(publishRepoEventAfterAck(params)).rejects.toThrow("relay rejected")
      const failedThunk = mockPublishThunk.mock.results[0]?.value

      await publishRepoEventAfterAck({
        ...params,
        event: {...params.event, created_at: 2},
      })

      expect(mockSignerSign).toHaveBeenCalledTimes(1)
      expect(mockRetryThunk).toHaveBeenCalledWith(failedThunk)
      expect(mockRetryThunk.mock.results[0]?.value.event).toBe(signedEvent)
      expect(mockRepositoryPublish).toHaveBeenCalledWith(signedEvent)
    })
  })

  describe("repository publication circuit breaker", () => {
    const owner = "a".repeat(64)
    const repoAddress = `30617:${owner}:repo`
    const relay = "wss://repo.example.com/"

    it("fails before signing, local insertion, or network work when scope is empty", async () => {
      const {publishRepoEventWithRelayOutcomes} = await import("./git-commands")
      const event = {
        kind: 30618,
        content: "",
        created_at: 1,
        tags: [["d", "repo"]],
      }

      await expect(
        publishRepoEventWithRelayOutcomes(event as any, ["not-a-relay"], {repoAddress}),
      ).rejects.toThrow("requires at least one valid relay declared")
      expect(mockSignerSign).not.toHaveBeenCalled()
      expect(mockRepositoryPublish).not.toHaveBeenCalled()
      expect(mockPublish).not.toHaveBeenCalled()
    })

    it("accepts repeated same-repository coordinates across supported tags", async () => {
      const {postIssue} = await import("./git-commands")
      const issue = {
        id: "issue",
        kind: 1621,
        content: "",
        created_at: 1,
        pubkey: owner,
        sig: "sig",
        tags: [
          ["a", repoAddress],
          ["A", repoAddress],
          ["q", repoAddress],
          ["repo", repoAddress],
        ],
      }

      postIssue(issue as any, [relay], repoAddress)

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({event: issue, relays: [relay]}),
      )
    })

    it("rejects conflicting repository coordinates before thunk creation", async () => {
      const {postIssue} = await import("./git-commands")
      const issue = {
        id: "issue",
        kind: 1621,
        content: "",
        created_at: 1,
        pubkey: owner,
        sig: "sig",
        tags: [
          ["a", repoAddress],
          ["q", `30617:${"b".repeat(64)}:other`],
        ],
      }

      expect(() => postIssue(issue as any, [relay], repoAddress)).toThrow(
        "conflicting repository coordinates",
      )
      expect(mockPublishThunk).not.toHaveBeenCalled()
    })

    it("requires an announcement relay before using broad discovery destinations", async () => {
      const {postRepoAnnouncement} = await import("./git-commands")
      const relayless = {
        id: "repo",
        kind: 30617,
        content: "",
        created_at: 1,
        pubkey: owner,
        sig: "sig",
        tags: [["d", "repo"]],
      }

      expect(() => postRepoAnnouncement(relayless as any, [relay])).toThrow(
        "must declare at least one valid repository relay",
      )
      expect(mockPublishThunk).not.toHaveBeenCalled()

      const declared = {...relayless, tags: [...relayless.tags, ["relays", relay]]}
      postRepoAnnouncement(declared as any, [relay])
      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: declared,
          relays: [relay, "wss://announcement.example/"],
        }),
      )
    })

    it("does not create an optimistic thunk for empty repository relays", async () => {
      const {publishEvent} = await import("./git-commands")
      const event = {
        id: "event",
        kind: 1624,
        content: "",
        created_at: 1,
        pubkey: owner,
        sig: "sig",
        tags: [["a", repoAddress]],
      }

      expect(() => publishEvent(event as any, [], repoAddress)).toThrow(
        "requires at least one valid relay declared",
      )
      expect(mockPublishThunk).not.toHaveBeenCalled()
      expect(mockRepositoryPublish).not.toHaveBeenCalled()
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
        tags: [
          ["d", "repo"],
          ["relays", "wss://repo.example/"],
        ],
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
      mockRepositoryQuery.mockReturnValue([labelEvent] as any)

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
      expect(mockPublishDelete.mock.calls.map(([options]) => options.event.id)).toEqual([
        labelEvent.id,
        issue.id,
      ])
      expect(mockPublishDelete).toHaveBeenCalledWith(expect.objectContaining({optimistic: false}))
      expect(mockRepositoryPublish.mock.calls.map(([event]) => event.id)).toEqual([
        `delete-${labelEvent.id}`,
        `delete-${issue.id}`,
      ])
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

    it("does not treat thunk completion without relay success as acknowledgement", async () => {
      const {deleteIssueWithLabels} = await import("./git-commands")
      const issue = {
        id: "issue-complete-without-success",
        kind: 1621,
        pubkey: "a".repeat(64),
        tags: [],
        content: "",
        created_at: 0,
        sig: "",
      } as any

      mockWaitForAnyRelayAck.mockRejectedValue(new Error("No target relay acknowledged"))

      await expect(
        deleteIssueWithLabels({issue, relays: ["wss://relay.example.com"]}),
      ).rejects.toThrow("No target relay acknowledged")

      expect(mockPublishDelete.mock.results[0]?.value.complete).toBeInstanceOf(Promise)
      await expect(mockPublishDelete.mock.results[0]?.value.complete).resolves.toBeUndefined()
      expect(mockRepositoryPublish).not.toHaveBeenCalled()
    })

    it("commits a delete locally only after its relay ACK", async () => {
      const {deleteIssueWithLabels} = await import("./git-commands")
      const issue = {
        id: "issue-delete-ack-timing",
        kind: 1621,
        pubkey: "a".repeat(64),
        tags: [],
        content: "",
        created_at: 0,
        sig: "",
      } as any
      let acknowledge!: () => void

      mockWaitForAnyRelayAck.mockImplementation(
        () =>
          new Promise(resolve => {
            acknowledge = () => resolve({relay: "wss://relay.example.com/"})
          }),
      )

      const deletion = deleteIssueWithLabels({
        issue,
        relays: ["wss://relay.example.com"],
      })

      await vi.waitFor(() => expect(mockWaitForAnyRelayAck).toHaveBeenCalledOnce())
      expect(mockRepositoryPublish).not.toHaveBeenCalled()

      acknowledge()
      await deletion

      expect(mockRepositoryPublish).toHaveBeenCalledWith(
        expect.objectContaining({id: `delete-${issue.id}`}),
      )
    })

    it("skips an acknowledged related delete and retries the exact failed root delete", async () => {
      const {deleteIssueWithLabels} = await import("./git-commands")
      const issue = {
        id: "issue-exact-delete-retry",
        kind: 1621,
        pubkey: "a".repeat(64),
        tags: [],
        content: "",
        created_at: 0,
        sig: "",
      } as any
      const labelEvent = {
        id: "label-exact-delete-retry",
        kind: 1985,
        pubkey: issue.pubkey,
        tags: [["e", issue.id]],
        content: "",
        created_at: 0,
        sig: "",
      } as any

      mockRepositoryQuery.mockReturnValue([labelEvent])
      mockWaitForAnyRelayAck
        .mockResolvedValueOnce({relay: "wss://relay.example.com/"})
        .mockRejectedValueOnce(new Error("root rejected"))

      await expect(
        deleteIssueWithLabels({issue, relays: ["wss://relay.example.com"]}),
      ).rejects.toThrow("root rejected")

      const failedRootThunk = mockPublishDelete.mock.results[1]?.value
      expect(mockRepositoryPublish).toHaveBeenCalledWith(
        expect.objectContaining({id: `delete-${labelEvent.id}`}),
      )
      expect(mockRepositoryPublish).not.toHaveBeenCalledWith(
        expect.objectContaining({id: `delete-${issue.id}`}),
      )

      mockWaitForAnyRelayAck.mockResolvedValue({relay: "wss://relay.example.com/"})
      await deleteIssueWithLabels({issue, relays: ["wss://relay.example.com"]})

      expect(mockPublishDelete).toHaveBeenCalledTimes(2)
      expect(mockRetryThunk).toHaveBeenCalledTimes(1)
      expect(mockRetryThunk).toHaveBeenCalledWith(failedRootThunk)
      expect(mockRetryThunk.mock.results[0]?.value.event).toBe(failedRootThunk.event)
      expect(mockRepositoryPublish).toHaveBeenCalledWith(
        expect.objectContaining({id: `delete-${issue.id}`}),
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

      mockWaitForAnyRelayAck.mockImplementation(() => new Promise<void>(() => {}))

      const controller = new AbortController()
      const deletion = deletePullRequestWithRelated({
        root,
        relays: ["wss://relay.example.com"],
        signal: controller.signal,
      })

      await vi.waitFor(() => expect(mockWaitForAnyRelayAck).toHaveBeenCalledOnce())
      controller.abort()

      await expect(deletion).rejects.toMatchObject({name: "AbortError"})
      expect(mockAbortThunk).toHaveBeenCalledOnce()
    })

    it("deletes same-author related events before the pull request root", async () => {
      const {deletePullRequestWithRelated} = await import("./git-commands")
      const root = {
        id: "pr-root-last",
        kind: 1618,
        pubkey: "a".repeat(64),
        tags: [],
        content: "",
        created_at: 0,
        sig: "",
      } as any
      const comment = {
        id: "pr-root-last-comment",
        kind: 1111,
        pubkey: root.pubkey,
        tags: [["E", root.id]],
        content: "comment",
        created_at: 1,
        sig: "",
      } as any
      const otherAuthorComment = {
        ...comment,
        id: "other-author-comment",
        pubkey: "b".repeat(64),
      }
      mockRepositoryQuery.mockReturnValue([root, comment, otherAuthorComment])

      const result = await deletePullRequestWithRelated({
        root,
        relays: ["wss://relay.example.com"],
      })

      expect(result).toEqual({deletedEvents: 2, relatedDeleted: 1})
      expect(mockPublishDelete.mock.calls.map(([options]) => options.event.id)).toEqual([
        comment.id,
        root.id,
      ])
    })
  })
})
