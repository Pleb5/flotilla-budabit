import {afterEach, describe, expect, it, vi} from "vitest"
import {finalizeEvent, getPublicKey} from "nostr-tools"
import {repository} from "@welshman/app"
import {netContext, PublishStatus, requestOne} from "@welshman/net"
import {
  buildCommunityDefinition,
  makeCommunityPointer,
  parseCommunityDefinition,
  updateCommunityDefinition,
} from "./community-protocol"
import {
  getPrivateCommunityScope,
  resolvePrivateCommunityScope,
  makePrivateCommunityInvite,
} from "./private-community-scope"
import {publishRequiredCommunityEvent} from "./community-publish"
import {
  armPerformanceDiagnosticsCapture,
  disarmPerformanceDiagnosticsCapture,
  beginPerformanceDiagnosticsRun,
  getPerformanceDiagnosticsSnapshot,
  serializePerformanceDiagnostics,
  clearPerformanceDiagnostics,
  recordPerformanceDiagnostics,
} from "./performance-diagnostics"
import {sanitizeDebugDiagnosticValue} from "./debug-diagnostics"
import {uploadDiagnosticsArtifact} from "./diagnostics-artifact-publish"

vi.mock("@nostr-git/ui", async () => {
  const {writable} = await import("svelte/store")
  return {graspServersStore: writable([])}
})
const key = new Uint8Array(32).fill(29)
const owner = getPublicKey(key)
const relay = "wss://ordinary-relay.test/"
const template = buildCommunityDefinition({
  communityId: "b".repeat(64),
  name: "Members",
  readAccess: "members",
  relays: [relay],
  sections: [{name: "General", kinds: [{kind: 1}], profileLists: []}],
})
const event = finalizeEvent({...template, created_at: 100}, key)
afterEach(() => {
  repository.removeEvent(event.id)
  clearPerformanceDiagnostics()
  disarmPerformanceDiagnosticsCapture()
})
describe("relay-only read control", () => {
  it("preserves signed read intent as metadata, without a client privacy policy", () => {
    const definition = parseCommunityDefinition(event)!
    expect(definition.readAccess).toBe("members")
    const changed = updateCommunityDefinition(
      definition,
      {},
      {
        replacement: {
          ...template,
          tags: template.tags.map(tag =>
            tag[0] === "read-access" ? ["read-access", "future"] : tag,
          ),
        },
      },
    )
    expect(changed.tags.filter(tag => tag[0] === "read-access")).toEqual([
      ["read-access", "future"],
    ])
    expect(updateCommunityDefinition(definition, {name: "Renamed"}).tags).toContainEqual([
      "read-access",
      "members",
    ])
    const publicTemplate = {
      ...template,
      tags: template.tags.filter(tag => tag[0] !== "read-access"),
    }
    expect(
      updateCommunityDefinition(definition, {}, {replacement: publicTemplate}).tags,
    ).toContainEqual(["read-access", "members"])
    for (const tags of [
      [["read-access", "future"]],
      [
        ["read-access", "members"],
        ["read-access", "members"],
      ],
      [["read-access", "members", "extra"]],
    ]) {
      const parsed = parseCommunityDefinition({...event, tags: [...tags, ...publicTemplate.tags]})!
      expect(parsed).toBeTruthy()
      expect(parsed.readAccess).toBeUndefined()
      const edited = updateCommunityDefinition(parsed, {name: "Renamed"})
      expect(edited.tags.filter(tag => tag[0] === "read-access")).toEqual(tags)
    }
  })
  it("accepts a signed member-only definition without quarantining its named public endpoint", async () => {
    expect(repository.publish(event)).toBe(true)
    const pointer = makeCommunityPointer({ownerPubkey: owner, communityId: "b".repeat(64)})!
    expect(getPrivateCommunityScope(pointer)).toBeUndefined()
    const createAdapter = vi.fn(() => {
      throw Error("ordinary adapter reached")
    })
    expect(() =>
      requestOne({relay, filters: [{kinds: [0]}], context: {getAdapter: createAdapter}}),
    ).toThrow("ordinary adapter reached")
    expect(createAdapter).toHaveBeenCalled()
    expect(netContext).not.toHaveProperty("beforeRequest")
  })
  it("allows normal publication of read-access marked definitions", async () => {
    const publishEvent = vi.fn(async () => ({
      [relay]: {relay, status: PublishStatus.Success, detail: ""},
    }))
    await publishRequiredCommunityEvent({event, relays: [relay], label: "Definition", publishEvent})
    expect(publishEvent).toHaveBeenCalled()
  })
  it("captures, arms and uploads member-community diagnostics while still sanitizing credentials", async () => {
    const pointer = makeCommunityPointer({
      ownerPubkey: owner,
      communityId: "c".repeat(64),
      relayHints: [relay],
    })!
    const route = makePrivateCommunityInvite(pointer, [relay])
    resolvePrivateCommunityScope(new URL(route, "https://app.test"))
    expect(armPerformanceDiagnosticsCapture({route, preset: "custom"})?.route).toBe(route)
    const id = beginPerformanceDiagnosticsRun({route, context: {community: pointer.address}})
    recordPerformanceDiagnostics(id, "member-query", {
      coordinate: pointer.address,
      token: "fixture-secret",
    })
    const text = serializePerformanceDiagnostics(getPerformanceDiagnosticsSnapshot())
    expect(text).toContain(pointer.address)
    expect(text).not.toContain("fixture-secret")
    expect(
      sanitizeDebugDiagnosticValue({coordinate: pointer.address, password: "fixture-secret"}),
    ).toEqual({coordinate: pointer.address, password: "[redacted]"})
    const sha256 = "e".repeat(64)
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify({url: `https://upload.test/${sha256}`, sha256})),
    )
    await uploadDiagnosticsArtifact(
      {
        filename: "member-run.json",
        encoding: "identity",
        contentType: "application/json",
        bytes: new TextEncoder().encode(text),
        sha256,
        uncompressedBytes: text.length,
      },
      "https://upload.test",
      fetcher,
    )
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
