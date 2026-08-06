import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import { canProceedImportStep2, getUnbackedGraspRelayUrls } from "./import-dialog-state.js";

describe("import-dialog-state", () => {
  it("keeps relay form state empty until a concrete selection is made", () => {
    const source = readFileSync(
      new URL("../components/git/ImportRepoDialog.svelte", import.meta.url),
      "utf8"
    );

    expect(source).toContain("defaultRelays = []");
    expect(source).toContain("let selectedRelays = $state<string[]>([...defaultRelays])");
    expect(source).toContain("Select at least one repository or GRASP relay");
    expect(source).not.toContain("DEFAULT_RELAYS.default");
    expect(source).not.toContain("graspRelayUrls = [...urls]");
  });

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

  it("detects a GRASP repository relay without its matching selected target", () => {
    expect(
      getUnbackedGraspRelayUrls({
        repoRelayUrls: ["wss://grasp.budabit.club", "wss://relay.example"],
        selectedImportTargetIds: ["git:github.com"],
        importTargets: [
          { id: "git:github.com", status: "ready", provider: "github" },
          {
            id: "grasp:wss://grasp.budabit.club",
            status: "ready",
            provider: "grasp",
            relayUrl: "https://grasp.budabit.club/",
          },
        ],
      })
    ).toEqual(["wss://grasp.budabit.club"]);
  });

  it("accepts a GRASP repository relay backed by its selected target", () => {
    expect(
      getUnbackedGraspRelayUrls({
        repoRelayUrls: ["wss://grasp.budabit.club"],
        selectedImportTargetIds: ["grasp:wss://grasp.budabit.club"],
        importTargets: [
          {
            id: "grasp:wss://grasp.budabit.club",
            status: "ready",
            provider: "grasp",
            relayUrl: "wss://grasp.budabit.club",
          },
        ],
      })
    ).toEqual([]);
  });

  it("blocks step 2 when a selected GRASP relay has no matching target", () => {
    expect(
      canProceedImportStep2({
        hasRepoMetadata: true,
        effectiveRelayCount: 1,
        isOwner: false,
        selectedImportTargetIds: ["git:github.com"],
        importTargets: [{ id: "git:github.com", status: "ready", provider: "github" }],
        unbackedGraspRelayCount: 1,
      })
    ).toBe(false);
  });
});
