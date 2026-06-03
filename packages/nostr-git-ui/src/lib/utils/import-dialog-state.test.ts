import { describe, expect, it } from "vitest";

import { canProceedImportStep2 } from "./import-dialog-state.js";

describe("import-dialog-state", () => {
  it("allows step 2 when only a mandatory GRASP relay is present", () => {
    expect(
      canProceedImportStep2({
        hasRepoMetadata: true,
        effectiveRelayCount: 1,
        isOwner: false,
        selectedImportTargetIds: ["grasp:wss://grasp.budabit.club"],
        importTargets: [
          { id: "git:github.com", status: "ready" },
          { id: "grasp:wss://grasp.budabit.club", status: "ready" },
        ],
      })
    ).toBe(true);
  });

  it("blocks step 2 when there are no effective relays", () => {
    expect(
      canProceedImportStep2({
        hasRepoMetadata: true,
        effectiveRelayCount: 0,
        isOwner: false,
        selectedImportTargetIds: ["grasp:wss://grasp.budabit.club"],
        importTargets: [{ id: "grasp:wss://grasp.budabit.club", status: "ready" }],
      })
    ).toBe(false);
  });

  it("allows owners to proceed without selecting a writable target", () => {
    expect(
      canProceedImportStep2({
        hasRepoMetadata: true,
        effectiveRelayCount: 1,
        isOwner: true,
        selectedImportTargetIds: [],
        importTargets: [],
      })
    ).toBe(true);
  });
});
