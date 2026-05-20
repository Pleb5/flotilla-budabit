// @vitest-environment jsdom

import {beforeEach, describe, expect, it} from "vitest"
import {get} from "svelte/store"
import {
  blossomDashboardState,
  blossomSettings,
  defaultBlossomDashboardState,
  defaultBlossomSettings,
  normalizeBlossomDashboardState,
  normalizeBlossomSettings,
  rememberBlossomCapability,
  rememberBlossomUpload,
  updateBlossomSettings,
  updateBlossomUploadRecord,
  type BlossomUploadRecord,
} from "./blossom"

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
  })
})
