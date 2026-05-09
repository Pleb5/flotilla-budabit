import {describe, it, expect} from "vitest"
import {
  GIT_PULL_REQUEST,
  GIT_PULL_REQUEST_UPDATE,
  GIT_COVER_LETTER,
  GIT_USER_GRASP_LIST,
  type PullRequestEvent,
  type PullRequestUpdateEvent,
  type UserGraspListEvent,
} from "../src/events/nip34/nip34.js"
import {
  createPullRequestEvent,
  createPullRequestUpdateEvent,
  createUserGraspListEvent,
  parsePullRequestEvent,
  parsePullRequestUpdateEvent,
  parseUserGraspListEvent,
  isPullRequestEvent,
  isPullRequestUpdateEvent,
  isUserGraspListEvent,
  getNostrKindLabel,
} from "../src/events/nip34/nip34-utils.js"
import {
  validatePullRequestEvent,
  validatePullRequestUpdateEvent,
  validateUserGraspListEvent,
} from "../src/utils/validation.js"

describe("NIP-34 Pull Request Events", () => {
  describe("Constants", () => {
    it("should have correct kind values", () => {
      expect(GIT_PULL_REQUEST).toBe(1618)
      expect(GIT_PULL_REQUEST_UPDATE).toBe(1619)
      expect(GIT_COVER_LETTER).toBe(1624)
      expect(GIT_USER_GRASP_LIST).toBe(10317)
    })
  })

  describe("Type Guards", () => {
    it("should identify pull request events", () => {
      const event: PullRequestEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:repo-id"],
          ["r", "https://github.com/user/repo"],
          ["p", "author-pubkey"],
          ["subject", "PR Title"],
          ["t", "bug"],
          ["c", "commit-hash"],
          ["clone", "https://github.com/user/repo"],
          ["branch-name", "feature-branch"],
          ["e", "event-id"],
          ["merge-base", "base-commit"],
        ],
        content: "PR description in markdown",
        sig: "test-sig",
      }

      expect(isPullRequestEvent(event)).toBe(true)
      expect(isPullRequestUpdateEvent(event)).toBe(false)
      expect(isUserGraspListEvent(event)).toBe(false)
    })

    it("should identify pull request update events", () => {
      const event: PullRequestUpdateEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo-id"],
          ["E", "pr-root-id"],
          ["P", "pr-author-pubkey"],
          ["r", "https://github.com/user/repo"],
          ["p", "author-pubkey"],
          ["c", "commit-hash"],
          ["clone", "https://github.com/user/repo"],
          ["merge-base", "base-commit"],
        ],
        content: "",
        sig: "test-sig",
      }

      expect(isPullRequestUpdateEvent(event)).toBe(true)
      expect(isPullRequestEvent(event)).toBe(false)
      expect(isUserGraspListEvent(event)).toBe(false)
    })

    it("should identify user grasp list events", () => {
      const event: UserGraspListEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_USER_GRASP_LIST,
        tags: [["g", "https://grasp.example.com"]],
        content: "",
        sig: "test-sig",
      }

      expect(isUserGraspListEvent(event)).toBe(true)
      expect(isPullRequestEvent(event)).toBe(false)
      expect(isPullRequestUpdateEvent(event)).toBe(false)
    })
  })

  describe("Event Creation", () => {
    it("should create pull request events", () => {
      const event = createPullRequestEvent({
        repoAddr: "30617:test-repo",
        recipients: ["author-pubkey"],
        subject: "PR Title",
        labels: ["bug"],
        tipCommitOid: "commit-hash",
        clone: ["https://github.com/user/repo"],
        branchName: "feature-branch",
        mergeBase: "base-commit",
        content: "PR description",
      })

      expect(event.kind).toBe(GIT_PULL_REQUEST)
      expect(event.content).toBe("PR description")
      expect(event.tags).toContainEqual(["a", "30617:test-repo"])
      expect(event.tags).toContainEqual(["p", "author-pubkey"])
      expect(event.tags).toContainEqual(["subject", "PR Title"])
      expect(event.tags).toContainEqual(["t", "bug"])
      expect(event.tags).toContainEqual(["c", "commit-hash"])
      expect(event.tags).toContainEqual(["clone", "https://github.com/user/repo"])
      expect(event.tags).toContainEqual(["branch-name", "feature-branch"])
      expect(event.tags).toContainEqual(["merge-base", "base-commit"])
    })

    it("should create pull request update events", () => {
      const event = createPullRequestUpdateEvent({
        repoAddr: "30617:test-repo",
        pullRequestEventId: "pr-event-123",
        pullRequestAuthorPubkey: "pr-author-pubkey",
        recipients: ["author-pubkey"],
        tipCommitOid: "commit-hash",
        clone: ["https://github.com/user/repo"],
        mergeBase: "base-commit",
      })

      expect(event.kind).toBe(GIT_PULL_REQUEST_UPDATE)
      expect(event.content).toBe("")
      expect(event.tags).toContainEqual(["a", "30617:test-repo"])
      expect(event.tags).toContainEqual(["E", "pr-event-123"])
      expect(event.tags).toContainEqual(["P", "pr-author-pubkey"])
      expect(event.tags).toContainEqual(["p", "author-pubkey"])
      expect(event.tags).toContainEqual(["c", "commit-hash"])
      expect(event.tags).toContainEqual(["clone", "https://github.com/user/repo"])
      expect(event.tags).toContainEqual(["merge-base", "base-commit"])
    })

    it("should create user grasp list events", () => {
      const event = createUserGraspListEvent({
        services: ["https://grasp.example.com", "https://grasp2.example.com"],
      })

      expect(event.kind).toBe(GIT_USER_GRASP_LIST)
      expect(event.content).toBe("")
      expect(event.tags).toContainEqual(["g", "https://grasp.example.com"])
      expect(event.tags).toContainEqual(["g", "https://grasp2.example.com"])
    })
  })

  describe("Event Parsing", () => {
    it("should parse pull request events", () => {
      const event: PullRequestEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:repo-id"],
          ["r", "https://github.com/user/repo"],
          ["p", "author-pubkey"],
          ["subject", "PR Title"],
          ["t", "bug"],
          ["c", "commit-hash"],
          ["clone", "https://github.com/user/repo"],
          ["branch-name", "feature-branch"],
          ["e", "event-id"],
          ["merge-base", "base-commit"],
        ],
        content: "PR description",
        sig: "test-sig",
      }

      const parsed = parsePullRequestEvent(event)
      expect(parsed.repoId).toBe("30617:repo-id")
      expect(parsed.subject).toBe("PR Title")
      expect(parsed.labels).toEqual(["bug"])
      expect(parsed.tipCommitOid).toBe("commit-hash")
      expect(parsed.branchName).toBe("feature-branch")
      expect(parsed.mergeBase).toBe("base-commit")
      expect(parsed.content).toBe("PR description")
      expect(parsed.author.pubkey).toBe("test-pubkey")
    })

    it("should parse pull request update events", () => {
      const event: PullRequestUpdateEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo-id"],
          ["E", "pr-root-event-id"],
          ["P", "pr-author-pubkey"],
          ["r", "https://github.com/user/repo"],
          ["p", "author-pubkey"],
          ["c", "commit-hash"],
          ["clone", "https://github.com/user/repo"],
          ["merge-base", "base-commit"],
        ],
        content: "",
        sig: "test-sig",
      }

      const parsed = parsePullRequestUpdateEvent(event)
      expect(parsed.repoId).toBe("30617:repo-id")
      expect(parsed.pullRequestEventId).toBe("pr-root-event-id")
      expect(parsed.pullRequestAuthorPubkey).toBe("pr-author-pubkey")
      expect(parsed.tipCommitOid).toBe("commit-hash")
      expect(parsed.mergeBase).toBe("base-commit")
      expect(parsed.author.pubkey).toBe("test-pubkey")
    })

    it("should parse user grasp list events", () => {
      const event: UserGraspListEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_USER_GRASP_LIST,
        tags: [
          ["g", "https://grasp.example.com"],
          ["g", "https://grasp2.example.com"],
        ],
        content: "",
        sig: "test-sig",
      }

      const parsed = parseUserGraspListEvent(event)
      expect(parsed.services).toEqual(["https://grasp.example.com", "https://grasp2.example.com"])
    })
  })

  describe("Validation", () => {
    it("should validate pull request events", () => {
      const event: PullRequestEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:repo-id"],
          ["r", "https://github.com/user/repo"],
          ["p", "author-pubkey"],
          ["subject", "PR Title"],
          ["t", "bug"],
          ["c", "commit-hash"],
          ["clone", "https://github.com/user/repo"],
          ["branch-name", "feature-branch"],
          ["e", "event-id"],
          ["merge-base", "base-commit"],
        ],
        content: "PR description",
        sig: "test-sig",
      }

      const result = validatePullRequestEvent(event)
      expect(result.success).toBe(true)
    })

    it("should validate pull request update events", () => {
      const event: PullRequestUpdateEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo-id"],
          ["E", "pr-root-event-id"],
          ["P", "pr-author-pubkey"],
          ["r", "https://github.com/user/repo"],
          ["p", "author-pubkey"],
          ["c", "commit-hash"],
          ["clone", "https://github.com/user/repo"],
          ["merge-base", "base-commit"],
        ],
        content: "",
        sig: "test-sig",
      }

      const result = validatePullRequestUpdateEvent(event)
      expect(result.success).toBe(true)
    })

    it("should reject pull request events with multiple c tags", () => {
      const event: PullRequestEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:repo-id"],
          ["c", "tip-a"],
          ["c", "tip-b"],
        ],
        content: "PR description",
        sig: "test-sig",
      }

      const result = validatePullRequestEvent(event)
      expect(result.success).toBe(false)
    })

    it("should reject pull request update events with multiple c tags", () => {
      const event: PullRequestUpdateEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo-id"],
          ["E", "pr-root-event-id"],
          ["P", "pr-author-pubkey"],
          ["c", "tip-a"],
          ["c", "tip-b"],
        ],
        content: "",
        sig: "test-sig",
      }

      const result = validatePullRequestUpdateEvent(event)
      expect(result.success).toBe(false)
    })

    it("should validate user grasp list events", () => {
      const event: UserGraspListEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_USER_GRASP_LIST,
        tags: [["g", "https://grasp.example.com"]],
        content: "",
        sig: "test-sig",
      }

      const result = validateUserGraspListEvent(event)
      expect(result.success).toBe(true)
    })

    it("should reject invalid pull request events", () => {
      const invalidEvent = {
        id: "test-id",
        pubkey: "test-pubkey",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [
          // Missing required tags
        ],
        content: "PR description",
        sig: "test-sig",
      }

      const result = validatePullRequestEvent(invalidEvent as any)
      expect(result.success).toBe(false)
    })
  })

  describe("Kind Labels", () => {
    it("should return correct labels for new kinds", () => {
      expect(getNostrKindLabel(GIT_PULL_REQUEST)).toBe("Pull Request")
      expect(getNostrKindLabel(GIT_PULL_REQUEST_UPDATE)).toBe("Pull Request Update")
      expect(getNostrKindLabel(GIT_COVER_LETTER)).toBe("Cover Letter")
      expect(getNostrKindLabel(GIT_USER_GRASP_LIST)).toBe("User Grasp List")
    })
  })

  describe("Event Creation - Edge Cases", () => {
    it("should create minimal pull request with only required fields", () => {
      const event = createPullRequestEvent({
        repoAddr: "30617:npub123/repo",
        content: "",
        tipCommitOid: "tip-commit",
      })

      expect(event.kind).toBe(GIT_PULL_REQUEST)
      expect(event.content).toBe("")
      expect(event.tags).toContainEqual(["a", "30617:npub123/repo"])
      expect(event.tags).toContainEqual(["c", "tip-commit"])
    })

    it("should create PR with one tip commit, labels, and clone URLs", () => {
      const event = createPullRequestEvent({
        repoAddr: "30617:test-repo",
        content: "Description",
        subject: "Tip-only PR",
        labels: ["bug", "enhancement", "documentation"],
        tipCommitOid: "ghi789",
        clone: ["https://github.com/user/repo.git", "https://gitlab.com/user/repo.git"],
        recipients: ["pk1", "pk2"],
      })

      expect(event.tags.filter(t => t[0] === "c")).toHaveLength(1)
      expect(event.tags.find(t => t[0] === "c")?.[1]).toBe("ghi789")
      expect(event.tags.filter(t => t[0] === "t")).toHaveLength(3)
      expect(
        event.tags
          .filter(t => t[0] === "clone")
          .flat()
          .slice(1),
      ).toEqual(["https://github.com/user/repo.git", "https://gitlab.com/user/repo.git"])
      expect(event.tags.filter(t => t[0] === "p")).toHaveLength(2)
    })

    it("should create PR with custom created_at", () => {
      const ts = 1700000000
      const event = createPullRequestEvent({
        repoAddr: "30617:repo",
        content: "x",
        tipCommitOid: "tip",
        created_at: ts,
      })
      expect(event.created_at).toBe(ts)
    })

    it("should create PR update with only required E and P tags", () => {
      const event = createPullRequestUpdateEvent({
        repoAddr: "30617:repo",
        pullRequestEventId: "pr-abc",
        pullRequestAuthorPubkey: "author-pk",
        tipCommitOid: "tip",
      })
      expect(event.kind).toBe(GIT_PULL_REQUEST_UPDATE)
      expect(event.tags).toContainEqual(["a", "30617:repo"])
      expect(event.tags).toContainEqual(["E", "pr-abc"])
      expect(event.tags).toContainEqual(["P", "author-pk"])
    })

    it("should create PR update with one tip commit", () => {
      const event = createPullRequestUpdateEvent({
        repoAddr: "30617:repo",
        pullRequestEventId: "pr-id",
        pullRequestAuthorPubkey: "author",
        tipCommitOid: "c3",
      })
      const cTags = event.tags.filter(t => t[0] === "c")
      expect(cTags).toHaveLength(1)
      expect(cTags.map(t => t[1])).toEqual(["c3"])
    })
  })

  describe("Type Guards - Rejection", () => {
    it("should reject non-PR events for isPullRequestEvent", () => {
      expect(isPullRequestEvent({kind: 1621} as any)).toBe(false)
      expect(isPullRequestEvent({kind: 1619} as any)).toBe(false)
      expect(isPullRequestEvent({kind: 1621} as any)).toBe(false)
    })

    it("should reject non-PR-update events for isPullRequestUpdateEvent", () => {
      expect(isPullRequestUpdateEvent({kind: 1618} as any)).toBe(false)
      expect(isPullRequestUpdateEvent({kind: 1621} as any)).toBe(false)
    })
  })

  describe("Event Parsing - Edge Cases", () => {
    it("should parse minimal PR with only a tag", () => {
      const event: PullRequestEvent = {
        id: "min-id",
        pubkey: "pk",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [["a", "30617:repo"]],
        content: "",
        sig: "",
      }
      const parsed = parsePullRequestEvent(event)
      expect(parsed.id).toBe("min-id")
      expect(parsed.repoId).toBe("30617:repo")
      expect(parsed.subject).toBe("")
      expect(parsed.labels).toEqual([])
      expect(parsed.tipCommitOid).toBe("")
      expect(parsed.branchName).toBeUndefined()
      expect(parsed.mergeBase).toBeUndefined()
      expect(parsed.content).toBe("")
      expect(parsed.author.pubkey).toBe("pk")
      expect(parsed.raw).toBe(event)
    })

    it("should parse PR with multiple labels and one tip commit", () => {
      const event: PullRequestEvent = {
        id: "id",
        pubkey: "pk",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:repo"],
          ["subject", "Title"],
          ["t", "bug"],
          ["t", "enhancement"],
          ["c", "c2"],
        ],
        content: "Body",
        sig: "",
      }
      const parsed = parsePullRequestEvent(event)
      expect(parsed.labels).toEqual(["bug", "enhancement"])
      expect(parsed.tipCommitOid).toEqual("c2")
    })

    it("should treat PR with multiple c tags as invalid tip shape", () => {
      const event: PullRequestEvent = {
        id: "id",
        pubkey: "pk",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:repo"],
          ["c", "c1"],
          ["c", "c2"],
        ],
        content: "Body",
        sig: "",
      }
      const parsed = parsePullRequestEvent(event)
      expect(parsed.tipCommitOid).toBe("")
      expect(parsed.tipError).toBe("ambiguous-tip")
      expect(parsed.tipCandidates).toEqual(["c1", "c2"])
    })

    it("should parse PR update with minimal tags", () => {
      const event: PullRequestUpdateEvent = {
        id: "up-id",
        pubkey: "pk",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo"],
          ["E", "pr-root-id"],
          ["P", "pr-author-pk"],
        ],
        content: "",
        sig: "",
      }
      const parsed = parsePullRequestUpdateEvent(event)
      expect(parsed.pullRequestEventId).toBe("pr-root-id")
      expect(parsed.pullRequestAuthorPubkey).toBe("pr-author-pk")
      expect(parsed.tipCommitOid).toBe("")
      expect(parsed.mergeBase).toBeUndefined()
    })

    it("should treat PR update with multiple c tags as invalid tip shape", () => {
      const event: PullRequestUpdateEvent = {
        id: "up-id",
        pubkey: "pk",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo"],
          ["E", "pr-root-id"],
          ["P", "pr-author-pk"],
          ["c", "c1"],
          ["c", "c2"],
        ],
        content: "",
        sig: "",
      }
      const parsed = parsePullRequestUpdateEvent(event)
      expect(parsed.tipCommitOid).toBe("")
      expect(parsed.tipError).toBe("ambiguous-tip")
      expect(parsed.tipCandidates).toEqual(["c1", "c2"])
    })

    it("should include createdAt as ISO string", () => {
      const event: PullRequestEvent = {
        id: "id",
        pubkey: "pk",
        created_at: 1234567890,
        kind: GIT_PULL_REQUEST,
        tags: [["a", "30617:repo"]],
        content: "",
        sig: "",
      }
      const parsed = parsePullRequestEvent(event)
      expect(parsed.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    })
  })

  describe("Round-trip: Create -> Parse", () => {
    it("should round-trip full PR event", () => {
      const created = createPullRequestEvent({
        repoAddr: "30617:npub1abc/repo",
        content: "PR body",
        subject: "Add feature",
        labels: ["enhancement"],
        tipCommitOid: "abc123",
        clone: ["https://github.com/user/repo.git"],
        branchName: "main",
        mergeBase: "base123",
        recipients: ["pk1"],
      })
      const parsed = parsePullRequestEvent(created as PullRequestEvent)
      expect(parsed.repoId).toBe("30617:npub1abc/repo")
      expect(parsed.subject).toBe("Add feature")
      expect(parsed.content).toBe("PR body")
      expect(parsed.labels).toEqual(["enhancement"])
      expect(parsed.tipCommitOid).toEqual("abc123")
      expect(parsed.branchName).toBe("main")
      expect(parsed.mergeBase).toBe("base123")
      expect(parsed.raw).toBe(created)
    })

    it("should round-trip full PR update event", () => {
      const created = createPullRequestUpdateEvent({
        repoAddr: "30617:repo",
        pullRequestEventId: "pr-xyz",
        pullRequestAuthorPubkey: "author-pk",
        tipCommitOid: "c2",
        mergeBase: "mb",
      })
      const parsed = parsePullRequestUpdateEvent(created as PullRequestUpdateEvent)
      expect(parsed.pullRequestEventId).toBe("pr-xyz")
      expect(parsed.pullRequestAuthorPubkey).toBe("author-pk")
      expect(parsed.tipCommitOid).toEqual("c2")
      expect(parsed.mergeBase).toBe("mb")
    })
  })

  describe("Validation - PR Update NIP-22 Requirements", () => {
    it("should reject PR update missing E tag", () => {
      const event = {
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo"],
          ["P", "author-pk"],
        ],
        content: "",
      }
      const result = validatePullRequestUpdateEvent(event)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain("E")
      }
    })

    it("should reject PR update missing P tag", () => {
      const event = {
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:repo"],
          ["E", "pr-event-id"],
        ],
        content: "",
      }
      const result = validatePullRequestUpdateEvent(event)
      expect(result.success).toBe(false)
      if (!result.success) {
        expect(result.error.message).toContain("P")
      }
    })

    it("should reject PR update missing a tag", () => {
      const event = {
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["E", "pr-id"],
          ["P", "author-pk"],
        ],
        content: "",
      }
      const result = validatePullRequestUpdateEvent(event)
      expect(result.success).toBe(false)
    })

    it("should reject PR with wrong kind", () => {
      const event = {
        kind: 1621,
        tags: [["a", "30617:repo"]],
        content: "",
      }
      const result = validatePullRequestEvent(event)
      expect(result.success).toBe(false)
    })
  })

  describe("PR Update Chain - Effective Tip Derivation", () => {
    function getEffectiveTipOid(
      pr: ReturnType<typeof parsePullRequestEvent> | undefined,
      updates: ReturnType<typeof parsePullRequestUpdateEvent>[],
    ): string {
      if (!pr) return ""
      if (updates.length > 0) return updates[updates.length - 1].tipCommitOid || ""
      return pr.tipCommitOid || ""
    }

    it("should use PR tip when no updates", () => {
      const pr = parsePullRequestEvent({
        id: "pr-1",
        pubkey: "pk",
        created_at: 1,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:r"],
          ["c", "c1"],
        ],
        content: "",
        sig: "",
      } as PullRequestEvent)
      expect(getEffectiveTipOid(pr, [])).toBe("c1")
    })

    it("should use latest update tip when updates exist", () => {
      const pr = parsePullRequestEvent({
        id: "pr-1",
        pubkey: "pk",
        created_at: 1,
        kind: GIT_PULL_REQUEST,
        tags: [
          ["a", "30617:r"],
          ["c", "old1"],
        ],
        content: "",
        sig: "",
      } as PullRequestEvent)
      const update1 = parsePullRequestUpdateEvent({
        id: "up-1",
        pubkey: "pk",
        created_at: 2,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:r"],
          ["E", "pr-1"],
          ["P", "pk"],
          ["c", "new1"],
        ],
        content: "",
        sig: "",
      } as PullRequestUpdateEvent)
      expect(getEffectiveTipOid(pr, [update1])).toBe("new1")
    })

    it("should return empty tip when pr is undefined", () => {
      expect(getEffectiveTipOid(undefined, [])).toBe("")
    })

    it("should return empty tip when PR and updates have no tip commit", () => {
      const pr = parsePullRequestEvent({
        id: "pr-1",
        pubkey: "pk",
        created_at: 1,
        kind: GIT_PULL_REQUEST,
        tags: [["a", "30617:r"]],
        content: "",
        sig: "",
      } as PullRequestEvent)
      const update = parsePullRequestUpdateEvent({
        id: "u1",
        pubkey: "pk",
        created_at: 2,
        kind: GIT_PULL_REQUEST_UPDATE,
        tags: [
          ["a", "30617:r"],
          ["E", "pr-1"],
          ["P", "pk"],
        ],
        content: "",
        sig: "",
      } as PullRequestUpdateEvent)
      expect(getEffectiveTipOid(pr, [update])).toBe("")
    })
  })
})
