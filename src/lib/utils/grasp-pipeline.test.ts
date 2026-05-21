import { describe, expect, it, vi } from "vitest";
import { createRepoStateEvent } from "@nostr-git/core/events";

import {
  buildGraspRepoUrls,
  getEditableRepoRelayUrls,
  getEffectiveRepoRelayUrls,
  getMandatoryGraspRelayUrls,
  getSuccessfulGraspRelayUrls,
  publishGraspRepoStateAndWait,
  publishGraspRepoStateForPush,
  waitForGraspRepoStateVisibility,
} from "./grasp-pipeline.js";

describe("grasp-pipeline", () => {
  it("builds clone URLs for every selected GRASP server", () => {
    const result = buildGraspRepoUrls({
      relayUrls: ["wss://relay.one", "https://relay.two", "wss://relay.one/"],
      ownerPubkey: "a".repeat(64),
      repoName: "flotilla-budabit",
    });

    expect(result.cloneUrls).toEqual([
      `https://relay.one/${result.ownerNpub}/flotilla-budabit.git`,
      `https://relay.two/${result.ownerNpub}/flotilla-budabit.git`,
    ]);
  });

  it("derives mandatory and editable relay sets for GRASP targets", () => {
    expect(
      getMandatoryGraspRelayUrls(["https://relay.one/api", "wss://relay.two/", "relay.one"])
    ).toEqual(["wss://relay.one", "wss://relay.two"]);

    expect(
      getEditableRepoRelayUrls(
        ["wss://relay.one", "wss://relay.extra", "wss://relay.two/"],
        ["https://relay.one", "wss://relay.two"]
      )
    ).toEqual(["wss://relay.extra"]);

    expect(
      getEffectiveRepoRelayUrls(["wss://relay.one", "wss://relay.extra"], ["https://relay.one"])
    ).toEqual(["wss://relay.extra", "wss://relay.one"]);
  });

  it("does not derive mandatory GRASP relays from platform clone URLs", () => {
    expect(
      getMandatoryGraspRelayUrls([
        "https://github.com",
        "github.com",
        "https://github.com/Pleb5/blossom-server",
        "https://github.com/Pleb5/blossom-server.git",
        "https://gitlab.com/group/project.git",
        "https://bitbucket.org/team/project",
        "https://grasp.example/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git",
      ])
    ).toEqual(["wss://grasp.example"]);
  });

  it("derives successful GRASP relays from successful remote URLs only", () => {
    expect(
      getSuccessfulGraspRelayUrls([
        "https://gitnostr.com/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git",
        "https://github.com/me/flotilla-budabit.git",
      ])
    ).toEqual(["wss://gitnostr.com"]);
  });

  it("waits until a matching GRASP repo state is visible on the relay", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      head: "dev",
      refs: [{ type: "heads", name: "dev", commit: "abc123def456" }],
      created_at: 1_717_171_717,
    });

    const fetchRelayEvents = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          id: "evt-visible",
          kind: 30618,
          pubkey: "f".repeat(64),
          created_at: 1_717_171_717,
          tags: [
            ["d", "flotilla-budabit"],
            ["refs/heads/dev", "abc123def456"],
            ["HEAD", "ref: refs/heads/dev"],
          ],
          content: "",
          sig: "sig",
        },
      ]);

    await expect(
      waitForGraspRepoStateVisibility({
        relayUrl: "https://relay.ngit.dev",
        stateEvent,
        fetchRelayEvents,
        authorPubkey: "f".repeat(64),
        pollIntervalMs: 0,
        settleDelayMs: 0,
        visibilityTimeoutMs: 50,
      })
    ).resolves.toEqual({ visible: true });

    expect(fetchRelayEvents).toHaveBeenNthCalledWith(1, {
      relays: ["wss://relay.ngit.dev"],
      filters: [
        {
          kinds: [30618],
          "#d": ["flotilla-budabit"],
          authors: ["f".repeat(64)],
          since: 1_717_171_707,
          limit: 10,
        },
      ],
      timeoutMs: 50,
    });
  });

  it("rejects publish when the selected relay does not ACK the state event", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      head: "dev",
      refs: [{ type: "heads", name: "dev", commit: "abc123def456" }],
    });

    const onPublishEvent = vi.fn().mockResolvedValue({
      ackedRelays: [],
      failedRelays: ["wss://relay.ngit.dev"],
      successCount: 0,
      hasRelayOutcomes: true,
    });
    const fetchRelayEvents = vi.fn();

    await expect(
      publishGraspRepoStateAndWait({
        relayUrl: "wss://relay.ngit.dev",
        stateEvent,
        onPublishEvent,
        fetchRelayEvents,
      })
    ).rejects.toThrow("did not ACK repo state");

    expect(fetchRelayEvents).not.toHaveBeenCalled();
  });

  it("treats repo state visibility as best effort and continues when it is not yet visible", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      head: "dev",
      refs: [{ type: "heads", name: "dev", commit: "abc123def456" }],
      created_at: 1_717_171_717,
    });

    const onPublishEvent = vi.fn().mockResolvedValue({
      ackedRelays: ["wss://relay.ngit.dev"],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
    });
    const fetchRelayEvents = vi.fn().mockResolvedValue([]);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      publishGraspRepoStateAndWait({
        relayUrl: "wss://relay.ngit.dev",
        stateEvent,
        onPublishEvent,
        fetchRelayEvents,
        settleDelayMs: 0,
        pollIntervalMs: 0,
        visibilityTimeoutMs: 0,
      })
    ).resolves.toEqual({
      ackedRelays: ["wss://relay.ngit.dev"],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "was not visible on wss://relay.ngit.dev within the verification window"
      )
    );
    warnSpy.mockRestore();
  });

  it("describes true relay query failures as query errors", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      head: "dev",
      refs: [{ type: "heads", name: "dev", commit: "abc123def456" }],
      created_at: 1_717_171_717,
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(
      waitForGraspRepoStateVisibility({
        relayUrl: "https://relay.ngit.dev",
        stateEvent,
        fetchRelayEvents: vi.fn().mockRejectedValue(new Error("relay unavailable")),
        authorPubkey: "f".repeat(64),
        pollIntervalMs: 0,
        settleDelayMs: 0,
        visibilityTimeoutMs: 0,
      })
    ).resolves.toEqual({
      visible: false,
      reason:
        "Repo state for flotilla-budabit (refs/heads/dev@abc123de) could not be queried on wss://relay.ngit.dev before push (relay unavailable)",
    });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("could not be queried on wss://relay.ngit.dev before push")
    );
    warnSpy.mockRestore();
  });

  it("builds and publishes branch state for GRASP push targets", async () => {
    const onPublishEvent = vi.fn().mockResolvedValue({
      ackedRelays: ["wss://relay.ngit.dev"],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
    });
    const fetchRelayEvents = vi.fn().mockResolvedValue([
      {
        id: "evt-visible",
        kind: 30618,
        pubkey: "a".repeat(64),
        created_at: Math.floor(Date.now() / 1000),
        tags: [
          ["d", "flotilla-budabit"],
          ["refs/heads/dev", "feedbeef1234"],
          ["HEAD", "ref: refs/heads/dev"],
        ],
        content: "",
        sig: "sig",
      },
    ]);

    await expect(
      publishGraspRepoStateForPush({
        remoteUrl:
          "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git",
        branch: "dev",
        commitSha: "feedbeef1234",
        authorPubkey: "a".repeat(64),
        onPublishEvent,
        fetchRelayEvents,
        settleDelayMs: 0,
      })
    ).resolves.toEqual({
      relayUrl: "wss://relay.ngit.dev",
      repoName: "flotilla-budabit",
    });

    expect(onPublishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30618,
        tags: expect.arrayContaining([
          ["d", "flotilla-budabit"],
          ["refs/heads/dev", "feedbeef1234"],
          ["HEAD", "ref: refs/heads/dev"],
        ]),
      })
    );
  });
});
