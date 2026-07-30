import {describe, expect, it} from "vitest"
import {
  getModalHashSyncPlan,
  getModalStackForActiveId,
  getModalTopClosePlan,
  shouldUseHistoryForTopClose,
} from "./modal-stack"

describe("modal stack helpers", () => {
  it("derives the mounted stack from the active hash id", () => {
    expect(getModalStackForActiveId(["notifications", "profile", "event"], "profile")).toEqual([
      "notifications",
      "profile",
    ])

    expect(getModalStackForActiveId(["notifications", "profile"], "missing")).toEqual([])
    expect(getModalStackForActiveId(["notifications", "profile"], "")).toEqual([])
  })

  it("prunes abandoned top modals when browser back moves to a lower hash", () => {
    expect(getModalHashSyncPlan(["notifications", "profile", "event"], "profile")).toEqual({
      retainedIds: ["notifications", "profile"],
      removedIds: ["event"],
    })
  })

  it("clears modal state when the active hash is gone or unknown", () => {
    expect(getModalHashSyncPlan(["notifications", "profile"], "")).toEqual({
      retainedIds: [],
      removedIds: ["notifications", "profile"],
    })

    expect(getModalHashSyncPlan(["notifications", "profile"], "missing")).toEqual({
      retainedIds: [],
      removedIds: ["notifications", "profile"],
    })
  })

  it("closes only the active modal and prunes any stack above it", () => {
    expect(getModalTopClosePlan(["notifications", "profile"], "profile")).toEqual({
      previousId: "notifications",
      retainedIds: ["notifications"],
      removedIds: ["profile"],
    })

    expect(getModalTopClosePlan(["notifications", "profile"], "notifications")).toEqual({
      previousId: "",
      retainedIds: [],
      removedIds: ["notifications", "profile"],
    })
  })

  it("uses browser history only for pushed stacked modals", () => {
    const plan = getModalTopClosePlan(["notifications", "profile"], "profile")

    expect(shouldUseHistoryForTopClose(plan, {}, true)).toBe(true)
    expect(shouldUseHistoryForTopClose(plan, {replaceState: true}, true)).toBe(false)
    expect(shouldUseHistoryForTopClose(plan, {}, false)).toBe(false)
    expect(
      shouldUseHistoryForTopClose(getModalTopClosePlan(["notifications"], "notifications")),
    ).toBe(false)
  })
})
