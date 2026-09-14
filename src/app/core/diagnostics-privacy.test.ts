import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {gzipSync} from "node:zlib"
import {nip19} from "nostr-tools"
import {pubkey} from "@welshman/app"
import {makeCommunityPointer} from "./community-protocol"
import {
  registerPrivateCommunity,
  markPrivateEvent,
  assertCommunityTransportPublication,
} from "./private-community-policy"
import {
  observeDiagnosticsRoute,
  assertDiagnosticsArtifact,
  PRIVATE_DIAGNOSTICS_REDACTION,
} from "./diagnostics-privacy"
import {
  beginPerformanceDiagnosticsRun,
  clearPerformanceDiagnostics,
  recordPerformanceDiagnostics,
  getPerformanceDiagnosticsSnapshot,
  serializePerformanceDiagnostics,
  sanitizePerformanceDiagnosticsUrl,
} from "./performance-diagnostics"
import {
  startDebugDiagnosticsCapture,
  clearDebugDiagnostics,
  setDebugDiagnosticCategoryEnabled,
  recordAppUpdateDebugDiagnostic,
  getDebugDiagnosticsSnapshot,
  serializeDebugDiagnostics,
  DEBUG_DIAGNOSTICS_CAPTURE_STORAGE_KEY,
} from "./debug-diagnostics"
import {
  publishVerifiedDiagnosticsArtifact,
  uploadDiagnosticsArtifact,
} from "./diagnostics-artifact-publish"
import {buildPerformanceDiagnosticsManifest} from "./performance-diagnostics-publish"

const pointer = makeCommunityPointer({ownerPubkey: "a".repeat(64), communityId: "e".repeat(64)})!
const relay = "wss://diagnostics-private.test/room"
const naddr = nip19.naddrEncode({
  kind: 32222,
  pubkey: pointer.ownerPubkey,
  identifier: pointer.communityId,
  relays: [relay],
})
const eventId = "f".repeat(64)
const route = `/c/${naddr}`
const artifact = (text: string, gzip = false) => ({
  filename: "diagnostics.json",
  contentType: "application/json" as const,
  encoding: gzip ? ("gzip" as const) : ("identity" as const),
  bytes: new Uint8Array(gzip ? gzipSync(text) : new TextEncoder().encode(text)),
  sha256: "b".repeat(64),
  uncompressedBytes: text.length,
})
const storage = new Map<string, string>()
beforeEach(() => {
  observeDiagnosticsRoute("/git")
  registerPrivateCommunity(pointer, [relay])
  markPrivateEvent({id: eventId} as any, [relay])
  storage.clear()
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => storage.get(key),
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  })
})
afterEach(() => {
  observeDiagnosticsRoute("/git")
  clearPerformanceDiagnostics()
  clearDebugDiagnostics()
  pubkey.set(undefined)
  vi.unstubAllGlobals()
})
describe("private diagnostics boundary", () => {
  it.each([
    route,
    `${route}?read-access=members`,
    `/c/${encodeURIComponent(pointer.address)}`,
    `context ${eventId}`,
    relay,
    "https://diagnostics-private.test/room",
  ])("redacts %s before retained capture and refuses its export", async value => {
    expect(sanitizePerformanceDiagnosticsUrl(`https://app.test${value}`)).toBe(
      PRIVATE_DIAGNOSTICS_REDACTION,
    )
    const id = beginPerformanceDiagnosticsRun({route: value, context: {[value]: value}})
    recordPerformanceDiagnostics(id, value, {value})
    const text = serializePerformanceDiagnostics(getPerformanceDiagnosticsSnapshot())
    for (const privateValue of [naddr, pointer.communityId, eventId, "diagnostics-private.test"])
      expect(text).not.toContain(privateValue)
    expect(text).toContain(PRIVATE_DIAGNOSTICS_REDACTION)
    await expect(assertDiagnosticsArtifact(artifact(text, true))).rejects.toThrow(/Private/)
    expect(() =>
      assertCommunityTransportPublication(
        {kind: 30078, content: JSON.stringify({route: value}), tags: []},
        ["wss://public.test"],
      ),
    ).toThrow(/Private/)
  })

  it("marks mixed captures across private navigation, account change and leaving before export", async () => {
    beginPerformanceDiagnosticsRun({route: "/git"})
    setDebugDiagnosticCategoryEnabled("app-update", true)
    startDebugDiagnosticsCapture("public-start")
    observeDiagnosticsRoute(route)
    recordAppUpdateDebugDiagnostic("update", {
      pathname: route,
      coordinate: encodeURIComponent(pointer.address),
      id: eventId,
      endpoint: relay,
    })
    observeDiagnosticsRoute("/git")
    pubkey.set("c".repeat(64))
    for (const text of [
      serializePerformanceDiagnostics(getPerformanceDiagnosticsSnapshot()),
      serializeDebugDiagnostics(getDebugDiagnosticsSnapshot()),
      storage.get(DEBUG_DIAGNOSTICS_CAPTURE_STORAGE_KEY)!,
    ]) {
      expect(text).toContain(PRIVATE_DIAGNOSTICS_REDACTION)
      for (const privateValue of [naddr, pointer.communityId, eventId, "diagnostics-private.test"])
        expect(text).not.toContain(privateValue)
      await expect(assertDiagnosticsArtifact(artifact(text))).rejects.toThrow(/Private/)
    }
  })

  it("blocks artifact bytes or manifest-only private context before all external dependencies", async () => {
    for (const [text, manifest] of [
      [JSON.stringify({route}), "/git"],
      ["{}", route],
    ]) {
      const sign = vi.fn(),
        upload = vi.fn(),
        verifyUpload = vi.fn(),
        publish = vi.fn(),
        verify = vi.fn()
      await expect(
        publishVerifiedDiagnosticsArtifact({
          artifact: artifact(text, true),
          blossomServer: "https://public.test",
          relays: ["wss://public.test"],
          runDTag: "run",
          latestDTag: "latest",
          buildManifest: () => ({
            kind: 30078,
            created_at: 1,
            tags: [["route", manifest]],
            content: "",
          }),
          dependencies: {
            getIdentity: () => ({pubkey: "c".repeat(64), signer: {sign}}),
            upload,
            verifyUpload,
            publish,
            verify,
          },
        }),
      ).rejects.toThrow(/Private/)
      for (const call of [sign, upload, verifyUpload, publish, verify])
        expect(call).not.toHaveBeenCalled()
    }
    const fetcher = vi.fn()
    await expect(
      uploadDiagnosticsArtifact(
        artifact(JSON.stringify({id: eventId})),
        "https://public.test",
        fetcher,
      ),
    ).rejects.toThrow(/Private/)
    expect(fetcher).not.toHaveBeenCalled()
    expect(() =>
      buildPerformanceDiagnosticsManifest({
        artifact: {...artifact("{}"), schemaVersion: 2},
        artifactUrl: "https://public.test/blob",
        runId: "run",
        routes: [route],
        dTag: "run",
      }),
    ).toThrow(/Private/)
  })

  it("rechecks privacy after upload signing and preserves unrelated public serialization", async () => {
    beginPerformanceDiagnosticsRun({route: "/git", context: {count: 7}})
    const text = serializePerformanceDiagnostics(getPerformanceDiagnosticsSnapshot())
    expect(text).toContain('"route":"/git"')
    await expect(assertDiagnosticsArtifact(artifact(text, true))).resolves.toBe(text)
    const upload = vi.fn(),
      identity = {
        pubkey: "c".repeat(64),
        signer: {
          sign: vi.fn(async template => {
            observeDiagnosticsRoute(route)
            return {...template, pubkey: "c".repeat(64)}
          }),
        },
      }
    await expect(
      publishVerifiedDiagnosticsArtifact({
        artifact: artifact(text),
        blossomServer: "https://public.test",
        relays: ["wss://public.test"],
        runDTag: "run",
        latestDTag: "latest",
        buildManifest: () => ({kind: 30078, created_at: 1, tags: [], content: ""}),
        dependencies: {
          getIdentity: () => identity,
          upload,
          verifyUpload: vi.fn(),
          publish: vi.fn(),
          verify: vi.fn(),
        },
      }),
    ).rejects.toThrow(/Private/)
    expect(upload).not.toHaveBeenCalled()
  })
})
