import {describe, expect, it} from "vitest"
import {
  getExpectedBuildAction,
  isDynamicAppShellFailure,
  shouldPrepareAppUpdate,
} from "./app-update"

describe("app update policy", () => {
  it("reconciles every published build that differs from the running build", () => {
    expect(shouldPrepareAppUpdate({remoteBuildId: "", runningBuildId: "a"})).toBe(false)
    expect(shouldPrepareAppUpdate({remoteBuildId: "a", runningBuildId: "a"})).toBe(false)
    expect(shouldPrepareAppUpdate({remoteBuildId: "b", runningBuildId: "a"})).toBe(true)
  })

  it("reloads a mismatched document only when the expected worker controls it", () => {
    expect(
      getExpectedBuildAction({
        expectedBuildId: "b",
        runningBuildId: "a",
        controllerBuildId: "b",
        recoveryAttempted: false,
      }),
    ).toBe("reload")
    expect(
      getExpectedBuildAction({
        expectedBuildId: "b",
        runningBuildId: "a",
        controllerBuildId: "a",
        recoveryAttempted: false,
      }),
    ).toBe("recover")
    expect(
      getExpectedBuildAction({
        expectedBuildId: "b",
        runningBuildId: "a",
        controllerBuildId: "b",
        recoveryAttempted: true,
      }),
    ).toBe("recover")
  })

  it("continues when there is no expected build or the expected build is running", () => {
    expect(
      getExpectedBuildAction({
        expectedBuildId: "",
        runningBuildId: "a",
        controllerBuildId: "a",
        recoveryAttempted: false,
      }),
    ).toBe("continue")
    expect(
      getExpectedBuildAction({
        expectedBuildId: "a",
        runningBuildId: "a",
        controllerBuildId: "a",
        recoveryAttempted: false,
      }),
    ).toBe("continue")
  })

  it("only classifies immutable dynamic-import failures", () => {
    expect(
      isDynamicAppShellFailure(
        "Failed to fetch dynamically imported module: /_app/immutable/nodes/1.js",
      ),
    ).toBe(true)
    expect(isDynamicAppShellFailure("Failed to fetch dynamically imported module: /api/data")).toBe(
      false,
    )
    expect(isDynamicAppShellFailure("Request failed for /_app/immutable/image.png")).toBe(false)
  })
})
