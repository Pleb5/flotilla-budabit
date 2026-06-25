import {beforeEach, describe, expect, it, vi} from "vitest"

const mockPublishThunk = vi.fn((_opts?: unknown) => ({complete: Promise.resolve()}))
const mockPublishDelete = vi.fn((_opts?: unknown) => ({complete: Promise.resolve()}))
const mockLoad = vi.fn().mockResolvedValue(undefined)

vi.mock("@welshman/app", async importOriginal => {
  const actual = await importOriginal<typeof import("@welshman/app")>()
  return {
    ...actual,
    publishThunk: (opts?: unknown) => mockPublishThunk(opts),
    abortThunk: vi.fn(),
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
  return {...actual, load: (opts?: unknown) => mockLoad(opts)}
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
