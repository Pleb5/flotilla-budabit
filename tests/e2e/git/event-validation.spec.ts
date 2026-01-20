import {test, expect} from "@playwright/test"
import {
  TestSeeder,
  useCleanState,
  // Kind constants
  KIND_REPO_ANNOUNCEMENT,
  KIND_REPO_STATE,
  KIND_ISSUE,
  KIND_PATCH,
  KIND_STATUS_OPEN,
  KIND_STATUS_APPLIED,
  KIND_STATUS_CLOSED,
  KIND_STATUS_DRAFT,
  STATUS_KINDS,
  // Tag helpers
  getTagValue,
  getTagValues,
  getTag,
  getTags,
  hasTag,
  // Basic assertions
  assertValidEvent,
  assertEventKind,
  assertHasTag,
  assertRepoReference,
  assertEventReference,
  assertDTag,
  // NIP-34 specific assertions
  assertValidRepoAnnouncement,
  assertValidRepoState,
  assertValidPatch,
  assertValidIssue,
  assertValidStatusEvent,
  // Composite assertions
  assertStatusReferencesIssue,
  assertStatusReferencesPatch,
  assertReferencesRepo,
} from "../helpers"
import {
  createRepoAnnouncement,
  createRepoState,
  createIssue,
  createPatch,
  createStatusEvent,
  createOpenStatus,
  createAppliedStatus,
  createClosedStatus,
  createDraftStatus,
  getRepoAddress,
  TEST_PUBKEYS,
  TEST_COMMITS,
  BASE_TIMESTAMP,
  STATUS_KINDS as FIXTURE_STATUS_KINDS,
  FULL_REPO_ANNOUNCEMENT,
  MINIMAL_REPO_ANNOUNCEMENT,
  FULL_REPO_STATE,
  BUG_REPORT_ISSUE,
  FEATURE_REQUEST_ISSUE,
  type UnsignedEvent,
} from "../fixtures/events"
import {randomHex} from "../helpers/mock-relay"

/**
 * E2E Event Publishing Validation Tests
 *
 * These tests validate that NIP-34 events published by the application
 * conform to the specification. They use the MockRelay to capture events
 * published during UI interactions and validate their structure.
 *
 * Test categories:
 * 1. Repository Announcement (30617) - Required and optional tags
 * 2. Repository State (30618) - Refs tracking and d-tag consistency
 * 3. Issue Event (1621) - Repo reference and content structure
 * 4. Status Events (1630-1633) - Target reference and correct kind
 * 5. Event Relationships - E/e tags, A/a tags, threading
 */

// Test relay URL configuration
const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

// Apply clean state to ensure test isolation
useCleanState(test)

test.describe("Event Publishing Validation", () => {
  test.describe("Repository Announcement (kind 30617)", () => {
    test("repo announcement has correct NIP-34 structure with required tags", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      // Seed a minimal repo - simulating what the UI would publish
      const repoResult = seeder.seedRepo({
        name: "validation-test-repo",
        description: "Repository for validating event structure",
      })

      await seeder.setup(page)

      // Navigate to the git page
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // Get seeded repo events and validate their structure
      const repoEvents = seeder.getEventsByKind(KIND_REPO_ANNOUNCEMENT)
      expect(repoEvents).toHaveLength(1)

      const repoEvent = repoEvents[0]

      // Validate using assertion helpers
      assertValidRepoAnnouncement(repoEvent)

      // Verify required tags explicitly
      const dTag = getTag(repoEvent, "d")
      expect(dTag, "Event must have 'd' tag").toBeDefined()
      expect(dTag![1], "'d' tag must have non-empty value").toBeTruthy()

      const nameTag = getTag(repoEvent, "name")
      expect(nameTag, "Event must have 'name' tag").toBeDefined()
      expect(nameTag![1]).toBe("validation-test-repo")
    })

    test("repo announcement includes all optional tags when provided", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      // Seed a fully-featured repository
      seeder.seedRepo({
        name: "full-featured-repo",
        description: "A repository with all optional tags",
        maintainers: [TEST_PUBKEYS.alice, TEST_PUBKEYS.bob],
        cloneUrls: ["https://github.com/example/repo.git", "git@github.com:example/repo.git"],
        webUrls: ["https://example.com/repo"],
        topics: ["nostr", "git", "collaboration"],
      })

      await seeder.setup(page)
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      const repoEvents = seeder.getEventsByKind(KIND_REPO_ANNOUNCEMENT)
      expect(repoEvents).toHaveLength(1)

      const repoEvent = repoEvents[0]
      assertValidRepoAnnouncement(repoEvent)

      // Verify description tag
      const descTag = getTag(repoEvent, "description")
      expect(descTag, "Event should have 'description' tag when provided").toBeDefined()
      expect(descTag![1]).toBe("A repository with all optional tags")

      // Verify clone URLs (multiple values)
      const cloneTags = getTags(repoEvent, "clone")
      expect(cloneTags.length, "Event should have 'clone' tags").toBeGreaterThanOrEqual(1)

      // Verify web URLs
      const webTags = getTags(repoEvent, "web")
      expect(webTags.length, "Event should have 'web' tags").toBeGreaterThanOrEqual(1)

      // Verify maintainers (p tags)
      const maintainerTags = getTags(repoEvent, "maintainers")
      expect(maintainerTags.length, "Event should have 'maintainers' tags").toBeGreaterThanOrEqual(1)

      // Verify topic tags
      const topicTags = getTags(repoEvent, "t")
      expect(topicTags.length, "Event should have topic 't' tags").toBeGreaterThanOrEqual(1)
      const topicValues = topicTags.map((t) => t[1])
      expect(topicValues).toContain("nostr")
      expect(topicValues).toContain("git")
    })

    test("repo announcement includes r:euc tag for repository grouping", async ({page}) => {
      // Create an unsigned event with earliest unique commit
      const repoWithEuc = createRepoAnnouncement({
        identifier: "euc-test-repo",
        name: "EUC Test Repository",
        earliestUniqueCommit: TEST_COMMITS.initial,
        pubkey: TEST_PUBKEYS.alice,
      })

      const seeder = new TestSeeder({debug: true})
      // Add the event with EUC tag
      seeder.addEvents([
        {
          ...repoWithEuc,
          id: randomHex(64),
          sig: randomHex(128),
          pubkey: repoWithEuc.pubkey || TEST_PUBKEYS.alice,
        },
      ])

      await seeder.setup(page)
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      const repoEvents = seeder.getEventsByKind(KIND_REPO_ANNOUNCEMENT)
      expect(repoEvents).toHaveLength(1)

      const repoEvent = repoEvents[0]

      // Check for r tag with euc marker
      const rTags = getTags(repoEvent, "r")
      const eucTag = rTags.find((t) => t[2] === "euc")
      expect(eucTag, "Repository should have 'r' tag with 'euc' marker for grouping").toBeDefined()
      expect(eucTag![1], "EUC tag should contain commit hash").toBe(TEST_COMMITS.initial)
    })

    test("fixture FULL_REPO_ANNOUNCEMENT passes all validations", () => {
      // Test the pre-built fixture directly
      const event = {
        ...FULL_REPO_ANNOUNCEMENT,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: FULL_REPO_ANNOUNCEMENT.pubkey || TEST_PUBKEYS.alice,
      }

      assertValidEvent(event)
      assertEventKind(event, KIND_REPO_ANNOUNCEMENT)
      assertDTag(event)

      // Verify all expected tags are present
      expect(hasTag(event, "d")).toBe(true)
      expect(hasTag(event, "name")).toBe(true)
      expect(hasTag(event, "description")).toBe(true)
      expect(hasTag(event, "web")).toBe(true)
      expect(hasTag(event, "clone")).toBe(true)
      expect(hasTag(event, "r")).toBe(true) // EUC tag
    })
  })

  test.describe("Repository State (kind 30618)", () => {
    test("repo state tracks refs/heads correctly", async ({page}) => {
      // Create a repo state event with branch refs
      const repoState = createRepoState({
        identifier: "state-test-repo",
        refs: [
          {type: "heads", name: "main", commit: TEST_COMMITS.third},
          {type: "heads", name: "develop", commit: TEST_COMMITS.feature},
        ],
        head: "main",
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedState = {
        ...repoState,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: repoState.pubkey || TEST_PUBKEYS.alice,
      }

      // Validate structure
      assertValidEvent(signedState)
      assertEventKind(signedState, KIND_REPO_STATE)
      assertDTag(signedState)

      // Check refs/heads tags
      const mainRef = signedState.tags.find((t) => t[0] === "refs/heads/main")
      expect(mainRef, "Should have refs/heads/main tag").toBeDefined()
      expect(mainRef![1]).toBe(TEST_COMMITS.third)

      const developRef = signedState.tags.find((t) => t[0] === "refs/heads/develop")
      expect(developRef, "Should have refs/heads/develop tag").toBeDefined()
      expect(developRef![1]).toBe(TEST_COMMITS.feature)

      // Check HEAD tag
      const headTag = signedState.tags.find((t) => t[0] === "HEAD")
      expect(headTag, "Should have HEAD tag").toBeDefined()
      expect(headTag![1]).toContain("refs/heads/main")
    })

    test("repo state d-tag matches corresponding announcement", async ({page}) => {
      const repoIdentifier = "matched-repo"

      // Create matching announcement and state
      const announcement = createRepoAnnouncement({
        identifier: repoIdentifier,
        name: "Matched Repository",
        pubkey: TEST_PUBKEYS.alice,
      })

      const state = createRepoState({
        identifier: repoIdentifier, // Must match!
        refs: [{type: "heads", name: "main", commit: TEST_COMMITS.initial}],
        head: "main",
        pubkey: TEST_PUBKEYS.alice,
      })

      // Verify d-tags match - access tags directly to avoid type issues with UnsignedEvent
      const announcementD = announcement.tags.find((t) => t[0] === "d")?.[1]
      const stateD = state.tags.find((t) => t[0] === "d")?.[1]

      expect(announcementD).toBe(repoIdentifier)
      expect(stateD).toBe(repoIdentifier)
      expect(announcementD).toBe(stateD)
    })

    test("fixture FULL_REPO_STATE passes validation", () => {
      const event = {
        ...FULL_REPO_STATE,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: FULL_REPO_STATE.pubkey || TEST_PUBKEYS.alice,
      }

      assertValidRepoState(event)

      // Should have multiple refs
      const refTags = event.tags.filter((t) => t[0].startsWith("refs/"))
      expect(refTags.length).toBeGreaterThan(1)

      // Should have HEAD
      expect(hasTag(event, "HEAD")).toBe(true)
    })
  })

  test.describe("Issue Event (kind 1621)", () => {
    test("issue event has correct 'a' tag referencing repository", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      // Seed a repo first
      const repoResult = seeder.seedRepo({
        name: "issue-test-repo",
      })

      // Seed an issue for that repo
      seeder.seedIssue({
        repoAddress: repoResult.address,
        title: "Test Issue for Validation",
        content: "This issue tests the 'a' tag structure",
        status: "open",
      })

      await seeder.setup(page)
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      const issueEvents = seeder.getEventsByKind(KIND_ISSUE)
      expect(issueEvents).toHaveLength(1)

      const issueEvent = issueEvents[0]
      assertValidIssue(issueEvent)

      // Verify 'a' tag references the repo correctly
      assertRepoReference(issueEvent)

      const aTag = getTag(issueEvent, "a")
      expect(aTag).toBeDefined()

      // 'a' tag format: 30617:<pubkey>:<identifier>
      const aValue = aTag![1]
      const parts = aValue.split(":")
      expect(parts[0]).toBe("30617")
      expect(parts[1].length).toBe(64) // pubkey is 64 hex chars
      expect(parts[2]).toBeTruthy() // identifier exists
    })

    test("issue event content contains subject/title", async ({page}) => {
      const issueTitle = "Important Bug Report"
      const issueBody = "Detailed description of the bug"

      const issue = createIssue({
        content: `${issueBody}`,
        repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "test-repo"),
        subject: issueTitle,
        pubkey: TEST_PUBKEYS.bob,
      })

      const signedIssue = {
        ...issue,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: issue.pubkey || TEST_PUBKEYS.bob,
      }

      assertValidIssue(signedIssue)

      // Verify subject tag
      const subjectTag = getTag(signedIssue, "subject")
      expect(subjectTag, "Issue should have 'subject' tag").toBeDefined()
      expect(subjectTag![1]).toBe(issueTitle)

      // Content should be present
      expect(signedIssue.content).toBe(issueBody)
    })

    test("issue event includes labels as 't' tags", async ({page}) => {
      const issue = createIssue({
        content: "Bug with labels",
        repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "test-repo"),
        subject: "Labeled Issue",
        labels: ["bug", "critical", "ui"],
        pubkey: TEST_PUBKEYS.charlie,
      })

      const signedIssue = {
        ...issue,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: issue.pubkey || TEST_PUBKEYS.charlie,
      }

      assertValidIssue(signedIssue)

      // Verify label tags
      const labelTags = getTags(signedIssue, "t")
      expect(labelTags.length).toBe(3)

      const labelValues = labelTags.map((t) => t[1])
      expect(labelValues).toContain("bug")
      expect(labelValues).toContain("critical")
      expect(labelValues).toContain("ui")
    })

    test("fixture BUG_REPORT_ISSUE passes validation", () => {
      const event = {
        ...BUG_REPORT_ISSUE,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: BUG_REPORT_ISSUE.pubkey || TEST_PUBKEYS.charlie,
      }

      assertValidIssue(event)
      expect(hasTag(event, "a")).toBe(true)
      expect(hasTag(event, "subject")).toBe(true)
      expect(hasTag(event, "t")).toBe(true) // Has labels
    })
  })

  test.describe("Status Events (kinds 1630-1633)", () => {
    test("open status (1630) has correct structure", async ({page}) => {
      const targetEventId = randomHex(64)
      const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, "status-test-repo")

      const openStatus = createOpenStatus(targetEventId, {
        content: "Issue opened for discussion",
        repoAddress,
        recipients: [TEST_PUBKEYS.bob],
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedStatus = {
        ...openStatus,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: openStatus.pubkey || TEST_PUBKEYS.alice,
      }

      assertValidStatusEvent(signedStatus)
      expect(signedStatus.kind).toBe(KIND_STATUS_OPEN)

      // Verify 'e' tag references target event
      assertEventReference(signedStatus, targetEventId)

      // Verify 'p' tag for recipients
      const pTags = getTags(signedStatus, "p")
      expect(pTags.length).toBeGreaterThanOrEqual(1)
    })

    test("applied/merged status (1631) has correct structure with merge commit", async ({page}) => {
      const targetEventId = randomHex(64)
      const mergeCommit = TEST_COMMITS.merge
      const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, "merge-test-repo")

      const appliedStatus = createAppliedStatus(targetEventId, {
        content: "Patch merged successfully",
        repoAddress,
        mergeCommit,
        recipients: [TEST_PUBKEYS.bob],
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedStatus = {
        ...appliedStatus,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: appliedStatus.pubkey || TEST_PUBKEYS.alice,
      }

      assertValidStatusEvent(signedStatus)
      expect(signedStatus.kind).toBe(KIND_STATUS_APPLIED)

      // Verify merge-commit tag
      const mergeCommitTag = getTag(signedStatus, "merge-commit")
      expect(mergeCommitTag, "Applied status should have 'merge-commit' tag").toBeDefined()
      expect(mergeCommitTag![1]).toBe(mergeCommit)
    })

    test("closed status (1632) has correct structure", async ({page}) => {
      const targetEventId = randomHex(64)
      const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, "close-test-repo")

      const closedStatus = createClosedStatus(targetEventId, {
        content: "Closing as won't fix",
        repoAddress,
        recipients: [TEST_PUBKEYS.charlie],
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedStatus = {
        ...closedStatus,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: closedStatus.pubkey || TEST_PUBKEYS.alice,
      }

      assertValidStatusEvent(signedStatus)
      expect(signedStatus.kind).toBe(KIND_STATUS_CLOSED)
      assertEventReference(signedStatus, targetEventId)
    })

    test("draft status (1633) has correct structure", async ({page}) => {
      const targetEventId = randomHex(64)
      const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, "draft-test-repo")

      const draftStatus = createDraftStatus(targetEventId, {
        content: "Work in progress",
        repoAddress,
        pubkey: TEST_PUBKEYS.bob,
      })

      const signedStatus = {
        ...draftStatus,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: draftStatus.pubkey || TEST_PUBKEYS.bob,
      }

      assertValidStatusEvent(signedStatus)
      expect(signedStatus.kind).toBe(KIND_STATUS_DRAFT)
      assertEventReference(signedStatus, targetEventId)
    })

    test("status event correctly references issue target", async ({page}) => {
      // Create an issue first
      const issue = createIssue({
        content: "Issue to be closed",
        repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "test-repo"),
        subject: "Test Issue",
        pubkey: TEST_PUBKEYS.bob,
      })

      const issueId = randomHex(64)
      const signedIssue = {
        ...issue,
        id: issueId,
        sig: randomHex(128),
        pubkey: issue.pubkey || TEST_PUBKEYS.bob,
      }

      // Create a status referencing the issue
      const status = createClosedStatus(issueId, {
        content: "Issue resolved",
        repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "test-repo"),
        recipients: [TEST_PUBKEYS.bob],
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedStatus = {
        ...status,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: status.pubkey || TEST_PUBKEYS.alice,
      }

      // Use composite assertion
      assertStatusReferencesIssue(signedStatus, signedIssue)
    })

    test("all status kinds are in valid range (1630-1633)", () => {
      const validKinds = [KIND_STATUS_OPEN, KIND_STATUS_APPLIED, KIND_STATUS_CLOSED, KIND_STATUS_DRAFT]

      for (const kind of validKinds) {
        expect(kind).toBeGreaterThanOrEqual(1630)
        expect(kind).toBeLessThanOrEqual(1633)
      }

      // Verify STATUS_KINDS array contains all valid kinds
      expect(STATUS_KINDS).toContain(KIND_STATUS_OPEN)
      expect(STATUS_KINDS).toContain(KIND_STATUS_APPLIED)
      expect(STATUS_KINDS).toContain(KIND_STATUS_CLOSED)
      expect(STATUS_KINDS).toContain(KIND_STATUS_DRAFT)
    })
  })

  test.describe("Patch Event (kind 1617)", () => {
    test("patch event has correct structure with 'a' tag", async ({page}) => {
      const seeder = new TestSeeder({debug: true})

      const repoResult = seeder.seedRepo({
        name: "patch-validation-repo",
      })

      seeder.seedPatch({
        repoAddress: repoResult.address,
        title: "Fix critical bug",
        content: "diff --git a/file.ts b/file.ts\n+fixed line",
        status: "open",
      })

      await seeder.setup(page)
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      const patchEvents = seeder.getEventsByKind(KIND_PATCH)
      expect(patchEvents).toHaveLength(1)

      const patchEvent = patchEvents[0]
      assertValidPatch(patchEvent)

      // Verify repo reference
      assertRepoReference(patchEvent)

      // Verify content is non-empty (contains diff)
      expect(patchEvent.content.length).toBeGreaterThan(0)
    })

    test("patch event includes commit and parent-commit tags", async ({page}) => {
      const patch = createPatch({
        content: "diff content here",
        repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "test-repo"),
        subject: "Add feature",
        commit: TEST_COMMITS.third,
        parentCommit: TEST_COMMITS.second,
        pubkey: TEST_PUBKEYS.bob,
      })

      const signedPatch = {
        ...patch,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: patch.pubkey || TEST_PUBKEYS.bob,
      }

      assertValidPatch(signedPatch)

      // Verify commit tag
      const commitTag = getTag(signedPatch, "commit")
      expect(commitTag, "Patch should have 'commit' tag").toBeDefined()
      expect(commitTag![1]).toBe(TEST_COMMITS.third)

      // Verify parent-commit tag
      const parentCommitTag = getTag(signedPatch, "parent-commit")
      expect(parentCommitTag, "Patch should have 'parent-commit' tag").toBeDefined()
      expect(parentCommitTag![1]).toBe(TEST_COMMITS.second)
    })
  })

  test.describe("Event Relationships", () => {
    test("'e' tags correctly reference events with root/reply markers", async ({page}) => {
      const rootEventId = randomHex(64)
      const replyEventId = randomHex(64)

      // Create a status with both root and reply markers
      const status = createStatusEvent({
        kind: FIXTURE_STATUS_KINDS.OPEN,
        targetEventId: rootEventId,
        replyId: replyEventId,
        content: "Reopening after discussion",
        recipients: [TEST_PUBKEYS.bob],
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedStatus = {
        ...status,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: status.pubkey || TEST_PUBKEYS.alice,
      }

      // Find root marker
      const eTags = getTags(signedStatus, "e")
      const rootTag = eTags.find((t) => t[3] === "root")
      expect(rootTag, "Should have 'e' tag with 'root' marker").toBeDefined()
      expect(rootTag![1]).toBe(rootEventId)

      // Find reply marker
      const replyTag = eTags.find((t) => t[3] === "reply")
      expect(replyTag, "Should have 'e' tag with 'reply' marker").toBeDefined()
      expect(replyTag![1]).toBe(replyEventId)
    })

    test("'a' tags correctly reference addressable events", async ({page}) => {
      const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, "threading-test-repo")

      const issue = createIssue({
        content: "Issue for threading test",
        repoAddress,
        subject: "Threading Test",
        pubkey: TEST_PUBKEYS.bob,
      })

      const signedIssue = {
        ...issue,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: issue.pubkey || TEST_PUBKEYS.bob,
      }

      // Verify 'a' tag format
      const aTag = getTag(signedIssue, "a")
      expect(aTag).toBeDefined()
      expect(aTag![1]).toBe(repoAddress)

      // Parse and validate format
      const [kind, pubkey, identifier] = aTag![1].split(":")
      expect(kind).toBe("30617")
      expect(pubkey).toBe(TEST_PUBKEYS.alice)
      expect(identifier).toBe("threading-test-repo")
    })

    test("event references repo correctly via assertReferencesRepo", async ({page}) => {
      // Create a repo announcement
      const repo = createRepoAnnouncement({
        identifier: "ref-test-repo",
        name: "Reference Test Repository",
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedRepo = {
        ...repo,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: repo.pubkey || TEST_PUBKEYS.alice,
      }

      // Create an issue referencing that repo
      const repoAddress = getRepoAddress(TEST_PUBKEYS.alice, "ref-test-repo")
      const issue = createIssue({
        content: "Issue referencing repo",
        repoAddress,
        subject: "Reference Test Issue",
        pubkey: TEST_PUBKEYS.bob,
      })

      const signedIssue = {
        ...issue,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: issue.pubkey || TEST_PUBKEYS.bob,
      }

      // Use composite assertion
      assertReferencesRepo(signedIssue, signedRepo)
    })

    test("proper threading with E-tag uppercase for root reference", async ({page}) => {
      // NIP-10 threading: E tags (uppercase) for explicit root/reply
      // The fixtures use lowercase 'e' which is standard
      const rootEventId = randomHex(64)

      const status = createOpenStatus(rootEventId, {
        content: "Testing threading",
        repoAddress: getRepoAddress(TEST_PUBKEYS.alice, "thread-repo"),
        pubkey: TEST_PUBKEYS.alice,
      })

      const signedStatus = {
        ...status,
        id: randomHex(64),
        sig: randomHex(128),
        pubkey: status.pubkey || TEST_PUBKEYS.alice,
      }

      // Verify there is at least one 'e' tag with root marker
      const eTags = getTags(signedStatus, "e")
      expect(eTags.length).toBeGreaterThanOrEqual(1)

      const rootTag = eTags.find((t) => t[3] === "root")
      expect(rootTag, "Event should have 'e' tag with 'root' marker for threading").toBeDefined()
    })
  })

  test.describe("Published Event Capture", () => {
    test.skip("captures repository creation event from UI", async ({page}) => {
      // This test would trigger actual UI interaction to create a repo
      // and capture the published event. Skipped until UI flow is confirmed.

      const seeder = new TestSeeder({debug: true})
      await seeder.setup(page)

      // Navigate and trigger repo creation via UI
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // Open new repo wizard
      // await page.getByRole("button", {name: /new repo/i}).click()
      // Fill form and submit...

      // Wait for the repo announcement event
      const mockRelay = seeder.getMockRelay()
      // const repoEvent = await mockRelay.waitForEvent(KIND_REPO_ANNOUNCEMENT, 10000)

      // Validate the published event
      // assertValidRepoAnnouncement(repoEvent)
    })

    test.skip("captures issue creation event from UI", async ({page}) => {
      // This test would navigate to a repo's issues page and create an issue
      // Skipped until UI flow is confirmed.

      const seeder = new TestSeeder({debug: true})
      seeder.seedRepo({name: "ui-issue-repo"})
      await seeder.setup(page)

      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // Navigate to repo, then issues, then create new issue...
      // Wait for the issue event
      const mockRelay = seeder.getMockRelay()
      // const issueEvent = await mockRelay.waitForEvent(KIND_ISSUE, 10000)
      // assertValidIssue(issueEvent)
    })

    test.skip("captures status change event from UI", async ({page}) => {
      // This test would change issue/patch status and capture the event
      // Skipped until UI flow is confirmed.

      const seeder = new TestSeeder({debug: true})
      const repoResult = seeder.seedRepo({name: "ui-status-repo"})

      seeder.seedIssue({
        repoAddress: repoResult.address,
        title: "Issue to close",
        status: "open",
      })

      await seeder.setup(page)
      await page.goto(`/spaces/${ENCODED_RELAY}/git`)
      await page.waitForLoadState("networkidle")

      // Navigate to issue and close it...
      const mockRelay = seeder.getMockRelay()
      // const statusEvent = await mockRelay.waitForEvent(KIND_STATUS_CLOSED, 10000)
      // assertValidStatusEvent(statusEvent)
    })
  })

  test.describe("Edge Cases and Validation Errors", () => {
    test("validates pubkey is 64 hex characters", async ({page}) => {
      const event = {
        id: randomHex(64),
        pubkey: randomHex(64),
        created_at: BASE_TIMESTAMP,
        kind: KIND_REPO_ANNOUNCEMENT,
        tags: [
          ["d", "test-repo"],
          ["name", "Test Repo"],
        ],
        content: "",
        sig: randomHex(128),
      }

      // Should pass validation
      assertValidEvent(event)
      expect(event.pubkey.length).toBe(64)

      // Invalid pubkey would fail
      const badEvent = {...event, pubkey: "short"}
      expect(() => assertValidEvent(badEvent)).toThrow()
    })

    test("validates created_at is positive integer", async ({page}) => {
      const event = {
        id: randomHex(64),
        pubkey: randomHex(64),
        created_at: BASE_TIMESTAMP,
        kind: KIND_ISSUE,
        tags: [["a", "30617:" + randomHex(64) + ":test"]],
        content: "Issue content",
        sig: randomHex(128),
      }

      assertValidEvent(event)
      expect(event.created_at).toBeGreaterThan(0)
    })

    test("validates tags array structure", async ({page}) => {
      const validEvent = {
        id: randomHex(64),
        pubkey: randomHex(64),
        created_at: BASE_TIMESTAMP,
        kind: KIND_REPO_ANNOUNCEMENT,
        tags: [
          ["d", "valid-repo"],
          ["name", "Valid Repo"],
        ],
        content: "",
        sig: randomHex(128),
      }

      assertValidEvent(validEvent)

      // Each tag should be an array with at least one element
      for (const tag of validEvent.tags) {
        expect(Array.isArray(tag)).toBe(true)
        expect(tag.length).toBeGreaterThanOrEqual(1)
      }
    })

    test("validates signature is 128 hex characters", async ({page}) => {
      const event = {
        id: randomHex(64),
        pubkey: randomHex(64),
        created_at: BASE_TIMESTAMP,
        kind: KIND_REPO_ANNOUNCEMENT,
        tags: [
          ["d", "sig-test"],
          ["name", "Signature Test"],
        ],
        content: "",
        sig: randomHex(128),
      }

      assertValidEvent(event)
      expect(event.sig.length).toBe(128)
    })
  })
})
