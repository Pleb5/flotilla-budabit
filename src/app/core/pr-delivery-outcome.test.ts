import {describe, expect, it} from "vitest"
import {orderPrimaryFirst, reducePrDeliveryOutcome} from "./pr-delivery-outcome"

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
})
