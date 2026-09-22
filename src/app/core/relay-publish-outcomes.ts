import {PublishStatus, type PublishResultsByRelay} from "@welshman/net"
import {getUnsupportedRelayKind} from "./relay-write-capabilities"

type RelayPublishResults = Record<string, {relay?: string; status: string; detail?: string}>

export type RelayPublishReason =
  | "accepted"
  | "pending"
  | "timeout"
  | "cancelled"
  | "missing_result"
  | "warming_up"
  | "no_grant"
  | "person_banned"
  | "kind_not_enabled"
  | "kind_not_supported"
  | "skipped"
  | "blocked"
  | "invalid"
  | "rate_limited"
  | "auth_required"
  | "payment_required"
  | "deleted"
  | "replaced"
  | "protected_kind_deletion"
  | "relay_error"
  | "unknown"

export type RelayPublishOutcome = {
  relay: string
  status: string
  detail: string
  reason: RelayPublishReason
  title: string
  guidance: string
  retry: "later" | "after-refresh" | "after-change" | "none"
}

/** Interpret NIP-01 OK replies without treating every blocked/error reply as transient.
 * The original detail is retained for display, never rendered as HTML or used as authority.
 */
export const classifyRelayPublishOutcome = (
  relay: string,
  result?: {status: string; detail?: string},
): RelayPublishOutcome => {
  const status = result?.status || "missing"
  const detail = typeof result?.detail === "string" ? result.detail : ""
  const outcome = (
    reason: RelayPublishReason,
    title: string,
    guidance = "",
    retry: RelayPublishOutcome["retry"] = "none",
  ): RelayPublishOutcome => ({relay, status, detail, reason, title, guidance, retry})

  // The OK boolean/status, not the message prefix, determines acceptance.
  if (status === PublishStatus.Success) return outcome("accepted", "Accepted")
  if (status === PublishStatus.Skipped) {
    return outcome(
      "skipped",
      "Skipped — kind unsupported",
      "A previous explicit kind rejection is cached locally. Nothing was sent to this relay. The restriction expires after 24 hours; the next publication or retry can then try again.",
      "later",
    )
  }
  if (status === PublishStatus.Pending || status === PublishStatus.Sending) {
    return outcome("pending", "Awaiting relay reply")
  }
  if (status === PublishStatus.Timeout) {
    return outcome(
      "timeout",
      "Relay timed out",
      "No acknowledgement arrived. The relay may already have stored this event; retry sends the same event.",
      "later",
    )
  }
  if (status === PublishStatus.Aborted) {
    return outcome(
      "cancelled",
      "Cancelled",
      "Waiting was cancelled; this does not retract a previously accepted event.",
      "later",
    )
  }
  if (!result)
    return outcome(
      "missing_result",
      "No relay result",
      "Delivery is unknown. Retry the same event when the relay is reachable.",
      "later",
    )

  const text = detail.trim()
  if (getUnsupportedRelayKind(text) !== undefined) {
    return outcome(
      "kind_not_supported",
      "Relay does not support this event kind",
      "This relay explicitly rejected the event kind. Subsequent attempts can skip it until the cached restriction expires.",
      "later",
    )
  }
  if (/^error:\s*relay policy is loading\b/i.test(text)) {
    return outcome(
      "warming_up",
      "Relay policy is loading",
      "The relay is rebuilding community permissions. Wait briefly, then retry.",
      "later",
    )
  }
  if (/^blocked:\s*(not a current writer for section|no current grant for kind)\b/i.test(text)) {
    return outcome(
      "no_grant",
      "Grant not available on this relay",
      "Refresh community permissions. If you were just granted access, wait for the permission list to reach this relay, then retry. Otherwise ask a moderator for access.",
      "after-refresh",
    )
  }
  if (/^blocked:\s*author is moderated in this community\b/i.test(text)) {
    return outcome(
      "person_banned",
      "Community moderation blocks this author",
      "A moderator must lift the restriction before retrying can succeed.",
      "after-change",
    )
  }
  if (/^blocked:\s*kind .* is not enabled in (this )?community/i.test(text)) {
    return outcome(
      "kind_not_enabled",
      "Content type is not enabled",
      "The community definition must enable this content type before retrying.",
      "after-change",
    )
  }
  if (/^(deleted:|blocked:\s*this event was deleted by its author)/i.test(text)) {
    return outcome(
      "deleted",
      "Event was deleted",
      "Resending this deleted event will not restore it. Create a new publication if appropriate.",
    )
  }
  if (/^blocked:\s*Deletion of kinds 32222 and 30000 is not allowed/i.test(text)) {
    return outcome(
      "protected_kind_deletion",
      "Community definitions and lists cannot be deleted",
      "This relay does not allow NIP-09 deletion of kinds 32222 or 30000. Update the definition or list instead. Retrying this deletion will not help.",
    )
  }
  if (/^replaced:/i.test(text)) {
    return outcome(
      "replaced",
      "Relay has a newer version",
      "Refresh the current version before making another edit; do not overwrite newer changes by blindly retrying.",
    )
  }
  if (/^invalid:/i.test(text)) {
    return outcome(
      "invalid",
      "Relay rejected the event format",
      "This event needs correcting. Retrying the unchanged signed event will not fix its format.",
    )
  }
  if (/^rate-limited:/i.test(text)) {
    return outcome(
      "rate_limited",
      "Relay write limit reached",
      "Wait for the relay's write limit to reset before retrying.",
      "later",
    )
  }
  if (/^auth-required:/i.test(text)) {
    return outcome(
      "auth_required",
      "Relay requires authentication",
      "This is the relay's access policy, not a community grant. Check the relay/account configuration before retrying.",
      "after-change",
    )
  }
  if (/^payment-required:/i.test(text)) {
    return outcome(
      "payment_required",
      "Relay requires payment",
      "Check the relay's access policy. Budabit will not make a payment automatically.",
      "after-change",
    )
  }
  if (/^(blocked:|restricted:)/i.test(text)) {
    return outcome(
      "blocked",
      "Relay policy rejected the write",
      "Review the relay's reason below. Permission or relay-policy changes may be needed before retrying.",
      "after-change",
    )
  }
  if (/^error:/i.test(text)) {
    return outcome(
      "relay_error",
      "Relay could not process the write",
      "Review the relay's reason. Retry after the relay recovers; repeated errors need operator attention.",
      "later",
    )
  }
  return outcome(
    "unknown",
    "Publication failed",
    "Review the supplied reason and check the connection or signer before retrying.",
    "after-change",
  )
}

export const getRelayPublishOutcomes = (
  results: RelayPublishResults,
  expectedRelays: readonly string[] = [],
) =>
  [...new Set([...expectedRelays, ...Object.keys(results)])].map(relay =>
    classifyRelayPublishOutcome(relay, results[relay]),
  )

export const hasRelayPublishFailures = (results: RelayPublishResults) =>
  getRelayPublishOutcomes(results).some(
    outcome => !["accepted", "pending"].includes(outcome.reason),
  )

export const canRetryRelayPublishResults = (results: RelayPublishResults) => {
  const failures = getRelayPublishOutcomes(results).filter(
    outcome => !["accepted", "pending"].includes(outcome.reason),
  )
  // No terminal relay error may mean signing/target construction failed instead.
  return failures.length === 0 || failures.some(outcome => outcome.retry !== "none")
}

export const summarizeRelayPublishResults = (
  results: RelayPublishResults,
  expectedRelays: readonly string[] = [],
) => {
  const outcomes = getRelayPublishOutcomes(results, expectedRelays)
  const accepted = outcomes.filter(outcome => outcome.reason === "accepted").length
  const skipped = outcomes.filter(outcome => outcome.reason === "skipped").length
  const attempted = outcomes.length - skipped
  if (skipped === 0) return `Accepted by ${accepted}/${attempted} relays.`
  if (attempted === 0) return `No relay accepted the event; ${skipped} skipped (kind unsupported).`
  return `Accepted by ${accepted}/${attempted} attempted relays; ${skipped} skipped (kind unsupported).`
}

export const formatRelayPublishFailure = (
  results: RelayPublishResults,
  {
    expectedRelays = [],
    requiredRelay,
    fallback = "No relay accepted the event.",
  }: {
    expectedRelays?: readonly string[]
    requiredRelay?: string
    fallback?: string
  } = {},
) => {
  const outcomes = getRelayPublishOutcomes(results, expectedRelays)
  const failures = outcomes.filter(outcome => !["accepted", "pending"].includes(outcome.reason))
  if (!failures.length) return fallback
  const accepted = outcomes.filter(outcome => outcome.reason === "accepted")
  const heading = requiredRelay
    ? `Required relay ${requiredRelay} did not accept the event.`
    : outcomes.some(outcome => outcome.reason === "skipped")
      ? summarizeRelayPublishResults(results, expectedRelays)
      : accepted.length
        ? `Accepted by ${accepted.length}/${outcomes.length} relays; delivery is incomplete.`
        : "No relay accepted the event."
  return [
    heading,
    ...failures.map(
      outcome =>
        `${outcome.relay}: ${outcome.title}. ${outcome.detail || "No reason supplied."} ${outcome.guidance}`,
    ),
    ...(accepted.length
      ? [`Accepted by: ${accepted.map(outcome => outcome.relay).join(", ")}.`]
      : []),
  ].join("\n")
}

export class RelayPublishError extends Error {
  readonly name = "RelayPublishError"
  readonly results: PublishResultsByRelay
  readonly outcomes: RelayPublishOutcome[]

  constructor(
    readonly eventId: string,
    results: PublishResultsByRelay,
    readonly expectedRelays: readonly string[],
    readonly requiredRelay?: string,
  ) {
    super(formatRelayPublishFailure(results, {expectedRelays, requiredRelay}))
    this.results = Object.fromEntries(
      Object.entries(results).map(([relay, result]) => [relay, {...result}]),
    )
    this.outcomes = getRelayPublishOutcomes(this.results, expectedRelays)
  }
}
