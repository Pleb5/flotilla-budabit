/**
 * Mock Relay for E2E Testing
 *
 * Provides WebSocket interception for Nostr relay connections during Playwright tests.
 * Enables deterministic testing by:
 * - Pre-seeding events that the app will receive
 * - Capturing events published by the app
 * - Controlling relay responses without needing a real relay
 *
 * Implementation approach: Uses page.addInitScript() to inject a mock WebSocket class
 * before the app loads. This intercepts all WebSocket connections to relay URLs (wss://).
 *
 * @example
 * ```typescript
 * import {test} from "@playwright/test"
 * import {MockRelay, createRepoAnnouncement} from "./helpers/mock-relay"
 *
 * test("displays seeded repository", async ({page}) => {
 *   const mockRelay = new MockRelay()
 *
 *   // Seed a repository announcement event
 *   mockRelay.seedEvents([
 *     createRepoAnnouncement({
 *       pubkey: "abc123...",
 *       name: "test-repo",
 *       description: "Test repository",
 *     }),
 *   ])
 *
 *   // Set up the mock before navigating
 *   await mockRelay.setup(page)
 *
 *   // Navigate to the app
 *   await page.goto("/spaces/ws%3A%2F%2Flocalhost%3A7000/git")
 *
 *   // The app will now "see" the seeded repository
 *   await expect(page.getByText("test-repo")).toBeVisible()
 *
 *   // Check what events the app published
 *   const published = mockRelay.getPublishedEvents()
 * })
 * ```
 */
import type {Page} from "@playwright/test"

/**
 * Nostr event structure following NIP-01
 * Uses the same shape as nostr-tools and welshman
 */
export interface NostrEvent {
  id: string
  pubkey: string
  created_at: number
  kind: number
  tags: string[][]
  content: string
  sig: string
}

/**
 * Nostr filter for subscriptions (NIP-01)
 */
export interface NostrFilter {
  ids?: string[]
  authors?: string[]
  kinds?: number[]
  "#e"?: string[]
  "#p"?: string[]
  "#a"?: string[]
  "#d"?: string[]
  "#r"?: string[]
  "#t"?: string[]
  since?: number
  until?: number
  limit?: number
  [key: string]: string[] | number[] | number | undefined
}

/**
 * Options for configuring the mock relay
 */
export interface MockRelayOptions {
  /** Events to return when app queries (will be filtered by subscription filters) */
  seedEvents?: NostrEvent[]
  /** Callback when app publishes an event */
  onPublish?: (event: NostrEvent) => void
  /** Callback when app creates a subscription */
  onSubscribe?: (subId: string, filters: NostrFilter[]) => void
  /** Whether to log relay messages for debugging */
  debug?: boolean
  /** Relay URLs to intercept (defaults to all wss:// URLs) */
  interceptUrls?: string[]
  /** Simulated network latency in ms (default: 10) */
  latency?: number
}

/**
 * Mock Nostr relay for deterministic E2E testing
 *
 * Intercepts WebSocket connections and simulates relay behavior,
 * allowing tests to control exactly what data the app receives.
 */
export class MockRelay {
  private seedEventsList: NostrEvent[] = []
  private publishedEvents: NostrEvent[] = []
  private onPublishCallback?: (event: NostrEvent) => void
  private onSubscribeCallback?: (subId: string, filters: NostrFilter[]) => void
  private debug: boolean = false
  private interceptUrls: string[] = []
  private latency: number = 10
  private eventWaiters: Map<number, {resolve: (event: NostrEvent) => void; reject: (error: Error) => void}[]> = new Map()
  private isSetup: boolean = false
  private page?: Page

  constructor(options?: MockRelayOptions) {
    if (options?.seedEvents) {
      this.seedEventsList = [...options.seedEvents]
    }
    if (options?.onPublish) {
      this.onPublishCallback = options.onPublish
    }
    if (options?.onSubscribe) {
      this.onSubscribeCallback = options.onSubscribe
    }
    if (options?.debug !== undefined) {
      this.debug = options.debug
    }
    if (options?.interceptUrls) {
      this.interceptUrls = options.interceptUrls
    }
    if (options?.latency !== undefined) {
      this.latency = options.latency
    }
  }

  /**
   * Set up the mock relay for a Playwright page
   *
   * MUST be called before navigating to the app.
   * Injects a mock WebSocket class that intercepts relay connections.
   */
  async setup(page: Page, options?: MockRelayOptions): Promise<void> {
    // Merge options if provided
    if (options?.seedEvents) {
      this.seedEventsList = [...this.seedEventsList, ...options.seedEvents]
    }
    if (options?.onPublish) {
      this.onPublishCallback = options.onPublish
    }
    if (options?.onSubscribe) {
      this.onSubscribeCallback = options.onSubscribe
    }
    if (options?.debug !== undefined) {
      this.debug = options.debug
    }
    if (options?.interceptUrls) {
      this.interceptUrls = options.interceptUrls
    }
    if (options?.latency !== undefined) {
      this.latency = options.latency
    }

    this.page = page
    this.isSetup = true

    // Expose functions for the page to call back to the test
    await page.exposeFunction("__mockRelayPublish", (event: NostrEvent) => {
      this.publishedEvents.push(event)
      this.onPublishCallback?.(event)

      // Notify any waiters for this event kind
      const waiters = this.eventWaiters.get(event.kind)
      if (waiters && waiters.length > 0) {
        const waiter = waiters.shift()
        waiter?.resolve(event)
      }
    })

    await page.exposeFunction("__mockRelaySubscribe", (subId: string, filters: NostrFilter[]) => {
      this.onSubscribeCallback?.(subId, filters)
    })

    // Inject the mock WebSocket before any scripts run
    await page.addInitScript(
      ({seedEvents, debug, interceptUrls, latency}) => {
        // Store original WebSocket
        const OriginalWebSocket = window.WebSocket

        // Track active mock connections for debugging
        const mockConnections: Map<string, MockWebSocket> = new Map()

        /**
         * Mock WebSocket class that simulates a Nostr relay
         */
        class MockWebSocket extends EventTarget {
          static readonly CONNECTING = 0
          static readonly OPEN = 1
          static readonly CLOSING = 2
          static readonly CLOSED = 3

          readonly CONNECTING = 0
          readonly OPEN = 1
          readonly CLOSING = 2
          readonly CLOSED = 3

          url: string
          readyState: number = MockWebSocket.CONNECTING
          protocol: string = ""
          extensions: string = ""
          bufferedAmount: number = 0
          binaryType: BinaryType = "blob"

          onopen: ((this: WebSocket, ev: Event) => unknown) | null = null
          onclose: ((this: WebSocket, ev: CloseEvent) => unknown) | null = null
          onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null = null
          onerror: ((this: WebSocket, ev: Event) => unknown) | null = null

          private subscriptions: Map<string, NostrFilter[]> = new Map()
          private connectionId: string

          constructor(url: string | URL, protocols?: string | string[]) {
            super()
            this.url = url.toString()
            this.connectionId = `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

            if (debug) {
              console.log(`[MockRelay] New connection: ${this.url}`)
            }

            mockConnections.set(this.connectionId, this)

            // Simulate connection opening after a short delay
            setTimeout(() => {
              this.readyState = MockWebSocket.OPEN
              const openEvent = new Event("open")
              this.dispatchEvent(openEvent)
              this.onopen?.call(this as unknown as WebSocket, openEvent)

              if (debug) {
                console.log(`[MockRelay] Connection opened: ${this.url}`)
              }
            }, latency)
          }

          send(data: string | ArrayBufferLike | Blob | ArrayBufferView): void {
            if (this.readyState !== MockWebSocket.OPEN) {
              throw new Error("WebSocket is not open")
            }

            try {
              const message = JSON.parse(data as string)
              this.handleMessage(message)
            } catch (e) {
              if (debug) {
                console.error("[MockRelay] Failed to parse message:", e)
              }
            }
          }

          close(code?: number, reason?: string): void {
            this.readyState = MockWebSocket.CLOSING

            setTimeout(() => {
              this.readyState = MockWebSocket.CLOSED
              mockConnections.delete(this.connectionId)

              const closeEvent = new CloseEvent("close", {
                code: code || 1000,
                reason: reason || "",
                wasClean: true,
              })
              this.dispatchEvent(closeEvent)
              this.onclose?.call(this as unknown as WebSocket, closeEvent)

              if (debug) {
                console.log(`[MockRelay] Connection closed: ${this.url}`)
              }
            }, latency)
          }

          private handleMessage(message: unknown[]): void {
            const [type, ...params] = message

            switch (type) {
              case "REQ":
                this.handleReq(params)
                break
              case "EVENT":
                this.handleEvent(params)
                break
              case "CLOSE":
                this.handleClose(params)
                break
              case "AUTH":
                this.handleAuth(params)
                break
              default:
                if (debug) {
                  console.log(`[MockRelay] Unknown message type: ${type}`)
                }
            }
          }

          private handleReq(params: unknown[]): void {
            const [subId, ...filters] = params as [string, ...NostrFilter[]]

            if (debug) {
              console.log(`[MockRelay] REQ ${subId}:`, filters)
            }

            this.subscriptions.set(subId, filters)

            // Notify the test about the subscription
            ;(window as unknown as {__mockRelaySubscribe: (subId: string, filters: NostrFilter[]) => void}).__mockRelaySubscribe?.(subId, filters)

            // Send matching events from seed data
            setTimeout(() => {
              const matchingEvents = seedEvents.filter((event: NostrEvent) =>
                this.eventMatchesFilters(event, filters),
              )

              for (const event of matchingEvents) {
                this.sendEvent(subId, event)
              }

              // Send EOSE (End of Stored Events)
              this.sendMessage(["EOSE", subId])
            }, latency)
          }

          private handleEvent(params: unknown[]): void {
            const event = params[0] as NostrEvent

            if (debug) {
              console.log(`[MockRelay] EVENT published:`, event)
            }

            // Notify the test about the published event
            ;(window as unknown as {__mockRelayPublish: (event: NostrEvent) => void}).__mockRelayPublish?.(event)

            // Send OK response
            setTimeout(() => {
              this.sendMessage(["OK", event.id, true, ""])
            }, latency)
          }

          private handleClose(params: unknown[]): void {
            const [subId] = params as [string]
            this.subscriptions.delete(subId)

            if (debug) {
              console.log(`[MockRelay] CLOSE ${subId}`)
            }
          }

          private handleAuth(params: unknown[]): void {
            const [event] = params as [NostrEvent]

            if (debug) {
              console.log(`[MockRelay] AUTH:`, event)
            }

            // Accept all auth attempts
            setTimeout(() => {
              this.sendMessage(["OK", event.id, true, ""])
            }, latency)
          }

          private eventMatchesFilters(event: NostrEvent, filters: NostrFilter[]): boolean {
            // Event matches if it matches ANY of the filters
            return filters.some((filter) => this.eventMatchesFilter(event, filter))
          }

          private eventMatchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
            // Check ids
            if (filter.ids && !filter.ids.includes(event.id)) {
              return false
            }

            // Check authors
            if (filter.authors && !filter.authors.includes(event.pubkey)) {
              return false
            }

            // Check kinds
            if (filter.kinds && !filter.kinds.includes(event.kind)) {
              return false
            }

            // Check since
            if (filter.since && event.created_at < filter.since) {
              return false
            }

            // Check until
            if (filter.until && event.created_at > filter.until) {
              return false
            }

            // Check tag filters (e.g., #e, #p, #a, #d, #r, #t)
            for (const [key, values] of Object.entries(filter)) {
              if (key.startsWith("#") && Array.isArray(values)) {
                const tagName = key.slice(1)
                const eventTagValues = event.tags
                  .filter((tag) => tag[0] === tagName)
                  .map((tag) => tag[1])

                // At least one of the filter values must match
                if (!values.some((v) => eventTagValues.includes(v))) {
                  return false
                }
              }
            }

            return true
          }

          private sendEvent(subId: string, event: NostrEvent): void {
            this.sendMessage(["EVENT", subId, event])
          }

          private sendMessage(message: unknown[]): void {
            const data = JSON.stringify(message)
            const messageEvent = new MessageEvent("message", {data})
            this.dispatchEvent(messageEvent)
            this.onmessage?.call(this as unknown as WebSocket, messageEvent)
          }
        }

        // Check if a URL should be intercepted
        function shouldIntercept(url: string): boolean {
          // If no specific URLs configured, intercept all wss:// URLs
          if (!interceptUrls || interceptUrls.length === 0) {
            return url.startsWith("wss://") || url.startsWith("ws://")
          }

          // Check if URL matches any of the configured patterns
          return interceptUrls.some((pattern) => {
            if (pattern.includes("*")) {
              const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$")
              return regex.test(url)
            }
            return url.startsWith(pattern)
          })
        }

        // Replace global WebSocket
        ;(window as unknown as {WebSocket: typeof WebSocket}).WebSocket = class ProxyWebSocket extends (
          OriginalWebSocket
        ) {
          constructor(url: string | URL, protocols?: string | string[]) {
            const urlStr = url.toString()

            if (shouldIntercept(urlStr)) {
              if (debug) {
                console.log(`[MockRelay] Intercepting: ${urlStr}`)
              }
              return new MockWebSocket(url, protocols) as unknown as WebSocket
            }

            if (debug) {
              console.log(`[MockRelay] Passing through: ${urlStr}`)
            }
            super(url, protocols)
          }
        }

        // Store reference for debugging
        ;(window as unknown as {__mockRelayConnections: typeof mockConnections}).__mockRelayConnections = mockConnections
        ;(window as unknown as {__mockRelayOriginalWebSocket: typeof OriginalWebSocket}).__mockRelayOriginalWebSocket = OriginalWebSocket

        if (debug) {
          console.log("[MockRelay] Mock WebSocket installed")
        }
      },
      {
        seedEvents: this.seedEventsList,
        debug: this.debug,
        interceptUrls: this.interceptUrls,
        latency: this.latency,
      },
    )
  }

  /**
   * Get all events published by the app during the test
   */
  getPublishedEvents(): NostrEvent[] {
    return [...this.publishedEvents]
  }

  /**
   * Get published events filtered by kind
   */
  getPublishedEventsByKind(kind: number): NostrEvent[] {
    return this.publishedEvents.filter((e) => e.kind === kind)
  }

  /**
   * Clear all captured published events
   */
  clear(): void {
    this.publishedEvents = []
  }

  /**
   * Add events that will be returned to the app when it queries
   *
   * Note: Must be called before setup(), or use injectEvents() for
   * adding events after the page has loaded.
   */
  seedEvents(events: NostrEvent[]): void {
    this.seedEventsList = [...this.seedEventsList, ...events]
  }

  /**
   * Inject events into the mock relay after the page has loaded
   *
   * This allows simulating real-time events being received from the relay.
   * The events will be sent to any active subscriptions that match the event.
   */
  async injectEvents(events: NostrEvent[]): Promise<void> {
    if (!this.page) {
      throw new Error("MockRelay not set up. Call setup(page) first.")
    }

    await this.page.evaluate(
      ({events, latency}) => {
        const connections = (
          window as unknown as {
            __mockRelayConnections: Map<string, {
              subscriptions: Map<string, NostrFilter[]>
              dispatchEvent: (event: Event) => void
              onmessage: ((this: WebSocket, ev: MessageEvent) => unknown) | null
            }>
          }
        ).__mockRelayConnections

        // Helper to check if event matches a filter
        function eventMatchesFilter(event: NostrEvent, filter: NostrFilter): boolean {
          if (filter.ids && !filter.ids.includes(event.id)) return false
          if (filter.authors && !filter.authors.includes(event.pubkey)) return false
          if (filter.kinds && !filter.kinds.includes(event.kind)) return false
          if (filter.since && event.created_at < filter.since) return false
          if (filter.until && event.created_at > filter.until) return false

          for (const [key, values] of Object.entries(filter)) {
            if (key.startsWith("#") && Array.isArray(values)) {
              const tagName = key.slice(1)
              const eventTagValues = event.tags
                .filter((tag: string[]) => tag[0] === tagName)
                .map((tag: string[]) => tag[1])
              if (!values.some((v: string) => eventTagValues.includes(v))) {
                return false
              }
            }
          }
          return true
        }

        // Send events to all matching subscriptions
        for (const connection of connections.values()) {
          for (const [subId, filters] of connection.subscriptions) {
            for (const event of events) {
              if (filters.some((f: NostrFilter) => eventMatchesFilter(event, f))) {
                setTimeout(() => {
                  const data = JSON.stringify(["EVENT", subId, event])
                  const messageEvent = new MessageEvent("message", {data})
                  connection.dispatchEvent(messageEvent)
                  connection.onmessage?.call(null as unknown as WebSocket, messageEvent)
                }, latency)
              }
            }
          }
        }
      },
      {events, latency: this.latency},
    )
  }

  /**
   * Wait for an event of a specific kind to be published
   *
   * @param kind - The event kind to wait for
   * @param timeout - Maximum time to wait in ms (default: 10000)
   * @returns The published event
   * @throws Error if timeout is reached
   */
  waitForEvent(kind: number, timeout: number = 10000): Promise<NostrEvent> {
    return new Promise((resolve, reject) => {
      // Check if we already have an event of this kind
      const existing = this.publishedEvents.find((e) => e.kind === kind)
      if (existing) {
        resolve(existing)
        return
      }

      // Set up a waiter
      if (!this.eventWaiters.has(kind)) {
        this.eventWaiters.set(kind, [])
      }
      this.eventWaiters.get(kind)!.push({resolve, reject})

      // Set up timeout
      setTimeout(() => {
        const waiters = this.eventWaiters.get(kind)
        if (waiters) {
          const index = waiters.findIndex((w) => w.resolve === resolve)
          if (index !== -1) {
            waiters.splice(index, 1)
            reject(new Error(`Timeout waiting for event kind ${kind}`))
          }
        }
      }, timeout)
    })
  }

  /**
   * Wait for multiple events matching a predicate
   */
  async waitForEvents(
    predicate: (event: NostrEvent) => boolean,
    count: number = 1,
    timeout: number = 10000,
  ): Promise<NostrEvent[]> {
    const startTime = Date.now()
    const result: NostrEvent[] = []

    while (result.length < count && Date.now() - startTime < timeout) {
      const matching = this.publishedEvents.filter(
        (e) => predicate(e) && !result.includes(e),
      )
      result.push(...matching)

      if (result.length < count) {
        await new Promise((r) => setTimeout(r, 100))
      }
    }

    if (result.length < count) {
      throw new Error(
        `Timeout: expected ${count} events, got ${result.length}`,
      )
    }

    return result
  }
}

// =============================================================================
// Event Fixtures - Helper functions to create test events
// =============================================================================

/**
 * NIP-34 event kinds
 */
export const NIP34_KINDS = {
  REPO_ANNOUNCEMENT: 30617,
  ISSUE: 1621,
  ISSUE_REPLY: 1622,
  STATUS: 1630, // 1630-1633 range
  PATCH: 1617,
  PATCH_SET: 1616,
} as const

/**
 * Generate a random hex string (for event IDs and pubkeys)
 */
export function randomHex(length: number = 64): string {
  const chars = "0123456789abcdef"
  let result = ""
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)]
  }
  return result
}

/**
 * Generate a current timestamp in seconds (Nostr uses seconds, not milliseconds)
 */
export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

/**
 * Create a minimal valid Nostr event
 */
export function createEvent(overrides: Partial<NostrEvent> & {kind: number}): NostrEvent {
  return {
    id: randomHex(64),
    pubkey: randomHex(64),
    created_at: nowSeconds(),
    kind: overrides.kind,
    tags: [],
    content: "",
    sig: randomHex(128),
    ...overrides,
  }
}

/**
 * Options for creating a repository announcement event
 */
export interface RepoAnnouncementOptions {
  /** Repository identifier (defaults to random) */
  id?: string
  /** Author pubkey (defaults to random) */
  pubkey?: string
  /** Repository name */
  name: string
  /** Repository description */
  description?: string
  /** Clone URLs */
  cloneUrls?: string[]
  /** Web URL */
  webUrl?: string
  /** Relays where the repo is announced */
  relays?: string[]
  /** Event timestamp (defaults to now) */
  created_at?: number
  /** Maintainers (pubkeys) */
  maintainers?: string[]
  /** License */
  license?: string
  /** Topics/tags */
  topics?: string[]
}

/**
 * Create a NIP-34 repository announcement event (kind 30617)
 */
export function createRepoAnnouncement(options: RepoAnnouncementOptions): NostrEvent {
  const pubkey = options.pubkey || randomHex(64)
  const tags: string[][] = []

  // d tag (identifier)
  const dTag = options.id || options.name.toLowerCase().replace(/[^a-z0-9-]/g, "-")
  tags.push(["d", dTag])

  // name
  tags.push(["name", options.name])

  // description
  if (options.description) {
    tags.push(["description", options.description])
  }

  // clone URLs
  if (options.cloneUrls) {
    for (const url of options.cloneUrls) {
      tags.push(["clone", url])
    }
  }

  // web URL
  if (options.webUrl) {
    tags.push(["web", options.webUrl])
  }

  // relays
  if (options.relays) {
    for (const relay of options.relays) {
      tags.push(["relay", relay])
    }
  }

  // maintainers
  if (options.maintainers) {
    for (const m of options.maintainers) {
      tags.push(["p", m, "", "maintainer"])
    }
  }

  // license
  if (options.license) {
    tags.push(["license", options.license])
  }

  // topics
  if (options.topics) {
    for (const topic of options.topics) {
      tags.push(["t", topic])
    }
  }

  return createEvent({
    kind: NIP34_KINDS.REPO_ANNOUNCEMENT,
    pubkey,
    created_at: options.created_at ?? nowSeconds(),
    tags,
    content: "",
  })
}

/**
 * Options for creating an issue event
 */
export interface IssueOptions {
  /** Issue event ID (defaults to random) */
  id?: string
  /** Author pubkey (defaults to random) */
  pubkey?: string
  /** Issue title */
  title: string
  /** Issue body/description */
  body?: string
  /** Repository reference (naddr or "a" tag value) */
  repoRef: string
  /** Labels */
  labels?: string[]
  /** Event timestamp (defaults to now) */
  created_at?: number
}

/**
 * Create a NIP-34 issue event (kind 1621)
 */
export function createIssue(options: IssueOptions): NostrEvent {
  const tags: string[][] = []

  // Repository reference (using "a" tag for addressable event reference)
  tags.push(["a", options.repoRef])

  // Labels
  if (options.labels) {
    for (const label of options.labels) {
      tags.push(["t", label])
    }
  }

  // Title as first line of content, body as rest
  const content = options.body
    ? `${options.title}\n\n${options.body}`
    : options.title

  return createEvent({
    id: options.id,
    kind: NIP34_KINDS.ISSUE,
    pubkey: options.pubkey || randomHex(64),
    created_at: options.created_at ?? nowSeconds(),
    tags,
    content,
  })
}

/**
 * Options for creating an issue reply/comment
 */
export interface IssueReplyOptions {
  /** Author pubkey (defaults to random) */
  pubkey?: string
  /** Comment content */
  content: string
  /** Issue event ID (e tag) */
  issueId: string
  /** Root event ID (for threading) */
  rootId?: string
  /** Event timestamp (defaults to now) */
  created_at?: number
}

/**
 * Create a NIP-34 issue reply event (kind 1622)
 */
export function createIssueReply(options: IssueReplyOptions): NostrEvent {
  const tags: string[][] = []

  // Reference to the issue
  const rootId = options.rootId || options.issueId
  tags.push(["e", rootId, "", "root"])

  if (options.issueId !== rootId) {
    tags.push(["e", options.issueId, "", "reply"])
  }

  return createEvent({
    kind: NIP34_KINDS.ISSUE_REPLY,
    pubkey: options.pubkey || randomHex(64),
    created_at: options.created_at ?? nowSeconds(),
    tags,
    content: options.content,
  })
}

/**
 * Options for creating a patch event
 */
export interface PatchOptions {
  /** Author pubkey (defaults to random) */
  pubkey?: string
  /** Patch title/subject */
  title: string
  /** Patch content (diff) */
  diff: string
  /** Repository reference */
  repoRef: string
  /** Commit ID */
  commitId?: string
  /** Parent commit ID */
  parentCommit?: string
  /** Event timestamp (defaults to now) */
  created_at?: number
}

/**
 * Create a NIP-34 patch event (kind 1617)
 */
export function createPatch(options: PatchOptions): NostrEvent {
  const tags: string[][] = []

  // Repository reference
  tags.push(["a", options.repoRef])

  // Commit reference
  if (options.commitId) {
    tags.push(["commit", options.commitId])
  }

  // Parent commit
  if (options.parentCommit) {
    tags.push(["parent-commit", options.parentCommit])
  }

  // Title
  tags.push(["subject", options.title])

  return createEvent({
    kind: NIP34_KINDS.PATCH,
    pubkey: options.pubkey || randomHex(64),
    created_at: options.created_at ?? nowSeconds(),
    tags,
    content: options.diff,
  })
}

/**
 * Options for creating a status event
 */
export interface StatusOptions {
  /** Author pubkey (defaults to random) */
  pubkey?: string
  /** Status kind (1630-1633, defaults to 1630 for open) */
  statusKind?: number
  /** Event being statused (issue or patch) */
  targetId: string
  /** Repository reference */
  repoRef: string
  /** Status content/reason */
  content?: string
  /** Event timestamp (defaults to now) */
  created_at?: number
}

/**
 * Create a NIP-34 status event (kind 1630-1633)
 *
 * Status kinds:
 * - 1630: Open
 * - 1631: Applied/Merged (for patches)
 * - 1632: Closed
 * - 1633: Draft
 */
export function createStatus(options: StatusOptions): NostrEvent {
  const tags: string[][] = []

  // Target event reference
  tags.push(["e", options.targetId])

  // Repository reference
  tags.push(["a", options.repoRef])

  return createEvent({
    kind: options.statusKind ?? 1630,
    pubkey: options.pubkey || randomHex(64),
    created_at: options.created_at ?? nowSeconds(),
    tags,
    content: options.content || "",
  })
}

// =============================================================================
// Test Data Builders - For creating complete test scenarios
// =============================================================================

/**
 * A builder for creating complete test scenarios with related events
 */
export class TestScenarioBuilder {
  private events: NostrEvent[] = []
  private repoCounter = 0
  private issueCounter = 0

  /**
   * Add a repository with optional issues
   */
  addRepo(options: RepoAnnouncementOptions & {issues?: Omit<IssueOptions, "repoRef">[]}): this {
    const repo = createRepoAnnouncement(options)
    this.events.push(repo)
    this.repoCounter++

    // Build the "a" tag reference for the repo
    const dTag = repo.tags.find((t) => t[0] === "d")?.[1] || ""
    const repoRef = `${NIP34_KINDS.REPO_ANNOUNCEMENT}:${repo.pubkey}:${dTag}`

    // Add issues if provided
    if (options.issues) {
      for (const issueOpts of options.issues) {
        const issue = createIssue({...issueOpts, repoRef})
        this.events.push(issue)
        this.issueCounter++
      }
    }

    return this
  }

  /**
   * Add a standalone issue
   */
  addIssue(options: IssueOptions): this {
    this.events.push(createIssue(options))
    this.issueCounter++
    return this
  }

  /**
   * Add a custom event
   */
  addEvent(event: NostrEvent): this {
    this.events.push(event)
    return this
  }

  /**
   * Build the list of events
   */
  build(): NostrEvent[] {
    return [...this.events]
  }

  /**
   * Clear all events
   */
  clear(): this {
    this.events = []
    this.repoCounter = 0
    this.issueCounter = 0
    return this
  }
}

/**
 * Create a test scenario builder
 */
export function scenario(): TestScenarioBuilder {
  return new TestScenarioBuilder()
}

// =============================================================================
// Pre-built Test Fixtures
// =============================================================================

/**
 * A test user with consistent pubkey
 */
export const TEST_USERS = {
  alice: {
    pubkey: "a".repeat(64),
    name: "alice",
  },
  bob: {
    pubkey: "b".repeat(64),
    name: "bob",
  },
  charlie: {
    pubkey: "c".repeat(64),
    name: "charlie",
  },
} as const

/**
 * Pre-built test repositories
 */
export function createTestRepo(name: string = "test-repo"): NostrEvent {
  return createRepoAnnouncement({
    pubkey: TEST_USERS.alice.pubkey,
    name,
    description: `A test repository named ${name}`,
    cloneUrls: [`https://github.com/test/${name}.git`],
    maintainers: [TEST_USERS.alice.pubkey],
    license: "MIT",
    topics: ["test", "nostr"],
  })
}

/**
 * Create a complete test scenario with a repo, issues, and patches
 */
export function createFullTestScenario(): NostrEvent[] {
  const repoOwner = TEST_USERS.alice.pubkey
  const contributor = TEST_USERS.bob.pubkey

  const repo = createRepoAnnouncement({
    pubkey: repoOwner,
    name: "test-project",
    description: "A complete test project",
    cloneUrls: ["https://github.com/test/test-project.git"],
    maintainers: [repoOwner],
  })

  const repoRef = `${NIP34_KINDS.REPO_ANNOUNCEMENT}:${repoOwner}:test-project`

  const issue1 = createIssue({
    pubkey: contributor,
    title: "Bug: Something is broken",
    body: "When I click the button, nothing happens.",
    repoRef,
    labels: ["bug"],
  })

  const issue1Reply = createIssueReply({
    pubkey: repoOwner,
    content: "Thanks for reporting! I'll look into this.",
    issueId: issue1.id,
  })

  const issue2 = createIssue({
    pubkey: repoOwner,
    title: "Feature: Add dark mode",
    body: "Would be nice to have a dark mode option.",
    repoRef,
    labels: ["enhancement"],
  })

  const patch1 = createPatch({
    pubkey: contributor,
    title: "Fix button click handler",
    diff: `--- a/src/button.ts
+++ b/src/button.ts
@@ -10,6 +10,7 @@ export function handleClick() {
   // Handle button click
+  console.log("Button clicked")
 }`,
    repoRef,
    commitId: "abc123",
  })

  return [repo, issue1, issue1Reply, issue2, patch1]
}
