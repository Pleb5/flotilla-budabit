import {describe, expect, it} from "vitest"
import {buildPrDeliveryKey, orderPrimaryFirst, reducePrDeliveryOutcome} from "./pr-delivery-outcome"

describe("PR delivery outcome", () => {
  const remote = (primary: boolean, status: any, selected = true) => ({
    primary,
    status,
    selected,
  })

  it("completes only after exact primary confirmation", () => {
    expect(reducePrDeliveryOutcome([remote(true, "confirmed"), remote(false, "failed")])).toBe(
      "complete",
    )
    expect(reducePrDeliveryOutcome([remote(true, "unknown")])).toBe("unknown")
  })

  it("reports secondary-only delivery as partial", () => {
    expect(reducePrDeliveryOutcome([remote(true, "failed"), remote(false, "confirmed")])).toBe(
      "partial",
    )
  })

  it("requires the primary and orders it before secondary destinations", () => {
    expect(reducePrDeliveryOutcome([remote(true, "idle", false)])).toBe("pending")
    expect(
      orderPrimaryFirst([
        {primary: false, id: "mirror"},
        {primary: true, id: "primary"},
      ]),
    ).toEqual([
      {primary: true, id: "primary"},
      {primary: false, id: "mirror"},
    ])
  })

  it("invalidates delivery evidence when any analyzed identity field changes", () => {
    const identity = {
      rootId: "root",
      tipOid: "1".repeat(40),
      targetBranch: "main",
      targetOid: "2".repeat(40),
      announcementId: "announcement",
      primaryUrl: "https://primary.example/repo.git",
      mergeOid: "3".repeat(40),
      actor: "4".repeat(64),
    }
    const key = buildPrDeliveryKey(identity)

    for (const field of Object.keys(identity) as Array<keyof typeof identity>) {
      expect(buildPrDeliveryKey({...identity, [field]: `${identity[field]}-changed`})).not.toBe(key)
    }
  })
})
