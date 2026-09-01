import {describe, expect, it} from "vitest"
import type {TrustedEvent} from "@welshman/util"
import type {PullRequestEvent} from "@nostr-git/core/events"
import {orderPrimaryFirst, reducePrDeliveryOutcome} from "./pr-delivery-outcome"
import {buildPrAnalysisIdentity, planPrMergeRemotes} from "./pr-merge-targets"
import {selectAuthorizedPullRequestUpdates} from "./pr-update-selection"

const author = "a".repeat(64)
const repoAddress = `30617:${"b".repeat(64)}:repo`
const rootTip = "1".repeat(40)
const updateTip = "2".repeat(40)
const targetOid = "3".repeat(40)
const mergeOid = "4".repeat(40)
const primaryUrl = "https://grasp.example/git/owner/repo.git"
const secondaryUrl = "https://github.com/owner/repo.git"

const root = {
  id: "5".repeat(64),
  pubkey: author,
  created_at: 1,
  kind: 1618,
  tags: [
    ["a", repoAddress],
    ["c", rootTip],
    ["target-branch", "main"],
  ],
  content: "root",
  sig: "6".repeat(128),
} as PullRequestEvent

const update = (overrides: Partial<TrustedEvent> = {}): TrustedEvent => ({
  id: "7".repeat(64),
  pubkey: author,
  created_at: 2,
  kind: 1619,
  tags: [
    ["a", repoAddress],
    ["E", root.id],
    ["P", author],
    ["c", updateTip],
  ],
  content: "",
  sig: "8".repeat(128),
  ...overrides,
})

type WorkflowOptions = {
  updates?: TrustedEvent[]
  targetBeforeMerge?: string
  primaryAfterPush?: "confirmed" | "failed" | "unknown"
  secondaryAfterPush?: "confirmed" | "failed"
  ackError?: Error
}

const runWorkflow = async (options: WorkflowOptions = {}) => {
  const calls: string[] = ["load"]
  const trusted = selectAuthorizedPullRequestUpdates({root, updates: options.updates || [update()]})
  calls.push("authorize")
  if ((options.updates || [update()]).length > 0 && trusted.length === 0) {
    return {stage: "untrusted", calls}
  }

  const tipOid = trusted.at(-1)?.tipCommitOid || rootTip
  const analysisIdentity = buildPrAnalysisIdentity({
    rootId: root.id,
    tipOid,
    targetBranch: "main",
    targetOid,
    announcementId: "announcement",
    primaryUrl,
  })
  calls.push("analyze", "confirm")
  if ((options.targetBeforeMerge || targetOid) !== targetOid) {
    return {stage: "stale-target", calls, analysisIdentity}
  }

  const plan = planPrMergeRemotes({declaredCloneUrls: [primaryUrl, secondaryUrl]})
  const ordered = orderPrimaryFirst(plan.remotes)
  calls.push("publish-30618")
  calls.push(`push:${ordered[0].url}`)

  const remotes = ordered.map(remote => ({
    ...remote,
    selected: true,
    status: remote.primary
      ? options.primaryAfterPush || "confirmed"
      : options.secondaryAfterPush || "confirmed",
  }))
  calls.push("reconcile-ref")
  const outcome = reducePrDeliveryOutcome(remotes)
  if (outcome !== "complete") return {stage: outcome, calls, analysisIdentity}

  calls.push("ack-1631")
  if (options.ackError) return {stage: "status-pending", calls, analysisIdentity}
  calls.push("reload-status")
  return {stage: "applied", calls, analysisIdentity, mergeOid}
}

describe("trusted PR merge workflow orchestration", () => {
  it("runs trusted analysis through primary reconciliation and ACK-applied reload", async () => {
    const result = await runWorkflow()

    expect(result.stage).toBe("applied")
    expect(result.calls).toEqual([
      "load",
      "authorize",
      "analyze",
      "confirm",
      "publish-30618",
      `push:${primaryUrl}`,
      "reconcile-ref",
      "ack-1631",
      "reload-status",
    ])
  })

  it("rejects a forged update before analysis", async () => {
    const result = await runWorkflow({updates: [update({pubkey: "f".repeat(64)})]})
    expect(result).toEqual({stage: "untrusted", calls: ["load", "authorize"]})
  })

  it("rejects target movement before state publication or push", async () => {
    const result = await runWorkflow({targetBeforeMerge: "9".repeat(40)})
    expect(result.stage).toBe("stale-target")
    expect(result.calls).not.toContain("publish-30618")
  })

  it("keeps secondary-only delivery partial without applied publication", async () => {
    const result = await runWorkflow({primaryAfterPush: "failed", secondaryAfterPush: "confirmed"})
    expect(result.stage).toBe("partial")
    expect(result.calls).not.toContain("ack-1631")
  })

  it("leaves an indeterminate primary for ref-only reconciliation without repush", async () => {
    const result = await runWorkflow({primaryAfterPush: "unknown"})
    expect(result.stage).toBe("unknown")
    expect(result.calls.filter(call => call === `push:${primaryUrl}`)).toHaveLength(1)
    expect(result.calls).not.toContain("ack-1631")
  })

  it("retains Git success for status-only retry when the applied ACK fails", async () => {
    const result = await runWorkflow({ackError: new Error("relay rejected")})
    expect(result.stage).toBe("status-pending")
    expect(result.calls).toContain("ack-1631")
    expect(result.calls).not.toContain("reload-status")
  })
})
