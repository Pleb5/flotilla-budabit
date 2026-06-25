import { describe, expect, it } from "vitest";

import {
  isValidGraspServerUrl,
  normalizeGraspServerUrl,
  normalizeGraspServerUrls,
} from "./graspServers";

describe("grasp server helpers", () => {
  it("trims trailing slashes from manual entries", () => {
    expect(normalizeGraspServerUrl("  wss://gitnostr.com/  ")).toBe("wss://gitnostr.com");
  });

  it("rejects platform and clone URLs as GRASP server entries", () => {
    expect(isValidGraspServerUrl("wss://grasp.budabit.club")).toBe(true);
    expect(isValidGraspServerUrl("https://github.com")).toBe(false);
    expect(isValidGraspServerUrl("https://github.com/Pleb5/flotilla-budabit.git")).toBe(false);
  });

  it("normalizes stored relay lists so old trailing-slash entries can be removed", () => {
    expect(
      normalizeGraspServerUrls([
        "wss://grasp.budabit.club/",
        "wss://grasp.budabit.club",
        "https://github.com/Pleb5/flotilla-budabit.git",
      ])
    ).toEqual(["wss://grasp.budabit.club"]);
  });
});
