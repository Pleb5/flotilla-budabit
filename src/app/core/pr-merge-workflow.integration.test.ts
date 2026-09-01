import {describe, expect, it, vi} from "vitest"
import type {PrDeliveryIdentity} from "./pr-delivery-outcome"
import {completePrDelivery, deliverPrRemote} from "./pr-merge-delivery"

const identity: PrDeliveryIdentity = {
  rootId: "root",
  tipOid: "1".repeat(40),
  targetBranch: "main",
  targetOid: "2".repeat(40),
  announcementId: "announcement",
  primaryUrl: "https://primary.example/repo.git",
  mergeOid: "3".repeat(40),
  actor: "4".repeat(64),
}

describe("PR merge delivery coordinator", () => {
  it("publishes state before one exact-OID push and confirms the remote", async () => {
    const calls: string[] = []
    const result = await deliverPrRemote({
      prepare: async () => {
        calls.push("publish-state")
        return async () => {
          calls.push("verify-state")
        }
      },
      push: async () => {
        calls.push(`push:${identity.mergeOid}`)
        return {success: true}
      },
      verify: async () => {
        calls.push(`verify-ref:${identity.mergeOid}`)
      },
      isUnknown: () => false,
    })
    await (result.status === "confirmed" ? result.verifyMetadata?.() : undefined)

    expect(result.status).toBe("confirmed")
    expect(calls).toEqual([
      "publish-state",
      `push:${identity.mergeOid}`,
      `verify-ref:${identity.mergeOid}`,
      "verify-state",
    ])
  })

  it("reconciles an ambiguous push without repeating it", async () => {
    const push = vi.fn().mockResolvedValue({success: false, error: new Error("network timeout")})
    const verify = vi.fn().mockRejectedValue(new Error("network timeout during inspection"))

    await expect(deliverPrRemote({push, verify, isUnknown: () => true})).resolves.toMatchObject({
      status: "unknown",
    })
    expect(push).toHaveBeenCalledOnce()
    expect(verify).toHaveBeenCalledOnce()
  })

  it("treats a conclusive post-push ref divergence as failed", async () => {
    const push = vi.fn().mockResolvedValue({success: false, error: new Error("network timeout")})
    const verify = vi.fn().mockRejectedValue(new Error("remote ref diverged"))

    await expect(
      deliverPrRemote({push, verify, isUnknown: error => /timeout/.test(String(error))}),
    ).resolves.toMatchObject({status: "failed"})
    expect(push).toHaveBeenCalledOnce()
  })

  it("turns an ambiguous transport result into confirmation when the exact ref matches", async () => {
    const push = vi.fn().mockResolvedValue({success: false, error: new Error("network timeout")})
    await expect(
      deliverPrRemote({push, verify: vi.fn().mockResolvedValue(undefined), isUnknown: () => true}),
    ).resolves.toMatchObject({status: "confirmed"})
    expect(push).toHaveBeenCalledOnce()
  })

  it("keeps deterministic pre-push rejection failed", async () => {
    await expect(
      deliverPrRemote({
        push: vi.fn().mockResolvedValue({success: false, error: new Error("permission denied")}),
        verify: vi.fn(),
        isUnknown: () => false,
      }),
    ).resolves.toMatchObject({status: "failed"})
  })

  it("ACKs applied status and reloads only for the current completed identity", async () => {
    const publishApplied = vi.fn().mockResolvedValue(undefined)
    const reload = vi.fn()
    await expect(
      completePrDelivery({
        outcome: "complete",
        identity,
        isCurrent: () => true,
        publishApplied,
        reload,
      }),
    ).resolves.toBe("acked")
    expect(publishApplied).toHaveBeenCalledWith(identity)
    expect(reload).toHaveBeenCalledOnce()
  })

  it("retains Git completion for status-only retry after ACK failure", async () => {
    const reload = vi.fn()
    await expect(
      completePrDelivery({
        outcome: "complete",
        identity,
        isCurrent: () => true,
        publishApplied: vi.fn().mockRejectedValue(new Error("relay rejected")),
        reload,
      }),
    ).resolves.toBe("pending")
    expect(reload).not.toHaveBeenCalled()
  })
})
