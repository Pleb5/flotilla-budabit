import { afterEach, describe, expect, it, vi } from "vitest";

import { checkGraspReceivePackReady, checkGraspRepoExists } from "./grasp-availability.js";

describe("grasp-availability", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("treats an empty provisioned repository as resumable rather than existing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        "001e# service=git-upload-pack\n000001350000000000000000000000000000000000000000 capabilities^{}\0multi_ack\n0000",
        { status: 200 }
      )
    );

    await expect(
      checkGraspRepoExists({
        relayUrl: "wss://grasp.example",
        userPubkey: "a".repeat(64),
        owner: "a".repeat(64),
        repoName: "seedsigner",
      })
    ).resolves.toMatchObject({ exists: false, provisioned: true });
  });

  it("recognizes a repository with an advertised Git ref as existing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        `001e# service=git-upload-pack\n0044${"b".repeat(40)} HEAD\0multi_ack\n0000`,
        { status: 200 }
      )
    );

    await expect(
      checkGraspRepoExists({
        relayUrl: "wss://grasp.example",
        userPubkey: "a".repeat(64),
        owner: "a".repeat(64),
        repoName: "seedsigner",
      })
    ).resolves.toMatchObject({ exists: true, provisioned: true });
  });

  it("probes receive-pack with only the service query parameter", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/x-git-receive-pack-advertisement" },
      })
    );

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

  it("preserves a configured base path and percent-encodes the repository identifier", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("", {
        status: 200,
        headers: { "content-type": "application/x-git-receive-pack-advertisement" },
      })
    );

    await checkGraspReceivePackReady({
      relayUrl: "wss://grasp.example/git",
      owner: "a".repeat(64),
      repoName: "group/repo",
    });

    expect(String(fetchSpy.mock.calls[0]?.[0] ?? "")).toContain("/git/npub1");
    expect(String(fetchSpy.mock.calls[0]?.[0] ?? "")).toContain(
      "/group%2Frepo.git/info/refs?service=git-receive-pack"
    );
  });
});
