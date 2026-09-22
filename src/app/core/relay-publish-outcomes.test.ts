import {describe, expect, it} from "vitest"
import {PublishStatus} from "@welshman/net"
import {
  classifyRelayPublishOutcome,
  formatRelayPublishFailure,
  RelayPublishError,
  summarizeRelayPublishResults,
} from "./relay-publish-outcomes"

const relay = "wss://relay.example/"
const classify = (detail: string) =>
  classifyRelayPublishOutcome(relay, {status: PublishStatus.Failure, detail})

describe("relay publish outcomes", () => {
  it.each([
    ["error: relay policy is loading, retry shortly", "warming_up", "later"],
    [
      'blocked: not a current writer for section "General" in cccccccc',
      "no_grant",
      "after-refresh",
    ],
    ["blocked: no current grant for kind 31922 in cccccccc", "no_grant", "after-refresh"],
    ["blocked: author is moderated in this community", "person_banned", "after-change"],
    ["blocked: kind 32222 is not allowed", "kind_not_supported", "later"],
    [
      "blocked: kind 11/threads is not enabled in community cccccccc",
      "kind_not_enabled",
      "after-change",
    ],
    [
      "blocked: person reports require community-wide moderator authority",
      "blocked",
      "after-change",
    ],
    [
      "blocked: Deletion of kinds 32222 and 30000 is not allowed",
      "protected_kind_deletion",
      "none",
    ],
    ["invalid: definition requires 1 to 20 r tags", "invalid", "none"],
    ["rate-limited: pubkey write limit reached", "rate_limited", "later"],
    ["deleted: event was deleted", "deleted", "none"],
    ["blocked: this event was deleted by its author", "deleted", "none"],
    ["replaced: have newer event", "replaced", "none"],
    ["auth-required: log in", "auth_required", "after-change"],
    ["payment-required: pay", "payment_required", "after-change"],
    ["error: internal error", "relay_error", "later"],
    ["signing failed", "unknown", "after-change"],
  ])("classifies %s", (detail, reason, retry) => {
    expect(classify(detail)).toMatchObject({relay, detail, reason, retry})
  })
  it("uses status rather than reply text to establish acceptance", () => {
    expect(
      classifyRelayPublishOutcome(relay, {
        status: PublishStatus.Success,
        detail: "error: this is still OK true",
      }).reason,
    ).toBe("accepted")
    expect(classify("duplicate: already have this").reason).not.toBe("accepted")
  })
  it("excludes skipped relays from attempted counts while retaining required-relay failure", () => {
    const results = {
      [relay]: {relay, status: PublishStatus.Skipped, detail: "blocked: kind 32222 is not allowed"},
      good: {relay: "good", status: PublishStatus.Success, detail: "stored"},
    }
    expect(summarizeRelayPublishResults(results)).toBe(
      "Accepted by 1/1 attempted relays; 1 skipped (kind unsupported).",
    )
    expect(classifyRelayPublishOutcome(relay, results[relay]).reason).toBe("skipped")
    expect(formatRelayPublishFailure(results, {requiredRelay: relay})).toContain("Required relay")
    expect(summarizeRelayPublishResults({[relay]: results[relay]})).toBe(
      "No relay accepted the event; 1 skipped (kind unsupported).",
    )
  })
  it("distinguishes absent results, timeout and cancellation from policy rejection", () => {
    expect(classifyRelayPublishOutcome(relay).reason).toBe("missing_result")
    expect(classifyRelayPublishOutcome(relay, {status: PublishStatus.Timeout}).reason).toBe(
      "timeout",
    )
    expect(classifyRelayPublishOutcome(relay, {status: PublishStatus.Aborted}).reason).toBe(
      "cancelled",
    )
  })
  it("retains every relay reason and does not let optional success hide a required failure", () => {
    const good = "wss://accepted.example/"
    const results = {
      [relay]: {
        relay,
        status: PublishStatus.Failure,
        detail: "error: relay policy is loading, retry shortly",
      },
      [good]: {relay: good, status: PublishStatus.Success, detail: "stored"},
    }
    const error = new RelayPublishError("event-id", results, [relay, good], relay)
    expect(error.message).toContain(`Required relay ${relay}`)
    expect(error.message).toContain(results[relay].detail)
    expect(error.message).toContain(`Accepted by: ${good}`)
    results[relay].detail = "mutated"
    expect(error.results[relay].detail).not.toBe("mutated")
    expect(error.outcomes[0].reason).toBe("warming_up")
  })
  it("keeps signer/other upstream errors when relay outcomes have not settled", () => {
    expect(
      formatRelayPublishFailure(
        {[relay]: {relay, status: PublishStatus.Sending, detail: ""}},
        {fallback: "signer refused"},
      ),
    ).toBe("signer refused")
  })
})
