import {beforeEach, describe, expect, it, vi} from "vitest"

const mockPublishThunk = vi.fn((_opts?: unknown) => ({complete: Promise.resolve()}))
vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  return {
    ...actual,
    publishThunk: (opts?: unknown) => mockPublishThunk(opts),
    repository: {...actual.repository, query: vi.fn(() => [])},
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
  return {...actual, load: vi.fn().mockResolvedValue(undefined)}
})

vi.mock("@app/core/commands", () => ({
  publishDelete: vi.fn(() => ({complete: Promise.resolve()})),
}))

describe("budabit commands", () => {
  beforeEach(() => {
    mockPublishThunk.mockClear()
  })

  describe("publishEvent", () => {
    it("merges relays with user and GIT_RELAYS", async () => {
      const {publishEvent} = await import("./commands")
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
          relays: expect.arrayContaining([
            "wss://custom.relay.com",
            "wss://user.relay.example.com",
          ]),
        }),
      )
    })
  })

  describe("postComment", () => {
    it("calls publishThunk with comment and relays", async () => {
      const {postComment} = await import("./commands")
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
          relays: expect.any(Array),
        }),
      )
    })
  })

  describe("postGraspServersList", () => {
    it("merges user relays with GIT_RELAYS", async () => {
      const {postGraspServersList} = await import("./commands")
      const graspEvent = {
        id: "g1",
        kind: 0,
        content: "",
        created_at: 0,
        tags: [],
        pubkey: "a".repeat(64),
        sig: "sig",
      } as any

      postGraspServersList(graspEvent)

      expect(mockPublishThunk).toHaveBeenCalledWith(
        expect.objectContaining({
          event: graspEvent,
          relays: expect.arrayContaining(["wss://user.relay.example.com"]),
        }),
      )
    })
  })

  describe("deleteIssueWithLabels", () => {
    it("returns labelsDeleted 0 when issue is null", async () => {
      const {deleteIssueWithLabels} = await import("./commands")

      const result = await deleteIssueWithLabels({issue: null as any})

      expect(result).toEqual({labelsDeleted: 0})
    })

    it("returns labelsDeleted 0 when issue kind is not 1621", async () => {
      const {deleteIssueWithLabels} = await import("./commands")
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
  })
})
