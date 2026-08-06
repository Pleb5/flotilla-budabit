import {EventEmitter} from "node:events"
import {describe, expect, it, vi} from "vitest"
import {readFileSync} from "node:fs"
import {finalizeEvent, generateSecretKey, getPublicKey} from "nostr-tools/pure"
import {AuthStateEvent, AuthStatus} from "@welshman/net"
import type {TrustedEvent} from "@welshman/util"
import {
  buildCommunityDefinition,
  parseCommunityDefinition,
  type CommunityEmailDigestService,
} from "./community"
import {
  EMAIL_DIGEST_CHANNEL,
  EMAIL_DIGEST_DTAG,
  EMAIL_DIGEST_SETTINGS_DTAG,
  EMAIL_DIGEST_STATUS_KIND,
  EMAIL_DIGEST_SUBSCRIPTION_KIND,
  assertEmailDigestProviderQueryComplete,
  buildEmailDigestPayload,
  buildEmailDigestRepositories,
  decryptEmailDigestSettingsEvent,
  discoverEmailDigestProviders,
  getEmailDigestHandlerFilter,
  getNextEmailDigestCreatedAt,
  isEmailDigestVerificationPending,
  normalizeEmailDigestSettings,
  parseEmailDigestStatus,
  runBestEffortEmailDigestSync,
  runEmailDigestDisableSequence,
  runEmailDigestSaveSequence,
  selectEmailDigestProviderIdentity,
  selectEmailDigestStatusEvent,
  selectEmailDigestSubscriptionEvent,
  shouldAutoSyncEmailDigest,
  shouldAutoSyncEmailDigestProviderState,
  type EmailDigestState,
  type EmailDigestStatus,
  type EmailDigestSettings,
} from "./email-digest"
import {defaultRepoWatchOptions, type RepoWatchState} from "./repo-watch"
import {
  getEmailDigestAuthRelays,
  getPersistedEmailDigestAuthRelay,
  isEmailDigestAuthRelay,
  setEmailDigestAuthRelay,
  waitForEmailDigestAuth,
  withTemporaryEmailDigestAuthRelay,
} from "./email-digest-auth"

const communitySecretA = generateSecretKey()
const communitySecretB = generateSecretKey()
const userSecret = generateSecretKey()
const serviceSecret = generateSecretKey()
const handlerSecret = generateSecretKey()
const communityA = getPublicKey(communitySecretA)
const communityB = getPublicKey(communitySecretB)
const userPubkey = getPublicKey(userSecret)
const servicePubkey = getPublicKey(serviceSecret)
const handlerPubkey = getPublicKey(handlerSecret)
const provider: CommunityEmailDigestService = {
  servicePubkey,
  requestRelay: "wss://requests.example.com/",
  handlerAddress: `31990:${handlerPubkey}:git-digest`,
  handlerRelay: "wss://handlers.example.com/",
}

const makeDefinition = (
  secret: Uint8Array,
  services: CommunityEmailDigestService[],
  createdAt: number,
) => {
  const template = buildCommunityDefinition({
    relays: ["wss://community.example.com"],
    sections: [{name: "General", kinds: [{kind: 1111}]}],
    emailDigestServices: services,
  })
  return parseCommunityDefinition(finalizeEvent({...template, created_at: createdAt}, secret))!
}

const makeWatchState = (repos: RepoWatchState["repos"]): RepoWatchState => ({
  version: 1,
  repos,
  notificationSeen: {"/git/ignored": 123},
})

const makeDigestRepository = (overrides: Record<string, unknown> = {}) => ({
  address: `30617:${"a".repeat(64)}:repo`,
  name: "repo",
  relays: ["wss://relay.example.com/"],
  options: {
    issues: {new: true, comments: false},
    prs: {new: true, comments: false, updates: true},
    status: {open: true, draft: true, applied: true, closed: true},
    assignments: true,
  },
  ...overrides,
})

const makePayload = (overrides: Record<string, unknown> = {}) =>
  buildEmailDigestPayload({
    email: "person@example.com",
    manageUrl: "https://budabit.example.com/settings/notifications",
    intervalDays: 1,
    localTime: "09:00",
    timezone: "UTC",
    provider,
    repositories: [makeDigestRepository()],
    ...overrides,
  })

describe("email digest settings", () => {
  it("keeps encrypted settings out of the shared plaintext cache", () => {
    const source = readFileSync(new URL("./email-digest-state.ts", import.meta.url), "utf8")
    expect(source).not.toContain("ensurePlaintext")
    expect(source).not.toContain("setPlaintext")
  })

  it("normalizes versioned settings and preserves a valid provider snapshot", () => {
    expect(
      normalizeEmailDigestSettings({
        version: 1,
        enabled: true,
        email: "  Person@Example.COM ",
        intervalDays: 3,
        localTime: "08:45",
        timezone: "Europe/London",
        selectedCommunityPubkey: communityA.toUpperCase(),
        provider: {...provider, requestRelay: "WSS://REQUESTS.EXAMPLE.COM"},
        publicEmail: "must-not-survive@example.com",
      }),
    ).toEqual({
      version: 1,
      enabled: true,
      email: "person@example.com",
      intervalDays: 3,
      localTime: "08:45",
      timezone: "Europe/London",
      selectedCommunityPubkey: communityA,
      provider,
    })
    expect(EMAIL_DIGEST_SETTINGS_DTAG).toBe("budabit/email-digest-settings")
  })

  it("disables malformed enabled settings instead of retaining partial values", () => {
    const normalized = normalizeEmailDigestSettings({
      version: 1,
      enabled: true,
      email: "not-an-email",
      intervalDays: 31,
      localTime: "25:00",
      timezone: "Not/AZone",
      selectedCommunityPubkey: "bad",
      provider,
    })

    expect(normalized).toMatchObject({
      version: 1,
      enabled: false,
      email: "",
      intervalDays: 7,
      localTime: "09:00",
      selectedCommunityPubkey: "",
    })
  })

  it("does not interpret unversioned or unsupported preference payloads", () => {
    const normalized = normalizeEmailDigestSettings({
      version: 2,
      enabled: true,
      email: "person@example.com",
      selectedCommunityPubkey: communityA,
      provider,
    })

    expect(normalized).toMatchObject({version: 1, enabled: false, email: ""})
    expect(normalized.provider).toBeUndefined()
  })

  it("decrypts self-encrypted settings directly for only the active signer", async () => {
    const event = {
      id: "settings",
      pubkey: userPubkey,
      created_at: 1,
      kind: 30078,
      tags: [["d", EMAIL_DIGEST_SETTINGS_DTAG]],
      content: "ciphertext",
      sig: "sig",
    } as TrustedEvent
    const decrypt = vi.fn().mockResolvedValue(
      JSON.stringify({
        version: 1,
        enabled: true,
        email: "Person@Example.com",
        intervalDays: 7,
        localTime: "09:00",
        timezone: "UTC",
        selectedCommunityPubkey: communityA,
        provider,
      }),
    )

    await expect(
      decryptEmailDigestSettingsEvent({event, activePubkey: userPubkey, decrypt}),
    ).resolves.toMatchObject({enabled: true, email: "person@example.com"})
    expect(decrypt).toHaveBeenCalledWith(userPubkey, "ciphertext")
    await expect(
      decryptEmailDigestSettingsEvent({event, activePubkey: communityA, decrypt}),
    ).rejects.toThrow("active signer")
  })
})

describe("verified email digest provider discovery", () => {
  it("deduplicates descriptors, retains endorsements, and puts the active community first", () => {
    const activeDefinition = makeDefinition(communitySecretA, [provider], 20)
    const memberDefinition = makeDefinition(communitySecretB, [provider], 30)
    const providers = discoverEmailDigestProviders({
      activeCommunityDefinition: activeDefinition,
      communityRefs: [
        {
          communityPubkey: communityB,
          definition: memberDefinition,
          relayHints: [],
          roles: ["member"],
          writableSections: [],
        },
      ],
    })

    expect(providers).toHaveLength(1)
    expect(providers[0]).toMatchObject({...provider, isActiveCommunity: true})
    expect(providers[0].endorsingCommunityPubkeys).toEqual([communityA, communityB])
  })

  it("rejects a kind 10222 definition with an invalid signature", () => {
    const definition = makeDefinition(communitySecretA, [provider], 20)
    const invalid = {
      ...definition,
      event: {...definition.event, sig: "0".repeat(128)},
    }

    expect(
      discoverEmailDigestProviders({
        activeCommunityDefinition: invalid,
        communityRefs: [],
      }),
    ).toEqual([])
  })

  it("uses signed handler metadata as the provider identity fallback", () => {
    const handler = finalizeEvent(
      {
        kind: 31990,
        created_at: 100,
        content: "",
        tags: [
          ["d", "git-digest"],
          ["name", "Budabit Email Digest"],
          ["about", "Repository activity by email"],
          ["image", "https://budabit.example/digest.png"],
        ],
      },
      handlerSecret,
    )

    expect(getEmailDigestHandlerFilter(provider)).toEqual({
      kinds: [31990],
      authors: [handlerPubkey],
      "#d": ["git-digest"],
      limit: 5,
    })
    expect(selectEmailDigestProviderIdentity([handler], provider)).toEqual({
      name: "Budabit Email Digest",
      about: "Repository activity by email",
      picture: "https://budabit.example/digest.png",
    })
    expect(
      selectEmailDigestProviderIdentity([{...handler, sig: "0".repeat(128)}], provider),
    ).toBeUndefined()
  })
})

describe("email digest repository and payload building", () => {
  it("uses watched repositories only, normalizes relay limits, and never emits reviews", () => {
    const repoOwner = "a".repeat(64)
    const address = `30617:${repoOwner}:project`
    const watchOptions = {
      ...structuredClone(defaultRepoWatchOptions),
      issues: {new: true, comments: true},
      prs: {new: false, comments: true, updates: true},
      reviews: true,
      activityFilter: "maintainers" as const,
    }
    const announcement = {
      id: "1".repeat(64),
      pubkey: repoOwner,
      created_at: 1,
      kind: 30617,
      tags: [
        ["d", "project"],
        ["name", "Project Display"],
        [
          "relays",
          "wss://one.example.com",
          "ws://insecure.example.com",
          "wss://two.example.com",
          "wss://three.example.com",
          "wss://four.example.com",
        ],
      ],
      content: "",
      sig: "",
    }
    const repositories = buildEmailDigestRepositories({
      watchState: makeWatchState({[address]: watchOptions}),
      announcements: [announcement],
      fallbackRelays: ["wss://fallback.example.com"],
    })
    const payload = buildEmailDigestPayload({
      email: "person@example.com",
      locale: "en-GB",
      manageUrl: "https://budabit.example.com/settings/notifications",
      intervalDays: 7,
      localTime: "09:30",
      timezone: "Europe/London",
      provider,
      repositories,
    })

    expect(repositories).toEqual([
      {
        address,
        name: "Project Display",
        relays: ["wss://one.example.com/", "wss://two.example.com/", "wss://three.example.com/"],
        options: {
          issues: {new: true, comments: true},
          prs: {new: false, comments: true, updates: true},
          status: {open: true, draft: true, applied: true, closed: true},
          assignments: true,
        },
      },
    ])
    expect(payload).toEqual({
      version: 1,
      channel: EMAIL_DIGEST_CHANNEL,
      email: "person@example.com",
      locale: "en-GB",
      manageUrl: "https://budabit.example.com/settings/notifications",
      cadence: {intervalDays: 7, localTime: "09:30", timezone: "Europe/London"},
      handler: {address: provider.handlerAddress, relay: provider.handlerRelay},
      repositories,
    })
    expect(JSON.stringify(payload)).not.toContain("reviews")
    expect(JSON.stringify(payload)).not.toContain("notificationSeen")
    expect(JSON.stringify(payload)).not.toContain("activityFilter")
  })

  it("fails rather than truncating more than 50 watched repositories", () => {
    const repos = Object.fromEntries(
      Array.from({length: 51}, (_, index) => [
        `30617:${"a".repeat(64)}:repo-${index}`,
        defaultRepoWatchOptions,
      ]),
    )

    expect(() =>
      buildEmailDigestRepositories({
        watchState: makeWatchState(repos),
        announcements: [],
        fallbackRelays: ["wss://fallback.example.com"],
      }),
    ).toThrow("at most 50 watched repositories")
  })

  it("fails when per-repository relay normalization exceeds 20 unique relays", () => {
    const owner = "a".repeat(64)
    const repos: RepoWatchState["repos"] = {}
    const announcements: TrustedEvent[] = []
    for (let index = 0; index < 7; index++) {
      const identifier = `repo-${index}`
      repos[`30617:${owner}:${identifier}`] = defaultRepoWatchOptions
      announcements.push({
        id: String(index).padStart(64, "0"),
        pubkey: owner,
        created_at: index,
        kind: 30617,
        tags: [
          ["d", identifier],
          [
            "relays",
            `wss://${index}-a.example.com`,
            `wss://${index}-b.example.com`,
            `wss://${index}-c.example.com`,
          ],
        ],
        content: "",
        sig: "",
      })
    }

    expect(() =>
      buildEmailDigestRepositories({
        watchState: makeWatchState(repos),
        announcements,
        fallbackRelays: [],
      }),
    ).toThrow("21 relays")
  })

  it("requires the strict HTTPS notification management route", () => {
    expect(() =>
      makePayload({
        manageUrl: "http://budabit.example.com/settings/notifications",
      }),
    ).toThrow("HTTPS Budabit notifications URL")
  })

  it("preserves relay query strings and rejects credentials or fragments", () => {
    const relay = "wss://relay.example.com/path?token=AbC%2F123"
    expect(makePayload({repositories: [makeDigestRepository({relays: [relay]})]})).toMatchObject({
      repositories: [{relays: [relay]}],
    })

    for (const invalidRelay of [
      "wss://user@relay.example.com/",
      "wss://user:pass@relay.example.com/",
      "wss://relay.example.com/#fragment",
      "ws://relay.example.com/",
    ]) {
      expect(() =>
        makePayload({repositories: [makeDigestRepository({relays: [invalidRelay]})]}),
      ).toThrow("unique secure WebSocket relays")
    }
  })

  it("rejects invalid repository identifiers and display names", () => {
    expect(() =>
      makePayload({
        repositories: [
          makeDigestRepository({address: `30617:${"a".repeat(64)}:${"x".repeat(201)}`}),
        ],
      }),
    ).toThrow("Invalid digest repository address")
    expect(() => makePayload({repositories: [makeDigestRepository({name: "bad\nname"})]})).toThrow(
      "Invalid repository name",
    )
    expect(() =>
      makePayload({repositories: [makeDigestRepository({name: "x".repeat(201)})]}),
    ).toThrow("Invalid repository name")
  })

  it("rejects configurations with no enabled event options", () => {
    expect(() =>
      makePayload({
        repositories: [
          makeDigestRepository({
            options: {
              issues: {new: false, comments: false},
              prs: {new: false, comments: false, updates: false},
              status: {open: false, draft: false, applied: false, closed: false},
              assignments: false,
            },
          }),
        ],
      }),
    ).toThrow("at least one supported email digest event option")
  })

  it("normalizes delivery email lowercase and enforces the 64 KiB UTF-8 limit", () => {
    expect(makePayload({email: "Person@Example.COM"}).email).toBe("person@example.com")
    const longRelays = Array.from(
      {length: 3},
      (_, index) => `wss://relay-${index}.example.com/?token=${"x".repeat(500)}`,
    )
    expect(() =>
      makePayload({
        repositories: Array.from({length: 50}, (_, index) =>
          makeDigestRepository({
            address: `30617:${"a".repeat(64)}:large-${index}`,
            relays: longRelays,
          }),
        ),
      }),
    ).toThrow("64 KiB")
  })

  it("matches Anchor email and locale validation", () => {
    expect(makePayload({email: "Valid+tag@Sub.Example.com"}).email).toBe(
      "valid+tag@sub.example.com",
    )
    for (const email of [
      ".person@example.com",
      "person..name@example.com",
      "person@example",
      "person@-example.com",
      `${"x".repeat(65)}@example.com`,
    ]) {
      expect(() => makePayload({email})).toThrow("valid delivery email")
    }

    expect(makePayload({locale: "EN-us"}).locale).toBe("en-US")
    expect(() => makePayload({locale: "en_US"})).toThrow("valid locale")
    expect(() => makePayload({locale: "x".repeat(65)})).toThrow("valid locale")
  })

  it("counts only repository relays toward the 20-relay limit", () => {
    const repositories = Array.from({length: 20}, (_, index) =>
      makeDigestRepository({
        address: `30617:${"a".repeat(64)}:repo-${index}`,
        relays: [`wss://repo-${index}.example.com/`],
      }),
    )
    const payload = makePayload({
      provider: {...provider, handlerRelay: "wss://separate-handler.example.com/"},
      repositories,
    })

    expect(payload.repositories).toHaveLength(20)
    expect(payload.handler.relay).toBe("wss://separate-handler.example.com/")
  })
})

describe("email digest event and status restrictions", () => {
  it("increments replacement timestamps monotonically within one second", () => {
    expect(getNextEmailDigestCreatedAt(undefined, 100)).toBe(100)
    expect(getNextEmailDigestCreatedAt(100, 100)).toBe(101)
    expect(getNextEmailDigestCreatedAt(105, 100)).toBe(106)
  })

  it("accepts only signed events with the expected author and exact tags", () => {
    const subscription = finalizeEvent(
      {
        kind: EMAIL_DIGEST_SUBSCRIPTION_KIND,
        created_at: 10,
        tags: [
          ["d", EMAIL_DIGEST_DTAG],
          ["p", servicePubkey],
        ],
        content: "encrypted",
      },
      userSecret,
    )
    const extraTag = finalizeEvent(
      {...subscription, created_at: 11, tags: [...subscription.tags, ["x", "unexpected"]]},
      userSecret,
    )
    const wrongAuthor = finalizeEvent(
      {
        kind: EMAIL_DIGEST_SUBSCRIPTION_KIND,
        created_at: 12,
        tags: subscription.tags,
        content: "encrypted",
      },
      serviceSecret,
    )
    const status = finalizeEvent(
      {
        kind: EMAIL_DIGEST_STATUS_KIND,
        created_at: 10,
        tags: [
          ["d", EMAIL_DIGEST_DTAG],
          ["p", userPubkey],
        ],
        content: "encrypted",
      },
      serviceSecret,
    )
    const invalidStatus = {...status, sig: "0".repeat(128)}

    expect(
      selectEmailDigestSubscriptionEvent(
        [extraTag, wrongAuthor, subscription],
        userPubkey,
        provider,
      ),
    ).toEqual(subscription)
    expect(selectEmailDigestStatusEvent([invalidStatus, status], userPubkey, provider)).toEqual(
      status,
    )
  })

  it("parses only version-1 email digest status payloads", () => {
    const status = {
      version: 1,
      channel: "email-digest",
      status: "ok",
      state: "active",
      message: "Scheduled",
      emailConfirmed: true,
      nextRunAt: 100,
      lastCompletedAt: null,
    } as const

    expect(parseEmailDigestStatus(status)).toEqual(status)
    expect(parseEmailDigestStatus({...status, status: "active"})).toBeUndefined()
    expect(parseEmailDigestStatus({...status, state: "inactive"})).toBeUndefined()
    expect(parseEmailDigestStatus({...status, nextRunAt: "100"})).toBeUndefined()
    expect(parseEmailDigestStatus({...status, extra: true})).toBeUndefined()
    const {emailConfirmed: _emailConfirmed, ...missingField} = status
    expect(parseEmailDigestStatus(missingField)).toBeUndefined()
  })

  it("identifies provider status that still requires email verification", () => {
    const pending = {
      version: 1,
      channel: "email-digest",
      status: "pending",
      state: "pending",
      message: "Confirm your email",
      emailConfirmed: false,
      nextRunAt: null,
      lastCompletedAt: null,
    } as const

    expect(isEmailDigestVerificationPending(pending)).toBe(true)
    expect(isEmailDigestVerificationPending({...pending, emailConfirmed: true})).toBe(false)
    expect(
      isEmailDigestVerificationPending({
        ...pending,
        status: "ok",
        state: "active",
        emailConfirmed: true,
      }),
    ).toBe(false)
    expect(isEmailDigestVerificationPending()).toBe(false)
  })

  it("publishes disable deletion only for a loaded subscription and makes it newer", async () => {
    const order: string[] = []
    const publishDeletion = vi.fn(async (createdAt: number) => order.push(`delete:${createdAt}`))
    const persistDisabled = vi.fn(async () => {
      order.push("persist")
      return "disabled"
    })

    await expect(
      runEmailDigestDisableSequence({
        subscriptionCreatedAt: 100,
        currentTime: 100,
        publishDeletion,
        persistDisabled,
      }),
    ).resolves.toBe("disabled")
    expect(order).toEqual(["delete:101", "persist"])

    order.length = 0
    publishDeletion.mockClear()
    await runEmailDigestDisableSequence({publishDeletion, persistDisabled})
    expect(publishDeletion).not.toHaveBeenCalled()
    expect(order).toEqual(["persist"])
  })

  it("persists the next snapshot before registration and retains publication errors", async () => {
    const order: string[] = []
    const publicationError = new Error("provider rejected registration")

    await expect(
      runEmailDigestSaveSequence({
        switchingProvider: true,
        deleteOldProvider: async () => {
          order.push("delete-old")
        },
        persistNextSettings: async () => {
          order.push("persist-next-enabled")
        },
        publishNewRegistration: async () => {
          order.push("publish-new")
          throw publicationError
        },
      }),
    ).rejects.toBe(publicationError)
    expect(order).toEqual(["delete-old", "persist-next-enabled", "publish-new"])
  })

  it("requires authenticated EOSE and rejects every incomplete query ending", () => {
    expect(() =>
      assertEmailDigestProviderQueryComplete({
        authenticated: true,
        eose: true,
        timedOut: false,
        disconnected: false,
      }),
    ).not.toThrow()
    expect(() =>
      assertEmailDigestProviderQueryComplete({
        authenticated: true,
        eose: false,
        timedOut: true,
        disconnected: false,
      }),
    ).toThrow("timed out")
    expect(() =>
      assertEmailDigestProviderQueryComplete({
        authenticated: true,
        eose: false,
        timedOut: false,
        closedReason: "restricted",
        disconnected: false,
      }),
    ).toThrow("restricted")
    expect(() =>
      assertEmailDigestProviderQueryComplete({
        authenticated: true,
        eose: false,
        timedOut: false,
        disconnected: true,
      }),
    ).toThrow("disconnected")
    expect(() =>
      assertEmailDigestProviderQueryComplete({
        authenticated: false,
        eose: true,
        timedOut: false,
        disconnected: false,
      }),
    ).toThrow("authentication")
    expect(() =>
      assertEmailDigestProviderQueryComplete({
        authenticated: true,
        eose: false,
        timedOut: false,
        disconnected: false,
      }),
    ).toThrow("before EOSE")
  })
})

describe("email digest watch auto-sync boundaries", () => {
  const enabledSettings: EmailDigestSettings = {
    version: 1,
    enabled: true,
    email: "person@example.com",
    intervalDays: 7,
    localTime: "09:00",
    timezone: "UTC",
    selectedCommunityPubkey: communityA,
    provider,
  }

  it("syncs only enabled digests whose exact provider remains advertised", () => {
    expect(shouldAutoSyncEmailDigest(enabledSettings, [provider])).toBe(true)
    expect(shouldAutoSyncEmailDigest({...enabledSettings, enabled: false}, [provider])).toBe(false)
    expect(
      shouldAutoSyncEmailDigest(enabledSettings, [
        {...provider, requestRelay: "wss://other.example.com/"},
      ]),
    ).toBe(false)
  })

  it("swallows synchronization failures after the watch save boundary", async () => {
    const onError = vi.fn()
    const sync = vi.fn().mockRejectedValue(new Error("provider unavailable"))

    await expect(runBestEffortEmailDigestSync({shouldSync: true, sync, onError})).resolves.toBe(
      false,
    )
    expect(sync).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledOnce()

    sync.mockClear()
    await expect(runBestEffortEmailDigestSync({shouldSync: false, sync, onError})).resolves.toBe(
      false,
    )
    expect(sync).not.toHaveBeenCalled()
  })

  it("does not auto-reactivate terminal provider states", async () => {
    const makeStatus = (state: EmailDigestState): EmailDigestStatus => ({
      version: 1,
      channel: "email-digest",
      status: state === "active" ? "ok" : "inactive",
      state,
      message: "",
      emailConfirmed: state === "active",
      nextRunAt: null,
      lastCompletedAt: null,
    })

    expect(shouldAutoSyncEmailDigestProviderState()).toBe(true)
    expect(shouldAutoSyncEmailDigestProviderState(makeStatus("pending"))).toBe(true)
    expect(shouldAutoSyncEmailDigestProviderState(makeStatus("active"))).toBe(true)
    for (const state of ["unsubscribed", "deleted", "suppressed", "error"] as const) {
      expect(shouldAutoSyncEmailDigestProviderState(makeStatus(state))).toBe(false)
    }
    await expect(
      runBestEffortEmailDigestSync({shouldSync: true, sync: async () => false}),
    ).resolves.toBe(false)
  })
})

describe("email digest relay authentication scope", () => {
  it("keeps only the currently selected provider relay", () => {
    setEmailDigestAuthRelay("WSS://FIRST.EXAMPLE.COM/?token=AbC")
    expect(getEmailDigestAuthRelays()).toEqual(["wss://first.example.com/?token=abc"])
    expect(isEmailDigestAuthRelay("wss://first.example.com/?token=AbC")).toBe(true)

    setEmailDigestAuthRelay("wss://second.example.com")
    expect(getEmailDigestAuthRelays()).toEqual(["wss://second.example.com/"])
    expect(isEmailDigestAuthRelay("wss://first.example.com")).toBe(false)

    setEmailDigestAuthRelay("wss://user@invalid.example.com")
    expect(getEmailDigestAuthRelays()).toEqual([])

    setEmailDigestAuthRelay()
    expect(getEmailDigestAuthRelays()).toEqual([])
  })

  it("restores only the persisted enabled provider after temporary queries", async () => {
    expect(getPersistedEmailDigestAuthRelay({enabled: false, provider})).toBeUndefined()
    expect(getPersistedEmailDigestAuthRelay({enabled: true, provider})).toBe(provider.requestRelay)

    setEmailDigestAuthRelay(provider.requestRelay)
    await withTemporaryEmailDigestAuthRelay({
      relay: "wss://temporary.example.com/",
      restoreRelay: provider.requestRelay,
      run: async () => {
        expect(getEmailDigestAuthRelays()).toEqual(["wss://temporary.example.com/"])
      },
    })
    expect(getEmailDigestAuthRelays()).toEqual([provider.requestRelay])

    await expect(
      withTemporaryEmailDigestAuthRelay({
        relay: "wss://temporary.example.com/",
        run: async () => {
          throw new Error("query failed")
        },
      }),
    ).rejects.toThrow("query failed")
    expect(getEmailDigestAuthRelays()).toEqual([])
  })

  it("waits only while provider authentication is pending", async () => {
    const auth = Object.assign(new EventEmitter(), {status: AuthStatus.PendingSignature})
    const waiting = waitForEmailDigestAuth(auth)

    auth.status = AuthStatus.PendingResponse
    auth.emit(AuthStateEvent.Status, auth.status)
    auth.status = AuthStatus.Ok
    auth.emit(AuthStateEvent.Status, auth.status)

    await expect(waiting).resolves.toBe(AuthStatus.Ok)
    expect(auth.listenerCount(AuthStateEvent.Status)).toBe(0)

    auth.status = AuthStatus.None
    await expect(waitForEmailDigestAuth(auth)).resolves.toBe(AuthStatus.None)
  })
})
