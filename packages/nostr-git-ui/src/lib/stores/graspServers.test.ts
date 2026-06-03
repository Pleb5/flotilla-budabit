import { describe, expect, it } from "vitest";

import {
  DEFAULT_GRASP_SERVER_URL,
  DEFAULT_RECOMMENDED_GRASP_SERVER_URLS,
  getRecommendedGraspServerUrls,
  isValidGraspServerUrl,
  normalizeGraspServerUrl,
  normalizeGraspServerUrls,
} from "./graspServers";

describe("grasp server helpers", () => {
  it("keeps the Budabit relay first in the recommended defaults", () => {
    expect(DEFAULT_GRASP_SERVER_URL).toBe("wss://grasp.budabit.club");
    expect(DEFAULT_RECOMMENDED_GRASP_SERVER_URLS).toEqual([
      "wss://grasp.budabit.club",
      "wss://relay.ngit.dev",
      "wss://gitnostr.com",
    ]);
  });

  it("normalizes relay urls before deduping recommendations", () => {
    expect(
      getRecommendedGraspServerUrls([
        "wss://relay.ngit.dev/",
        "wss://custom.example.com/",
        "wss://grasp.budabit.club",
      ])
    ).toEqual([
      "wss://grasp.budabit.club",
      "wss://relay.ngit.dev",
      "wss://gitnostr.com",
      "wss://custom.example.com",
    ]);
  });

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
