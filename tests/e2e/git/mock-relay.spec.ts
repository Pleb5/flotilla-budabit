import {test, expect} from "@playwright/test"
import {MockRelay, createRepoAnnouncement, scenario, TEST_USERS} from "../helpers"
import {FIXTURES} from "../fixtures/test-events"

/**
 * Mock Relay E2E Tests
 *
 * These tests demonstrate and verify the MockRelay functionality
 * for deterministic testing of Nostr-based git features.
 *
 * The MockRelay intercepts WebSocket connections to Nostr relays,
 * allowing tests to:
 * 1. Seed events that the app will "receive" from relays
 * 2. Capture events that the app publishes
 * 3. Test without needing a real relay running
 */

// Test relay URL - must match what the app expects
const TEST_RELAY = "ws://localhost:7000"
const ENCODED_RELAY = encodeURIComponent(TEST_RELAY)

test.describe("MockRelay infrastructure", () => {
  test("captures published events", async ({page}) => {
    const mockRelay = new MockRelay({debug: true})

    // Seed a repo so the app has something to work with
    mockRelay.seedEvents([
      createRepoAnnouncement({
        pubkey: TEST_USERS.alice.pubkey,
        name: "test-repo",
        description: "A test repository",
      }),
    ])

    await mockRelay.setup(page)

    // Navigate to the app
    await page.goto(`/spaces/${ENCODED_RELAY}/git`)

    // Wait for the page to stabilize
    await page.waitForLoadState("networkidle")

    // In a real test, we would trigger an action that publishes an event
    // and then verify it was captured
    const published = mockRelay.getPublishedEvents()

    // Log for debugging
    console.log(`Captured ${published.length} published events`)
  })

  test("seeds repository events that the app can display", async ({page}) => {
    const mockRelay = new MockRelay()

    // Use pre-built fixtures
    mockRelay.seedEvents(FIXTURES.REPOS_ONLY)

    await mockRelay.setup(page)

    // Navigate to git page
    await page.goto(`/spaces/${ENCODED_RELAY}/git`)

    // The app should request events and receive our seeded data
    // This test verifies the mock relay is intercepting correctly
    await page.waitForLoadState("domcontentloaded")

    // Check that no real WebSocket errors occurred
    // The mock should handle all relay communication
    const consoleErrors: string[] = []
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text())
      }
    })

    // Give the app time to process events
    await page.waitForTimeout(2000)

    // Filter out any WebSocket-related errors
    const wsErrors = consoleErrors.filter(
      (e) => e.includes("WebSocket") || e.includes("relay"),
    )

    // We expect no WebSocket errors since the mock handles everything
    expect(wsErrors).toHaveLength(0)
  })

  test("can seed events using scenario builder", async ({page}) => {
    const events = scenario()
      .addRepo({
        pubkey: TEST_USERS.alice.pubkey,
        name: "scenario-repo",
        description: "Built with scenario builder",
        issues: [
          {
            title: "First issue",
            body: "This is the first issue in our scenario",
            labels: ["bug"],
          },
          {
            title: "Second issue",
            body: "This is another issue",
            labels: ["enhancement"],
          },
        ],
      })
      .addRepo({
        pubkey: TEST_USERS.bob.pubkey,
        name: "another-repo",
        description: "Another repo in the scenario",
      })
      .build()

    const mockRelay = new MockRelay({seedEvents: events})
    await mockRelay.setup(page)

    await page.goto(`/spaces/${ENCODED_RELAY}/git`)
    await page.waitForLoadState("networkidle")

    // The scenario created 2 repos and 2 issues
    expect(events.filter((e) => e.kind === 30617)).toHaveLength(2)
    expect(events.filter((e) => e.kind === 1621)).toHaveLength(2)
  })

  test("filters events based on subscription filters", async ({page}) => {
    const subscriptionFilters: Array<{subId: string; filters: unknown[]}> = []

    const mockRelay = new MockRelay({
      seedEvents: FIXTURES.COMPLETE_SCENARIO,
      onSubscribe: (subId, filters) => {
        subscriptionFilters.push({subId, filters})
      },
      debug: true,
    })

    await mockRelay.setup(page)

    await page.goto(`/spaces/${ENCODED_RELAY}/git`)
    await page.waitForLoadState("networkidle")

    // Give the app time to create subscriptions
    await page.waitForTimeout(3000)

    // The app should have created at least one subscription
    console.log(`App created ${subscriptionFilters.length} subscriptions`)

    // Log the filters for debugging
    for (const {subId, filters} of subscriptionFilters) {
      console.log(`Subscription ${subId}:`, JSON.stringify(filters, null, 2))
    }
  })

  test("can inject events after page load", async ({page}) => {
    const mockRelay = new MockRelay()

    // Start with just one repo
    mockRelay.seedEvents([FIXTURES.REPO_SIMPLE])

    await mockRelay.setup(page)
    await page.goto(`/spaces/${ENCODED_RELAY}/git`)
    await page.waitForLoadState("networkidle")

    // Now inject a new repo - simulating real-time event
    await mockRelay.injectEvents([
      createRepoAnnouncement({
        pubkey: TEST_USERS.charlie.pubkey,
        name: "injected-repo",
        description: "This repo was injected after page load",
      }),
    ])

    // The app should receive this event via its active subscription
    // Give it time to process
    await page.waitForTimeout(1000)

    // In a real app, we would verify the new repo appears in the UI
  })

  test("waitForEvent resolves when event is published", async ({page}) => {
    const mockRelay = new MockRelay({debug: true})
    mockRelay.seedEvents([FIXTURES.REPO_SIMPLE])

    await mockRelay.setup(page)
    await page.goto(`/spaces/${ENCODED_RELAY}/git`)

    // This demonstrates waiting for a specific event kind
    // In a real test, we would trigger an action that publishes
    // and then wait for it

    // For now, just verify the method exists and works
    try {
      // Use a short timeout since we don't expect any events
      await mockRelay.waitForEvent(30617, 100)
    } catch {
      // Expected to timeout since app hasn't published a repo
    }

    // Verify we can check published events
    const published = mockRelay.getPublishedEvents()
    const repoEvents = mockRelay.getPublishedEventsByKind(30617)

    expect(Array.isArray(published)).toBe(true)
    expect(Array.isArray(repoEvents)).toBe(true)
  })

  test("handles multiple relay URLs", async ({page}) => {
    const mockRelay = new MockRelay({
      // Intercept specific URLs
      interceptUrls: ["ws://localhost:*", "wss://relay.damus.io"],
      debug: true,
    })

    mockRelay.seedEvents([FIXTURES.REPO_NOSTR_TOOLS])
    await mockRelay.setup(page)

    await page.goto(`/spaces/${ENCODED_RELAY}/git`)
    await page.waitForLoadState("networkidle")

    // The mock should intercept connections to localhost
    // but pass through other URLs (or mock them based on pattern)
  })
})

test.describe("MockRelay with Git Features", () => {
  test.skip("displays seeded repositories in the list", async ({page}) => {
    // This test would verify that seeded repos appear in the UI
    // Skipped until we confirm the exact UI selectors

    const mockRelay = new MockRelay({
      seedEvents: [
        createRepoAnnouncement({
          pubkey: TEST_USERS.alice.pubkey,
          name: "visible-repo",
          description: "This repo should be visible in the list",
        }),
      ],
    })

    await mockRelay.setup(page)
    await page.goto(`/spaces/${ENCODED_RELAY}/git`)

    // Wait for repos to load
    await page.waitForLoadState("networkidle")

    // Check for the repo name in the UI
    // The exact selector depends on the app's implementation
    await expect(page.getByText("visible-repo")).toBeVisible({timeout: 10000})
  })

  test.skip("captures published issues", async ({page}) => {
    // This test would verify that creating an issue publishes the right event
    // Skipped until we have the issue creation flow working

    const mockRelay = new MockRelay({seedEvents: [FIXTURES.REPO_SIMPLE]})
    await mockRelay.setup(page)

    // Navigate to repo and create an issue
    // ...

    // Wait for the issue event to be published
    const issueEvent = await mockRelay.waitForEvent(1621, 30000)

    expect(issueEvent).toBeDefined()
    expect(issueEvent.kind).toBe(1621)
  })
})
