import {describe, expect, it, vi} from "vitest"
import {finalizeEvent, generateSecretKey} from "nostr-tools"
import {parseCli, renderRecommendationTable} from "../scripts/discover-relay-defaults.mjs"
import {
  auditRelayWrites,
  parseWriteAuditEvents,
  parseWriteAuditLog,
} from "../scripts/relay-write-audit.mjs"

const key = generateSecretKey()
const samples = [32222, 30222].map(kind =>
  finalizeEvent({kind, created_at: 10, tags: [["d", `audit-${kind}`]], content: ""}, key),
)
const relay = "wss://relay.example/"
const other = "wss://other.example/"

describe("explicit relay-default write audit", () => {
  it("stays read-only by default and requires both a sample file and an account", () => {
    expect(parseCli([]).writeAuditEvents).toBeUndefined()
    expect(() => parseCli(["--write-account", "five"])).toThrow("supplied together")
    expect(() => parseCli(["--write-audit-events", "events.jsonl"])).toThrow("supplied together")
    expect(() => parseCli(["--write-relay", relay])).toThrow("requires")
    expect(
      parseCli([
        "--write-audit-events",
        "events.jsonl",
        "--write-account",
        "five",
        "--write-relay",
        relay,
      ]),
    ).toMatchObject({writeAccount: "five", writeRelays: [relay]})
  })

  it("requires both correctly signed kinds and preserves their original identities", () => {
    const text = samples.map(sample => JSON.stringify(sample)).join("\n")
    expect(parseWriteAuditEvents(text).map(event => event.id)).toEqual(
      samples.map(event => event.id),
    )
    expect(() => parseWriteAuditEvents(JSON.stringify(samples[0]))).toThrow("exactly one")
    expect(() => parseWriteAuditEvents(text.replace('"created_at":10', '"created_at":0'))).toThrow(
      "valid signatures",
    )
  })

  it("associates ACKs by emitted event, including a relay connected for only the second sample", () => {
    const output = [
      "connecting to other.example... status 503",
      JSON.stringify(samples[0]),
      "publishing to relay.example... failed: msg: blocked: kind 32222 is not allowed",
      JSON.stringify(samples[1]),
      "publishing to relay.example... success.",
      "publishing to other.example... authenticating as npub…... publishing to other.example... success.",
    ].join("\n")
    const rows = parseWriteAuditLog(output, samples, [relay, other])
    expect(rows.map(row => [row.kind, row.relay, row.ack])).toEqual([
      [32222, relay, "rejected"],
      [32222, other, "unknown"],
      [30222, relay, "accepted"],
      [30222, other, "accepted"],
    ])
    expect(rows[0].detail).toBe("blocked: kind 32222 is not allowed")
    expect(rows[1].detail).toBe("Connection failed: status 503")
    expect(() =>
      parseWriteAuditLog(JSON.stringify({...samples[0], content: "changed"}), samples, [relay]),
    ).toThrow("changed")
  })

  it("distinguishes transport failures and explicit rejection from acceptance", () => {
    const rows = parseWriteAuditLog(
      [
        JSON.stringify(samples[0]),
        "publishing to relay.example... failed: context deadline exceeded",
        JSON.stringify(samples[1]),
        "publishing to relay.example... failed: msg: duplicate: false is not success",
      ].join("\n"),
      samples,
      [relay],
    )
    expect(rows[0].ack).toBe("unknown")
    expect(rows[1].ack).toBe("rejected")
  })

  it("requires an ACK plus exact current readback, and never interprets CLOSED as empty success", async () => {
    const replay = vi.fn(async ({events, relays}) => ({
      code: 0,
      timedOut: false,
      rows: events.flatMap(event =>
        relays.map(relay => ({
          relay,
          kind: event.kind,
          eventId: event.id,
          author: event.pubkey,
          ack: "accepted",
          detail: "OK true",
        })),
      ),
    }))
    const queryRelay = vi.fn(async (_relay, filters) => ({
      status: filters[0].kinds[0] === 32222 ? "eose" : "closed",
      events: samples.filter(event => event.kind === filters[0].kinds[0]),
      closedReason: "",
    }))
    const audit = await auditRelayWrites({
      account: "five",
      events: samples,
      destinations: [{relay, sources: ["configured:indexer"]}],
      timeoutMs: 100,
      replay,
      queryRelay,
    })
    expect(replay).toHaveBeenCalledOnce()
    expect(replay).toHaveBeenCalledWith({account: "five", events: samples, relays: [relay]})
    expect(queryRelay).toHaveBeenCalledWith(
      relay,
      [{kinds: [32222], authors: [samples[0].pubkey], "#d": ["audit-32222"], limit: 5}],
      {timeoutMs: 100},
    )
    expect(audit.rows.map(row => row.verified)).toEqual([true, false])
    expect(audit.verifiedRelaysByKind).toEqual({32222: [relay], 30222: []})
    expect(audit.rows[0].sources).toEqual(["configured:indexer"])
    const markdown = renderRecommendationTable({
      generatedAt: audit.checkedAt,
      inputs: {seeds: [], roles: []},
      roles: {},
      suggestedEnv: {},
      warnings: [],
      writeAudit: audit,
    })
    expect(markdown).toContain("Community write audit")
    expect(markdown).toContain("configured:indexer")
    expect(markdown).toContain("Kind 30222: none verified")
  })

  it("does not claim successful writes from existing copies or a superseded replacement", async () => {
    const newer = finalizeEvent({...samples[0], created_at: 11}, key)
    const audit = await auditRelayWrites({
      account: "five",
      events: samples,
      destinations: [{relay, sources: ["configured:git"]}],
      timeoutMs: 100,
      replay: async () => ({
        code: 0,
        timedOut: false,
        rows: samples.map(event => ({
          relay,
          eventId: event.id,
          kind: event.kind,
          author: event.pubkey,
          ack: event.kind === 32222 ? "accepted" : "unknown",
          detail: "test result",
        })),
      }),
      queryRelay: async (_relay, filters) => ({
        status: "eose",
        closedReason: "",
        events: filters[0].kinds[0] === 32222 ? [samples[0], newer] : [samples[1]],
      }),
    })
    expect(audit.rows.every(row => !row.verified)).toBe(true)
    expect(audit.rows[0].readback).toMatchObject({exactMatch: true, currentEventId: newer.id})
    expect(audit.rows[1].readback.exactMatch).toBe(true)
  })
})
