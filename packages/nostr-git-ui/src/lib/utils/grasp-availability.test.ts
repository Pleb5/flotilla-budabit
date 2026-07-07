import { afterEach, describe, expect, it, vi } from "vitest";

import { checkGraspReceivePackReady } from "./grasp-availability.js";

describe("grasp-availability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("probes receive-pack with only the service query parameter", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("", { status: 200 }));

    await expect(
      checkGraspReceivePackReady({
        relayUrl: "wss://grasp.example",
        owner: "a".repeat(64),
        repoName: "blossom-server",
      })
    ).resolves.toBe(true);

    const url = String(fetchSpy.mock.calls[0]?.[0] ?? "");
    expect(url).toContain("/blossom-server.git/info/refs?service=git-receive-pack");
    expect(url).not.toContain("_ts=");
    expect(url).not.toContain("&");
  });
});
