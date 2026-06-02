import {describe, it, expect} from "vitest"
import {withEnv} from "../utils/env.js"
import {
  shouldValidateEvents,
  assertRepoAnnouncementEvent,
  assertRepoStateEvent,
} from "../../src/events/nip34/validation.js"
import {
  validateRepoAnnouncementEvent,
  validateRepoStateEvent,
  validateIssueEvent,
  validateCoverLetterEvent,
  validateStatusEvent,
  validatePullRequestEvent,
  validatePullRequestUpdateEvent,
  validateUserGraspListEvent,
  validateStackEvent,
  validateMergeMetadataEvent,
  validateConflictMetadataEvent,
} from "../../src/utils/validation.js"
import {
  createRepoAnnouncementEvent,
  createRepoStateEvent,
  createIssueEvent,
  createCoverLetterEvent,
  createStatusEvent,
  createPullRequestEvent,
  createPullRequestUpdateEvent,
  createUserGraspListEvent,
  createStackEvent,
  createMergeMetadataEvent,
  createConflictMetadataEvent,
} from "../../src/events/nip34/nip34-utils.js"

describe("Validation feature flag (shouldValidateEvents)", () => {
  it("defaults to disabled in production when env flag is unset", async () => {
    await withEnv({NODE_ENV: "production", NOSTR_GIT_VALIDATE_EVENTS: undefined}, async () => {
      expect(shouldValidateEvents()).toBe(false)
    })
  })

  it("defaults to enabled when not in production and env flag is unset", async () => {
    await withEnv({NODE_ENV: "development", NOSTR_GIT_VALIDATE_EVENTS: undefined}, async () => {
      expect(shouldValidateEvents()).toBe(true)
    })
  })

  it("respects explicit env var truthy values", async () => {
    const truthy = ["1", "true", "yes"]
    for (const v of truthy) {
      // eslint-disable-next-line no-await-in-loop
      await withEnv({NODE_ENV: "production", NOSTR_GIT_VALIDATE_EVENTS: v}, async () => {
        expect(shouldValidateEvents()).toBe(true)
      })
    }
  })

  it("respects explicit env var falsy values", async () => {
    const falsy = ["0", "false", "no"]
    for (const v of falsy) {
      // eslint-disable-next-line no-await-in-loop
      await withEnv({NODE_ENV: "development", NOSTR_GIT_VALIDATE_EVENTS: v}, async () => {
        expect(shouldValidateEvents()).toBe(false)
      })
    }
  })
})

describe("Runtime guards: assertRepoAnnouncementEvent / assertRepoStateEvent", () => {
  it("throws helpful error when validation enabled and repo announcement invalid", async () => {
    await withEnv({NODE_ENV: "development", NOSTR_GIT_VALIDATE_EVENTS: "true"}, async () => {
      const invalid: any = {kind: 30617, tags: []}
      expect(() => assertRepoAnnouncementEvent(invalid)).toThrowError(
        /Invalid RepoAnnouncementEvent:/,
      )
    })
  })

  it("throws helpful error when validation enabled and repo state invalid", async () => {
    await withEnv({NODE_ENV: "development", NOSTR_GIT_VALIDATE_EVENTS: "true"}, async () => {
      const invalid: any = {kind: 30618, tags: []}
      expect(() => assertRepoStateEvent(invalid)).toThrowError(/Invalid RepoStateEvent:/)
    })
  })

  it("does not throw when validation disabled even if invalid", async () => {
    await withEnv({NODE_ENV: "production", NOSTR_GIT_VALIDATE_EVENTS: "false"}, async () => {
      const invalidAnn: any = {kind: 30617, tags: []}
      const invalidState: any = {kind: 30618, tags: []}
      expect(() => assertRepoAnnouncementEvent(invalidAnn)).not.toThrow()
      expect(() => assertRepoStateEvent(invalidState)).not.toThrow()
    })
  })
})

describe("Zod event validators (src/utils/validation.ts)", () => {
  it("validates correct events for all supported kinds", () => {
    const ann = createRepoAnnouncementEvent({repoId: "owner/repo"})
    const st = createRepoStateEvent({repoId: "owner/repo", head: "main"})
    const issue = createIssueEvent({content: "issue", repoAddr: "30617:pk:repo"})
    const cover = createCoverLetterEvent({content: "cover", rootId: "issue-root"})
    const status = createStatusEvent({
      kind: 1630,
      content: "open",
      rootId: "root-evt",
      recipients: ["pk1"],
    })
    const pr = createPullRequestEvent({
      content: "pr",
      repoAddr: "30617:pk:repo",
      tipCommitOid: "c1",
    })
    const pru = createPullRequestUpdateEvent({
      repoAddr: "30617:pk:repo",
      pullRequestEventId: "pr-evt-1",
      pullRequestAuthorPubkey: "pk",
      tipCommitOid: "c1",
    })
    const grasp = createUserGraspListEvent({services: ["github"]})
    const stack = createStackEvent({repoAddr: "30617:pk:repo", stackId: "s1", members: ["p1"]})
    const mergeMeta = createMergeMetadataEvent({
      repoAddr: "30617:pk:repo",
      rootId: "root",
      targetBranch: "main",
      result: "clean",
    })
    const conflictMeta = createConflictMetadataEvent({
      repoAddr: "30617:pk:repo",
      rootId: "root",
      files: ["a.txt"],
    })

    expect(validateRepoAnnouncementEvent(ann).success).toBe(true)
    expect(validateRepoStateEvent(st).success).toBe(true)
    expect(validateIssueEvent(issue).success).toBe(true)
    expect(validateCoverLetterEvent(cover).success).toBe(true)
    expect(validateStatusEvent(status).success).toBe(true)
    expect(validatePullRequestEvent(pr).success).toBe(true)
    expect(validatePullRequestUpdateEvent(pru).success).toBe(true)
    expect(validateUserGraspListEvent(grasp).success).toBe(true)
    expect(validateStackEvent(stack).success).toBe(true)
    expect(validateMergeMetadataEvent(mergeMeta).success).toBe(true)
    expect(validateConflictMetadataEvent(conflictMeta).success).toBe(true)
  })

  it("rejects malformed repo announcement and repo state events with helpful errors", () => {
    const badAnn: any = {kind: 30617, tags: [["name", "x"]]} // missing d
    const annRes = validateRepoAnnouncementEvent(badAnn)
    expect(annRes.success).toBe(false)
    // Validation fails on tags schema - just verify it fails

    const badState: any = {kind: 30618, tags: [["HEAD", "ref: refs\\/heads\\/main"]]} // missing d
    const stRes = validateRepoStateEvent(badState)
    expect(stRes.success).toBe(false)
    // Validation fails on tags schema - just verify it fails

    // Test with valid tags but missing d to trigger superRefine
    const annMissingD: any = {
      kind: 30617,
      tags: [
        ["name", "test"],
        ["clone", "https://example.com"],
      ],
    }
    const annRes2 = validateRepoAnnouncementEvent(annMissingD)
    expect(annRes2.success).toBe(false)
    if (!annRes2.success) {
      const errStr = JSON.stringify(annRes2.error)
      expect(errStr).toMatch(/must include a 'd' tag/i)
    }
  })

  it("rejects repo state events missing required d tag even when HEAD is present (superRefine)", () => {
    const badStateMissingD: any = {
      kind: 30618,
      content: "",
      tags: [["HEAD", "ref: refs/heads/main"]],
    }

    const res = validateRepoStateEvent(badStateMissingD)
    expect(res.success).toBe(false)
    if (!res.success) {
      const msgs = res.error.issues.map(i => i.message).join("\n")
      expect(msgs).toMatch(/Repo state must include a 'd' tag/i)
    }
  })

  it("reports multiple missing-tag issues for status events missing both e and p tags", () => {
    const badStatus: any = {
      kind: 1630,
      content: "open",
      tags: [],
    }

    const res = validateStatusEvent(badStatus)
    expect(res.success).toBe(false)
    if (!res.success) {
      const msgs = res.error.issues.map(i => i.message)

      // Both issues should be present at once (multi-missing-tags coverage)
      expect(msgs).toEqual(
        expect.arrayContaining([
          expect.stringMatching(/Status must include at least one 'e' tag/i),
          expect.stringMatching(/Status should include at least one 'p' tag/i),
        ]),
      )
    }
  })

  it.todo(
    "add comment-event validation (NIP-22) and assert missing e/p tags produce clear zod errors (implementation gap: no validator in src/utils/validation.ts yet)",
  )

  it("rejects malformed status event missing required e/p tags with helpful errors", () => {
    const badStatus: any = {kind: 1630, tags: []}
    const res = validateStatusEvent(badStatus)
    expect(res.success).toBe(false)
    if (!res.success) {
      // Both e and p are validated; message content may include either/both
      expect(res.error.message.toLowerCase()).toContain("status")
    }
  })

  it("rejects cover letter events missing required e tag", () => {
    const badCover: any = {
      kind: 1624,
      content: "updated description",
      tags: [["p", "pk1"]],
    }

    const res = validateCoverLetterEvent(badCover)
    expect(res.success).toBe(false)
    if (!res.success) {
      const msgs = res.error.issues.map(i => i.message).join("\n")
      expect(msgs).toMatch(/Cover letter must include an 'e' tag/i)
    }
  })
})
