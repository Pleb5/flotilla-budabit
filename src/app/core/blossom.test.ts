// @vitest-environment jsdom

import {beforeEach, describe, expect, it, vi} from "vitest"
import {get} from "svelte/store"
import {
  blossomDashboardState,
  blossomSettings,
  buildBlossomInitialUploadTargets,
  buildBlossomServerGroups,
  chooseBlossomInitialUploadPlan,
  classifyBlossomProbeError,
  classifyBlossomProbeResponse,
  clearBlossomCapabilityCache,
  clearBlossomUploadRecords,
  createBlossomMirrorJobs,
  defaultBlossomDashboardState,
  defaultBlossomSettings,
  flattenBlossomServerGroups,
  groupBlossomMirrorJobs,
  getBlossomUploadStageMessage,
  normalizeBlossomDashboardState,
  normalizeBlossomListResult,
  normalizeBlossomSettings,
  probeBlossomServerCapabilities,
  rememberBlossomCapability,
  rememberBlossomUpload,
  removeBlossomUploadRecord,
  selectMemberCommunityBlossomRefs,
  shouldPromptForBlossomMirrorUpload,
  updateBlossomSettings,
  updateBlossomUploadRecord,
  type BlossomUploadRecord,
  type BlossomServerCapability,
  type BlossomServerTarget,
} from "./blossom"
import {COMMUNITY_DEFINITION_KIND, PROFILE_LIST_KIND, parseCommunityDefinition} from "./community"
import type {TrustedEvent} from "@welshman/util"

const makeUpload = (id: string, updatedAt = 100): BlossomUploadRecord => ({
  id,
  createdAt: updatedAt,
  updatedAt,
  context: {type: "generic"},
  canonical: {
    url: `https://blossom.example/${"a".repeat(64)}.webp`,
    sha256: "a".repeat(64),
    size: 123,
    type: "image/webp",
  },
  optimizationMode: "auto",
  mirrorMode: "ask",
  mirrorJobs: [],
})

const makeEvent = (overrides: Partial<TrustedEvent>): TrustedEvent =>
  ({
    id: "event-id",
    pubkey: "a".repeat(64),
    created_at: 1,
    kind: 1,
    tags: [],
    content: "",
    sig: "sig",
    ...overrides,
  }) as TrustedEvent

const makeTarget = (url: string, priority: number): BlossomServerTarget => ({
  url,
  priority,
  source: priority === 1 ? "current-community" : "personal",
  group: priority === 1 ? "current-community" : "personal",
  label: priority === 1 ? "Community" : "Personal",
})

const makeCapability = (
  url: string,
  overrides: Partial<BlossomServerCapability> = {},
): BlossomServerCapability => ({
  url,
  checkedAt: 1,
  upload: "supported",
  media: "unsupported",
  mirror: "unsupported",
  ...overrides,
})

beforeEach(() => {
  localStorage.clear()
  blossomSettings.set(defaultBlossomSettings)
  blossomDashboardState.set(defaultBlossomDashboardState)
})

describe("blossom settings", () => {
  it("defaults to auto optimization and ask-before-mirroring", () => {
    expect(defaultBlossomSettings).toMatchObject({
      optimizationMode: "auto",
      mirrorMode: "ask",
      browserMirrorConsent: "ask",
      preferServerSideMirroring: true,
      publicEncryptionEnabled: false,
    })
    expect(defaultBlossomSettings.autoMirrorTargetGroups).toEqual([])
  })

  it("normalizes invalid stored settings back to safe defaults", () => {
    const normalized = normalizeBlossomSettings({
      optimizationMode: "invalid" as any,
      mirrorMode: "always-selected",
      browserMirrorConsent: "invalid" as any,
      preferServerSideMirroring: false,
      autoMirrorTargetGroups: ["personal", "bad", "personal"] as any,
      publicEncryptionEnabled: true as any,
    })

    expect(normalized).toEqual({
      ...defaultBlossomSettings,
      mirrorMode: "always-selected",
      preferServerSideMirroring: false,
      autoMirrorTargetGroups: ["personal"],
    })
  })

  it("updates the local settings store with normalized values", () => {
    updateBlossomSettings({
      optimizationMode: "client",
      browserMirrorConsent: "allow",
      autoMirrorTargetGroups: ["current-community", "manual"],
    })

    expect(get(blossomSettings)).toMatchObject({
      optimizationMode: "client",
      browserMirrorConsent: "allow",
      autoMirrorTargetGroups: ["current-community", "manual"],
    })
  })
})

describe("blossom upload status", () => {
  it("provides concise user-facing stage messages", () => {
    expect(getBlossomUploadStageMessage("checking-servers")).toBe("Checking Blossom servers...")
    expect(getBlossomUploadStageMessage("optimizing")).toBe("Optimizing media on Blossom...")
    expect(getBlossomUploadStageMessage("idle")).toBe("")
  })
})

describe("blossom dashboard state", () => {
  it("drops malformed upload and capability records", () => {
    const normalized = normalizeBlossomDashboardState({
      uploads: [makeUpload("ok"), {id: "bad", canonical: {url: "https://example.com"}} as any],
      capabilities: {
        good: {
          url: "https://blossom.example",
          checkedAt: 1,
          upload: "supported",
          media: "unsupported",
          mirror: "unknown",
        },
        bad: {url: ""},
      } as any,
    })

    expect(normalized.uploads.map(upload => upload.id)).toEqual(["ok"])
    expect(Object.keys(normalized.capabilities)).toEqual(["https://blossom.example"])
  })

  it("remembers uploads by id and keeps newest records first", () => {
    rememberBlossomUpload(makeUpload("older", 100))
    rememberBlossomUpload(makeUpload("newer", 200))
    rememberBlossomUpload({...makeUpload("older", 300), canonical: makeUpload("older").canonical})

    expect(get(blossomDashboardState).uploads.map(upload => upload.id)).toEqual(["older", "newer"])
    expect(get(blossomDashboardState).uploads[0].updatedAt).toBe(300)
  })

  it("updates existing upload records", () => {
    rememberBlossomUpload(makeUpload("upload"))
    updateBlossomUploadRecord("upload", record => ({
      ...record,
      mirrorJobs: [
        {
          id: "job",
          targetUrl: "https://mirror.example",
          targetGroup: "personal",
          method: "server-mirror",
          status: "queued",
          attempts: 0,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    }))

    expect(get(blossomDashboardState).uploads[0].mirrorJobs).toHaveLength(1)
  })

  it("removes and clears local upload records", () => {
    rememberBlossomUpload(makeUpload("one"))
    rememberBlossomUpload(makeUpload("two"))
    removeBlossomUploadRecord("one")

    expect(get(blossomDashboardState).uploads.map(upload => upload.id)).toEqual(["two"])

    clearBlossomUploadRecords()

    expect(get(blossomDashboardState).uploads).toEqual([])
  })

  it("remembers server capabilities keyed by url", () => {
    rememberBlossomCapability({
      url: "https://blossom.example",
      checkedAt: 10,
      upload: "supported",
      media: "supported",
      mirror: "unsupported",
    })

    expect(get(blossomDashboardState).capabilities["https://blossom.example"]).toMatchObject({
      media: "supported",
      mirror: "unsupported",
    })

    clearBlossomCapabilityCache()

    expect(get(blossomDashboardState).capabilities).toEqual({})
  })
})

describe("blossom server sources", () => {
  it("builds grouped targets in priority order and deduplicates servers", () => {
    const groups = buildBlossomServerGroups({
      currentCommunity: {
        servers: ["https://community.example/", "https://shared.example"],
        communityPubkey: "c".repeat(64),
        communityName: "Community",
      },
      personalServers: ["https://personal.example", "https://shared.example/"],
      memberCommunities: [
        {
          communityPubkey: "d".repeat(64),
          relayHints: [],
          blossomServers: ["https://member.example", "notaurl"],
          writableSections: ["General"],
        },
      ],
      lastResortServers: ["https://fallback.example", "https://personal.example"],
    })

    expect(groups.currentCommunity.map(target => target.url)).toEqual([
      "https://community.example",
      "https://shared.example",
    ])
    expect(groups.personal.map(target => target.url)).toEqual(["https://personal.example"])
    expect(groups.memberCommunities.map(target => target.url)).toEqual(["https://member.example"])
    expect(groups.lastResort.map(target => target.url)).toEqual(["https://fallback.example"])
    expect(flattenBlossomServerGroups(groups).map(target => target.group)).toEqual([
      "current-community",
      "current-community",
      "personal",
      "member-community",
      "last-resort",
    ])
  })

  it("builds initial upload targets with member-community fallback before last resort", () => {
    const targets = buildBlossomInitialUploadTargets({
      selectedContextServers: ["https://community.example", "https://shared.example"],
      selectedContextLabel: "Current community",
      selectedContextGroup: "current-community",
      personalServers: ["https://personal.example"],
      memberCommunities: [
        {
          communityPubkey: "d".repeat(64),
          communityName: "Member community",
          relayHints: [],
          blossomServers: ["https://member.example", "https://shared.example"],
          writableSections: ["General"],
        },
      ],
      lastResortServers: ["https://fallback.example"],
    })

    expect(targets.map(target => target.url)).toEqual([
      "https://community.example",
      "https://shared.example",
      "https://personal.example",
      "https://member.example",
      "https://fallback.example",
    ])
    expect(targets.map(target => target.group)).toEqual([
      "current-community",
      "current-community",
      "personal",
      "member-community",
      "last-resort",
    ])
  })

  it("selects communities where the user can publish to at least one section", () => {
    const userPubkey = "b".repeat(64)
    const memberListOwner = "c".repeat(64)
    const outsiderPubkey = "d".repeat(64)
    const memberDefinition = parseCommunityDefinition(
      makeEvent({
        id: "member-definition",
        pubkey: "e".repeat(64),
        created_at: 2,
        kind: COMMUNITY_DEFINITION_KIND,
        tags: [
          ["blossom", "https://member-blossom.example/"],
          ["content", "General"],
          ["k", "9", "room-message"],
          ["a", `${PROFILE_LIST_KIND}:${memberListOwner}:General`],
        ],
      }),
    )!
    const emptyDefinition = parseCommunityDefinition(
      makeEvent({
        id: "empty-definition",
        pubkey: "f".repeat(64),
        created_at: 2,
        kind: COMMUNITY_DEFINITION_KIND,
        tags: [
          ["blossom", "https://empty-blossom.example/"],
          ["content", "General"],
          ["k", "9", "room-message"],
          ["a", `${PROFILE_LIST_KIND}:${memberListOwner}:Other`],
        ],
      }),
    )!
    const profileList = makeEvent({
      id: "member-list",
      pubkey: memberListOwner,
      kind: PROFILE_LIST_KIND,
      tags: [
        ["d", "General"],
        ["p", userPubkey],
        ["p", outsiderPubkey],
      ],
    })

    expect(
      selectMemberCommunityBlossomRefs({
        author: userPubkey,
        definitions: [memberDefinition, emptyDefinition],
        profileListEvents: [profileList],
      }),
    ).toEqual([
      expect.objectContaining({
        communityPubkey: memberDefinition.pubkey,
        blossomServers: ["https://member-blossom.example"],
        writableSections: ["General"],
      }),
    ])
  })
})

describe("blossom capability probing", () => {
  it("classifies probe responses into capability statuses", () => {
    expect(classifyBlossomProbeResponse(new Response(null, {status: 200}), "upload")).toBe(
      "supported",
    )
    expect(classifyBlossomProbeResponse(new Response(null, {status: 413}), "upload")).toBe(
      "too-large",
    )
    expect(
      classifyBlossomProbeResponse(
        new Response(null, {status: 403, headers: {"X-Reason": "Media endpoint is disabled"}}),
        "media",
      ),
    ).toBe("disabled")
    expect(classifyBlossomProbeResponse(new Response(null, {status: 401}), "upload")).toBe(
      "auth-failed",
    )
    expect(
      classifyBlossomProbeResponse(
        new Response(null, {status: 405, headers: {Allow: "GET, PUT"}}),
        "mirror",
      ),
    ).toBe("supported")
    expect(classifyBlossomProbeError(new TypeError("Failed to fetch"))).toBe("cors-blocked")
  })

  it("probes upload, media, and mirror endpoints and persists results", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/upload")) {
        expect(init?.method).toBe("HEAD")
        expect((init?.headers as Record<string, string>)["X-Content-Length"]).toBe("12")
        return new Response(null, {status: 200})
      }
      if (url.endsWith("/media")) return new Response(null, {status: 413})
      if (url.endsWith("/mirror")) {
        expect(init?.method).toBe("OPTIONS")
        return new Response(null, {status: 405, headers: {Allow: "PUT"}})
      }

      return new Response(null, {status: 404})
    })

    const capability = await probeBlossomServerCapabilities({
      server: "https://blossom.example/path",
      file: {size: 12, type: "image/png", sha256: "b".repeat(64)},
      source: "personal",
      fetcher,
      now: () => 123,
      makeAuthHeader: async action => `Nostr ${action}`,
    })

    expect(capability).toMatchObject({
      url: "https://blossom.example",
      checkedAt: 123,
      source: "personal",
      upload: "supported",
      media: "too-large",
      mirror: "supported",
    })
    expect(get(blossomDashboardState).capabilities["https://blossom.example"]).toEqual(capability)
  })

  it("returns unavailable capabilities for invalid servers without throwing", async () => {
    await expect(probeBlossomServerCapabilities({server: "notaurl"})).resolves.toMatchObject({
      upload: "unavailable",
      media: "unavailable",
      mirror: "unavailable",
    })
  })
})

describe("blossom initial upload planner", () => {
  const community = makeTarget("https://community.example", 1)
  const personal = makeTarget("https://personal.example", 2)

  it("uses media on the canonical community server when supported", () => {
    const plan = chooseBlossomInitialUploadPlan({
      targets: [community, personal],
      file: {type: "image/png", size: 1024},
      capabilities: {
        [community.url]: makeCapability(community.url, {media: "supported"}),
        [personal.url]: makeCapability(personal.url, {media: "supported"}),
      },
    })

    expect(plan).toMatchObject({
      status: "ready",
      method: "media",
      canonical: community,
      mirrorOptimizedToCanonical: false,
      reason: "canonical-media",
    })
  })

  it("uses a non-canonical optimizer only when canonical can mirror the result", () => {
    const plan = chooseBlossomInitialUploadPlan({
      targets: [community, personal],
      file: {type: "image/png", size: 1024},
      capabilities: {
        [community.url]: makeCapability(community.url, {mirror: "supported"}),
        [personal.url]: makeCapability(personal.url, {media: "supported"}),
      },
    })

    expect(plan).toMatchObject({
      status: "ready",
      method: "media",
      canonical: community,
      optimizer: personal,
      mirrorOptimizedToCanonical: true,
      reason: "safe-external-optimizer",
    })
  })

  it("falls back to upload when no safe optimizer is available", () => {
    const plan = chooseBlossomInitialUploadPlan({
      targets: [community, personal],
      file: {type: "image/png", size: 1024},
      capabilities: {
        [community.url]: makeCapability(community.url),
        [personal.url]: makeCapability(personal.url, {media: "supported"}),
      },
    })

    expect(plan).toMatchObject({
      status: "ready",
      method: "upload",
      canonical: community,
      mirrorOptimizedToCanonical: false,
      useClientCompression: true,
      reason: "media-unavailable-upload-fallback",
    })
  })

  it("uses upload without client compression for non-media files", () => {
    const plan = chooseBlossomInitialUploadPlan({
      targets: [community],
      file: {type: "application/pdf", size: 1024},
      capabilities: {[community.url]: makeCapability(community.url, {media: "supported"})},
    })

    expect(plan).toMatchObject({
      status: "ready",
      method: "upload",
      canonical: community,
      useClientCompression: false,
      reason: "regular-upload",
    })
  })

  it("blocks encrypted uploads in public contexts", () => {
    expect(
      chooseBlossomInitialUploadPlan({
        targets: [community],
        file: {type: "image/png", size: 1024},
        encrypted: true,
      }),
    ).toEqual({status: "blocked", reason: "public-encryption-disabled"})
  })

  it("honors original mode by avoiding server and client optimization", () => {
    const plan = chooseBlossomInitialUploadPlan({
      targets: [community],
      file: {type: "image/png", size: 1024},
      settings: {...defaultBlossomSettings, optimizationMode: "original"},
      capabilities: {[community.url]: makeCapability(community.url, {media: "supported"})},
    })

    expect(plan).toMatchObject({
      status: "ready",
      method: "upload",
      canonical: community,
      useClientCompression: false,
      reason: "regular-upload",
    })
  })
})

describe("blossom mirror job planning", () => {
  const mirror = makeTarget("https://mirror.example", 2)

  it("queues server-side mirror jobs when mirror support is available", () => {
    expect(
      createBlossomMirrorJobs({
        targets: [mirror],
        capabilities: {[mirror.url]: makeCapability(mirror.url, {mirror: "supported"})},
        now: () => 100,
        makeId: () => "job",
      }),
    ).toEqual([
      expect.objectContaining({
        id: "job",
        targetUrl: mirror.url,
        method: "server-mirror",
        status: "queued",
      }),
    ])
  })

  it("uses browser upload only when exact bytes and consent are available", () => {
    expect(
      createBlossomMirrorJobs({
        targets: [mirror],
        capabilities: {[mirror.url]: makeCapability(mirror.url, {mirror: "unsupported"})},
        settings: {...defaultBlossomSettings, browserMirrorConsent: "allow"},
        exactBytesAvailable: true,
        makeId: () => "job",
      }),
    ).toEqual([
      expect.objectContaining({
        method: "browser-upload",
        status: "queued",
      }),
    ])
  })

  it("records skipped jobs when no safe mirror method can run", () => {
    expect(
      createBlossomMirrorJobs({
        targets: [mirror],
        capabilities: {
          [mirror.url]: makeCapability(mirror.url, {
            upload: "unsupported",
            mirror: "unsupported",
          }),
        },
        settings: {...defaultBlossomSettings, browserMirrorConsent: "deny"},
        exactBytesAvailable: true,
        makeId: () => "job",
      }),
    ).toEqual([
      expect.objectContaining({
        method: "browser-upload",
        status: "skipped",
        lastError: expect.stringContaining("browser-assisted mirroring requires consent"),
      }),
    ])
  })

  it("keeps manual jobs available when prompts are disabled", () => {
    expect(
      createBlossomMirrorJobs({
        targets: [mirror],
        capabilities: {[mirror.url]: makeCapability(mirror.url, {mirror: "supported"})},
        settings: {...defaultBlossomSettings, mirrorMode: "never"},
        makeId: () => "job",
      }),
    ).toEqual([
      expect.objectContaining({
        method: "server-mirror",
        status: "paused",
      }),
    ])
  })

  it("honors selected auto-mirror target groups", () => {
    expect(
      createBlossomMirrorJobs({
        targets: [mirror],
        capabilities: {[mirror.url]: makeCapability(mirror.url, {mirror: "supported"})},
        settings: {
          ...defaultBlossomSettings,
          mirrorMode: "always-selected",
          autoMirrorTargetGroups: ["current-community"],
        },
        makeId: () => "job",
      }),
    ).toEqual([
      expect.objectContaining({
        method: "server-mirror",
        status: "skipped",
        lastError: "Target group is not selected for automatic mirroring.",
      }),
    ])
  })

  it("server-side-only mode tries server mirrors even when preference toggle is off", () => {
    expect(
      createBlossomMirrorJobs({
        targets: [mirror],
        capabilities: {[mirror.url]: makeCapability(mirror.url, {mirror: "supported"})},
        settings: {
          ...defaultBlossomSettings,
          mirrorMode: "server-side-only",
          preferServerSideMirroring: false,
        },
        makeId: () => "job",
      }),
    ).toEqual([
      expect.objectContaining({
        method: "server-mirror",
        status: "queued",
      }),
    ])
  })

  it("can defer queued jobs until the user chooses mirroring", () => {
    expect(
      createBlossomMirrorJobs({
        targets: [mirror],
        capabilities: {[mirror.url]: makeCapability(mirror.url, {mirror: "supported"})},
        defer: true,
        makeId: () => "job",
      }),
    ).toEqual([
      expect.objectContaining({
        method: "server-mirror",
        status: "paused",
      }),
    ])
  })

  it("groups mirror jobs for the post-upload modal", () => {
    const jobs = createBlossomMirrorJobs({
      targets: [
        {...mirror, group: "current-community", label: "Community"},
        {...makeTarget("https://personal.example", 3), group: "personal", label: "Personal"},
      ],
      now: () => 100,
    })

    expect(groupBlossomMirrorJobs(jobs)).toEqual([
      expect.objectContaining({group: "current-community", label: "Current community servers"}),
      expect.objectContaining({group: "personal", label: "Your personal servers"}),
    ])
  })

  it("prompts only for ask-mode uploads with mirror jobs", () => {
    expect(shouldPromptForBlossomMirrorUpload({record: makeUpload("no-jobs")})).toBe(false)
    expect(
      shouldPromptForBlossomMirrorUpload({
        record: {
          ...makeUpload("with-jobs"),
          mirrorJobs: createBlossomMirrorJobs({targets: [mirror]}),
        },
      }),
    ).toBe(true)
    expect(
      shouldPromptForBlossomMirrorUpload({
        record: {
          ...makeUpload("with-jobs"),
          mirrorJobs: createBlossomMirrorJobs({targets: [mirror]}),
        },
        settings: {...defaultBlossomSettings, mirrorMode: "never"},
      }),
    ).toBe(false)
  })
})

describe("blossom server list normalization", () => {
  it("normalizes array and wrapped list responses", () => {
    expect(
      normalizeBlossomListResult(
        {
          blobs: [
            {
              sha256: "a".repeat(64),
              size: "123",
              type: "image/webp",
              uploaded: 10,
            },
            {hash: "bad"},
          ],
        },
        "https://blossom.example/path",
      ),
    ).toEqual([
      {
        url: `https://blossom.example/${"a".repeat(64)}`,
        sha256: "a".repeat(64),
        size: 123,
        type: "image/webp",
        uploadedAt: 10,
      },
    ])

    expect(
      normalizeBlossomListResult([{hash: "b".repeat(64), url: "https://cdn.example/blob"}], ""),
    ).toEqual([expect.objectContaining({url: "https://cdn.example/blob", sha256: "b".repeat(64)})])
  })
})
