import { describe, expect, it, vi } from "vitest";
import { createRepoAnnouncementEvent, createRepoStateEvent } from "@nostr-git/core/events";

const graspAvailabilityMocks = vi.hoisted(() => ({
  checkGraspRepoExists: vi.fn(),
  checkGraspReceivePackReady: vi.fn(),
}));

vi.mock("./grasp-availability.js", () => graspAvailabilityMocks);

import {
  buildGraspRepoUrls,
  createGraspStateEventFromExistingState,
  createGraspAnnouncementAndState,
  fetchLatestGraspRepoStateEvent,
  getEditableRepoRelayUrls,
  getEffectiveRepoRelayUrls,
  getMandatoryGraspRelayUrls,
  getSuccessfulGraspRelayUrls,
  publishGraspEventWithRetry,
  publishGraspRepoStateAndWait,
  publishGraspRepoStateForPush,
  reconcileRepoCreationEvents,
  verifyGraspEventAfterPush,
  waitForGraspProvisioning,
} from "./grasp-pipeline.js";

function signedEvent(event: any, id = "signed-event") {
  return {
    ...event,
    id,
    pubkey: event.pubkey || "f".repeat(64),
    sig: event.sig || "signature",
  };
}

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

  it("preserves GRASP base paths and percent-encodes repository identifiers", () => {
    const result = buildGraspRepoUrls({
      relayUrls: ["wss://relay.one/git"],
      ownerPubkey: "a".repeat(64),
      repoName: "group/repo",
    });

    expect(result.cloneUrls).toEqual([
      `https://relay.one/git/${result.ownerNpub}/group%2Frepo.git`,
    ]);
  });

  it("derives mandatory and editable relay sets for GRASP targets", () => {
    expect(
      getMandatoryGraspRelayUrls(["https://relay.one/api", "wss://relay.two/", "relay.one"])
    ).toEqual(["wss://relay.one/api", "wss://relay.two", "wss://relay.one"]);

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

  it("does not add maintainer tags when none are provided", () => {
    const { announcementEvent } = createGraspAnnouncementAndState({
      relayUrl: "wss://relay.ngit.dev",
      ownerPubkey: "a".repeat(64),
      repoName: "flotilla-budabit",
    });

    expect(announcementEvent.tags.some((tag) => tag[0] === "maintainers")).toBe(false);
  });

  it("preserves explicitly provided maintainer tags", () => {
    const maintainer = "b".repeat(64);
    const { announcementEvent } = createGraspAnnouncementAndState({
      relayUrl: "wss://relay.ngit.dev",
      ownerPubkey: "a".repeat(64),
      repoName: "flotilla-budabit",
      maintainers: [maintainer],
    });

    expect(announcementEvent.tags).toContainEqual(["maintainers", maintainer]);
  });

  it("keeps relay hints on announcements and omits them from state events", () => {
    const { announcementEvent, stateEvent } = createGraspAnnouncementAndState({
      relayUrl: "wss://relay.ngit.dev",
      ownerPubkey: "a".repeat(64),
      repoName: "flotilla-budabit",
      relays: ["wss://relay.ngit.dev", "wss://relay.extra"],
      refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
      head: "main",
    });

    expect(announcementEvent.tags).toContainEqual([
      "relays",
      "wss://relay.ngit.dev",
      "wss://relay.extra",
    ]);
    expect(stateEvent.tags.some((tag) => tag[0] === "relays")).toBe(false);
  });

  it("fails closed when a publish result has no relay outcomes", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
      head: "main",
    });

    await expect(
      publishGraspEventWithRetry({
        relayUrl: "wss://relay.ngit.dev",
        event: stateEvent,
        publishRelays: ["wss://relay.ngit.dev"],
        onPublishEvent: vi.fn().mockResolvedValue({ event: signedEvent(stateEvent) }),
        maxAttempts: 1,
        retryDelayMs: 0,
      })
    ).rejects.toThrow("publish result did not include relay outcomes");
  });

  it("replays the exact signed event and preserves tags and explicit relay destinations", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
      head: "main",
    });
    const signed = signedEvent(stateEvent, "exact-signed-id");
    const publishRelays = ["wss://relay.ngit.dev", "wss://relay.extra"];
    const onPublishEvent = vi
      .fn()
      .mockResolvedValueOnce({
        event: signed,
        ackedRelays: [],
        failedRelays: ["wss://relay.ngit.dev"],
      })
      .mockResolvedValueOnce({
        event: signed,
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
      });

    await expect(
      publishGraspEventWithRetry({
        relayUrl: "https://relay.ngit.dev",
        event: stateEvent,
        onPublishEvent,
        publishRelays,
        retryDelayMs: 0,
      })
    ).resolves.toEqual({
      event: signed,
      relayAck: {
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
        successCount: 1,
        hasRelayOutcomes: true,
      },
    });

    expect(onPublishEvent).toHaveBeenCalledTimes(2);
    expect(onPublishEvent.mock.calls[0][0]).toBe(stateEvent);
    expect(onPublishEvent.mock.calls[1][0]).toBe(signed);
    expect(onPublishEvent.mock.calls[0][1].relays).toBe(publishRelays);
    expect(onPublishEvent.mock.calls[1][1].relays).toBe(publishRelays);
    expect(signed.tags).toEqual(stateEvent.tags);
    expect(signed.tags.some((tag: string[]) => tag[0] === "relays")).toBe(false);
  });

  it("does not treat an id-only prepared event as signed for retry", async () => {
    const prepared = {
      ...createRepoStateEvent({
        repoId: "flotilla-budabit",
        refs: [{ type: "heads" as const, name: "main", commit: "a".repeat(40) }],
        head: "main",
      }),
      id: "prepared-id",
      pubkey: "f".repeat(64),
    };
    const signed = { ...prepared, sig: "signature" };
    const onPublishEvent = vi
      .fn()
      .mockResolvedValueOnce({
        event: signed,
        relayOutcomes: [{ relay: "wss://relay.ngit.dev", status: "timeout", detail: "timed out" }],
      })
      .mockResolvedValueOnce({
        event: signed,
        relayOutcomes: [
          { relay: "wss://relay.ngit.dev", status: "success", detail: "stored in purgatory" },
        ],
      });

    await publishGraspEventWithRetry({
      relayUrl: "wss://relay.ngit.dev",
      event: prepared as any,
      onPublishEvent,
      publishRelays: ["wss://relay.ngit.dev"],
      retryDelayMs: 0,
    });

    expect(onPublishEvent.mock.calls[0][0]).toBe(prepared);
    expect(onPublishEvent.mock.calls[1][0]).toBe(signed);
  });

  it("reports relay rejection details and signs state for recovery", async () => {
    const relayUrl = "wss://grasp.example";
    const stateEvent = createRepoStateEvent({
      repoId: "repo",
      refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
      head: "main",
    });
    const onPublishEvent = vi.fn(async (event: any) => ({
      event: signedEvent(event, `signed-${event.kind}`),
      relayOutcomes:
        event.kind === 30617
          ? [
              {
                relay: relayUrl,
                status: "failure",
                detail: "invalid: clone tag does not list this GRASP service",
              },
            ]
          : [],
    }));

    await expect(
      reconcileRepoCreationEvents({
        relayUrls: [relayUrl],
        stateEvent,
        onPublishEvent,
        buildAnnouncement: ({ relays, createdAt }) =>
          createRepoAnnouncementEvent({
            repoId: "repo",
            clone: ["https://github.com/alice/repo.git"],
            relays,
            created_at: createdAt,
          }),
      })
    ).rejects.toThrow("invalid: clone tag does not list this GRASP service");

    expect(onPublishEvent).toHaveBeenNthCalledWith(2, stateEvent, {
      relays: [],
      stage: "final",
    });
  });

  it("rebuilds final metadata until every retained relay ACKs announcement and state", async () => {
    const relayOne = "wss://relay.one";
    const relayTwo = "wss://relay.two";
    const stateEvent = createRepoStateEvent({
      repoId: "repo",
      refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
      head: "main",
    });
    const announcements: any[] = [];
    const onPublishEvent = vi.fn(async (event: any, context?: { relays: string[] }) => {
      const signed = signedEvent(event, `${event.kind}-${event.created_at}`);
      const relays = context?.relays || [];
      if (event.kind === 30617) announcements.push(signed);

      if (event.kind === 30618 && relays.includes(relayTwo)) {
        return {
          event: signed,
          relayOutcomes: [
            { relay: relayOne, status: "success", detail: "stored" },
            { relay: relayTwo, status: "timeout", detail: "timed out" },
          ],
        };
      }

      return {
        event: signed,
        relayOutcomes: relays.map((relay) => ({
          relay,
          status: relay === relayTwo && relays.length === 1 ? "failure" : "success",
          detail: relay === relayTwo && relays.length === 1 ? "service not listed" : "stored",
        })),
      };
    });

    const result = await reconcileRepoCreationEvents({
      relayUrls: [relayOne, relayTwo],
      provisionalRelayUrls: [relayOne, relayTwo],
      graspTargets: [
        { relayUrl: relayOne, cloneUrl: "https://relay.one/npub/repo.git" },
        { relayUrl: relayTwo, cloneUrl: "https://relay.two/npub/repo.git" },
      ],
      stateEvent,
      onPublishEvent,
      minCreatedAt: 100,
      buildAnnouncement: ({ relays, graspCloneUrls, createdAt }) =>
        createRepoAnnouncementEvent({
          repoId: "repo",
          clone: ["https://github.com/alice/repo.git", ...graspCloneUrls],
          relays,
          created_at: createdAt,
        }),
    });

    expect(result.relays).toEqual([relayOne]);
    expect(result.graspRelayUrls).toEqual([relayOne]);
    expect(result.graspCloneUrls).toEqual(["https://relay.one/npub/repo.git"]);
    expect(result.removedRelays).toEqual([relayTwo]);
    expect(result.announcementEvent.tags).toContainEqual(["relays", relayOne]);
    expect(result.announcementEvent.tags).toContainEqual([
      "clone",
      "https://github.com/alice/repo.git",
      "https://relay.one/npub/repo.git",
    ]);
    expect(announcements[1].created_at).toBeGreaterThan(announcements[0].created_at);
    expect(onPublishEvent).toHaveBeenLastCalledWith(result.announcementEvent, {
      relays: [relayTwo],
      stage: "final",
    });
    expect(result.cleanupFailures).toEqual([]);
  });

  it("journals a timed-out final de-list replacement for compensation", async () => {
    const relayOne = "wss://relay.one";
    const relayTwo = "wss://relay.two";
    const onPublishEvent = vi.fn(async (event: any, context?: { relays: string[] }) => {
      const relays = context?.relays || [];
      const isStateShrink = event.kind === 30618 && relays.includes(relayTwo);
      const isDelistRetry = event.kind === 30617 && relays.length === 1 && relays[0] === relayTwo;
      return {
        event: signedEvent(event, `${event.kind}-${event.created_at}`),
        relayOutcomes: relays.map((relay) => ({
          relay,
          status: (isStateShrink && relay === relayTwo) || isDelistRetry ? "timeout" : "success",
          detail: (isStateShrink && relay === relayTwo) || isDelistRetry ? "timed out" : "stored",
        })),
      };
    });

    const result = await reconcileRepoCreationEvents({
      relayUrls: [relayOne, relayTwo],
      provisionalRelayUrls: [relayOne, relayTwo],
      stateEvent: createRepoStateEvent({ repoId: "repo" }),
      onPublishEvent,
      buildAnnouncement: ({ relays, createdAt }) =>
        createRepoAnnouncementEvent({
          repoId: "repo",
          clone: ["https://github.com/alice/repo.git"],
          relays,
          created_at: createdAt,
        }),
    });

    expect(result.cleanupFailures).toEqual([
      {
        action: "republish",
        eventId: result.announcementEvent.id,
        relayUrls: [relayTwo],
        error: "timed out",
      },
    ]);
  });

  it("deletes obsolete provisional events by exact event ID after final stabilization", async () => {
    const relay = "wss://relay.one";
    const provisional = signedEvent(createRepoStateEvent({ repoId: "repo" }), "provisional-id");
    const onDeleteEvent = vi.fn();
    const onPublishEvent = vi.fn(async (event: any, context?: { relays: string[] }) => ({
      event: signedEvent(event, `${event.kind}-${event.created_at}`),
      relayOutcomes: (context?.relays || []).map((relayUrl) => ({
        relay: relayUrl,
        status: "success",
        detail: "stored",
      })),
    }));

    const result = await reconcileRepoCreationEvents({
      relayUrls: [relay],
      provisionalRelayUrls: [relay],
      provisionalEvents: [{ event: provisional, relayUrls: [relay] }],
      stateEvent: createRepoStateEvent({ repoId: "repo" }),
      onPublishEvent,
      onDeleteEvent,
      buildAnnouncement: ({ relays, createdAt }) =>
        createRepoAnnouncementEvent({
          repoId: "repo",
          clone: ["https://github.com/alice/repo.git"],
          relays,
          created_at: createdAt,
        }),
    });

    expect(onDeleteEvent).toHaveBeenCalledWith(provisional, [relay]);
    expect(result.cleanupFailures).toEqual([]);
  });

  it("deletes an intermediate announcement only from relays that ACKed that event", async () => {
    const relayOne = "wss://relay.one";
    const relayTwo = "wss://relay.two";
    const onDeleteEvent = vi.fn();
    let announcementCount = 0;
    const onPublishEvent = vi.fn(async (event: any, context?: { relays: string[] }) => {
      const relays = context?.relays || [];
      if (event.kind === 30617) announcementCount += 1;
      return {
        event: signedEvent(event, `${event.kind}-${event.created_at}-${announcementCount}`),
        relayOutcomes: relays.map((relay) => ({
          relay,
          status:
            event.kind === 30617 && announcementCount === 1 && relay === relayTwo
              ? "timeout"
              : "success",
          detail:
            event.kind === 30617 && announcementCount === 1 && relay === relayTwo
              ? "timed out"
              : "stored",
        })),
      };
    });

    await reconcileRepoCreationEvents({
      relayUrls: [relayOne, relayTwo],
      provisionalRelayUrls: [relayOne, relayTwo],
      stateEvent: createRepoStateEvent({ repoId: "repo" }),
      onPublishEvent,
      onDeleteEvent,
      buildAnnouncement: ({ relays, createdAt }) =>
        createRepoAnnouncementEvent({
          repoId: "repo",
          clone: ["https://github.com/alice/repo.git"],
          relays,
          created_at: createdAt,
        }),
    });

    expect(onDeleteEvent).toHaveBeenCalledTimes(1);
    expect(onDeleteEvent.mock.calls[0][1]).toEqual([relayOne]);
  });

  it("uses NIP-01 replacement ordering for equal-timestamp state events", async () => {
    const lowerId = "1".repeat(64);
    const higherId = "f".repeat(64);
    const makeState = (id: string) => ({
      ...signedEvent(createRepoStateEvent({ repoId: "repo" }), id),
      created_at: 100,
    });

    await expect(
      fetchLatestGraspRepoStateEvent({
        relayUrl: "wss://relay.ngit.dev",
        repoName: "repo",
        authorPubkey: "f".repeat(64),
        fetchRelayEvents: vi.fn().mockResolvedValue([makeState(higherId), makeState(lowerId)]),
      })
    ).resolves.toEqual(expect.objectContaining({ id: lowerId }));
  });

  it("rejects foreign-author state events returned outside the requested filter", async () => {
    const ownerPubkey = "a".repeat(64);
    const ownerState = {
      ...signedEvent(createRepoStateEvent({ repoId: "repo" }), "owner-state"),
      pubkey: ownerPubkey,
      created_at: 100,
    };
    const foreignState = {
      ...signedEvent(createRepoStateEvent({ repoId: "repo" }), "foreign-state"),
      pubkey: "b".repeat(64),
      created_at: 200,
    };

    await expect(
      fetchLatestGraspRepoStateEvent({
        relayUrl: "wss://relay.ngit.dev",
        repoName: "repo",
        authorPubkey: ownerPubkey,
        fetchRelayEvents: vi.fn().mockResolvedValue([foreignState, ownerState]),
      })
    ).resolves.toEqual(ownerState);
  });

  it("retries an already-signed event after a transient publish exception", async () => {
    const signed = signedEvent(
      createRepoStateEvent({
        repoId: "flotilla-budabit",
        refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
        head: "main",
      }),
      "exact-replay-id"
    );
    const onPublishEvent = vi
      .fn()
      .mockRejectedValueOnce(new Error("socket disconnected"))
      .mockResolvedValueOnce({
        event: signed,
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
      });

    await expect(
      publishGraspEventWithRetry({
        relayUrl: "wss://relay.ngit.dev",
        event: signed,
        onPublishEvent,
        publishRelays: ["wss://relay.ngit.dev"],
        retryDelayMs: 0,
      })
    ).resolves.toEqual(expect.objectContaining({ event: signed }));

    expect(onPublishEvent).toHaveBeenCalledTimes(2);
    expect(onPublishEvent.mock.calls[0][0]).toBe(signed);
    expect(onPublishEvent.mock.calls[1][0]).toBe(signed);
  });

  it("builds replacement state from existing refs instead of HEAD only", () => {
    const stateEvent = createGraspStateEventFromExistingState({
      repoId: "flotilla-budabit",
      currentState: {
        kind: 30618,
        created_at: 1_717_171_700,
        tags: [
          ["d", "flotilla-budabit"],
          ["refs/heads/main", "a".repeat(40)],
          ["refs/heads/dev", "b".repeat(40)],
          ["refs/tags/v1.0.0", "c".repeat(40)],
          ["HEAD", "ref: refs/heads/main"],
        ],
        content: "",
        pubkey: "f".repeat(64),
        id: "state-id",
        sig: "sig",
      },
      head: "dev",
      created_at: 1_717_171_800,
    } as any);

    expect(stateEvent?.tags).toEqual(
      expect.arrayContaining([
        ["d", "flotilla-budabit"],
        ["refs/heads/main", "a".repeat(40)],
        ["refs/heads/dev", "b".repeat(40)],
        ["refs/tags/v1.0.0", "c".repeat(40)],
        ["HEAD", "ref: refs/heads/dev"],
      ])
    );
  });

  it("skips replacement state when existing refs are unknown", () => {
    expect(
      createGraspStateEventFromExistingState({
        repoId: "flotilla-budabit",
        currentState: {
          kind: 30618,
          tags: [
            ["d", "flotilla-budabit"],
            ["HEAD", "ref: refs/heads/main"],
          ],
        } as any,
        head: "main",
      })
    ).toBeUndefined();
  });

  it("verifies post-push visibility by exact event ID on only the selected relay", async () => {
    const event = signedEvent(
      createRepoStateEvent({
        repoId: "flotilla-budabit",
        refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
        head: "main",
      }),
      "post-push-id"
    );
    const fetchRelayEvents = vi.fn().mockResolvedValue([event]);

    await expect(
      verifyGraspEventAfterPush({
        relayUrl: "https://relay.ngit.dev/path",
        event,
        fetchRelayEvents,
        visibilityTimeoutMs: 0,
        pollIntervalMs: 0,
      })
    ).resolves.toBe(event);

    expect(fetchRelayEvents).toHaveBeenCalledWith({
      relays: ["wss://relay.ngit.dev/path"],
      filters: [{ ids: ["post-push-id"] }],
      throwOnTimeout: true,
    });
  });

  it("does not replay an exact event after a completed absent readback", async () => {
    const event = signedEvent(
      createRepoStateEvent({
        repoId: "flotilla-budabit",
        refs: [{ type: "heads", name: "main", commit: "a".repeat(40) }],
        head: "main",
      }),
      "post-push-id"
    );
    const wrongCore = { ...event, tags: [...event.tags, ["relays", "wss://wrong"]] };
    const fetchRelayEvents = vi.fn().mockResolvedValue([wrongCore]);

    await expect(
      verifyGraspEventAfterPush({
        relayUrl: "wss://relay.ngit.dev",
        event,
        fetchRelayEvents,
        visibilityTimeoutMs: 0,
        pollIntervalMs: 0,
      })
    ).rejects.toThrow("was absent after completed post-push queries");

    expect(fetchRelayEvents).toHaveBeenCalledTimes(1);
  });

  it("distinguishes an inconclusive relay timeout from confirmed absence", async () => {
    const event = signedEvent(
      createRepoStateEvent({ repoId: "flotilla-budabit" }),
      "missing-post-push-id"
    );
    const fetchRelayEvents = vi.fn().mockRejectedValue(new Error("Relay query timed out"));

    await expect(
      verifyGraspEventAfterPush({
        relayUrl: "wss://relay.ngit.dev",
        event,
        fetchRelayEvents,
        visibilityTimeoutMs: 0,
        pollIntervalMs: 0,
      })
    ).rejects.toThrow("could not be verified on wss://relay.ngit.dev (Relay query timed out)");

    expect(fetchRelayEvents).toHaveBeenCalledTimes(1);
  });

  it("rejects publish when the selected relay does not ACK the state event", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      head: "dev",
      refs: [{ type: "heads", name: "dev", commit: "abc123def456" }],
    });

    const onPublishEvent = vi.fn().mockResolvedValue({
      event: signedEvent(stateEvent),
      ackedRelays: [],
      failedRelays: ["wss://relay.ngit.dev"],
      successCount: 0,
      hasRelayOutcomes: true,
      relayOutcomes: [{ relay: "wss://relay.ngit.dev", status: "timeout", detail: "timed out" }],
    });
    await expect(
      publishGraspRepoStateAndWait({
        relayUrl: "wss://relay.ngit.dev",
        stateEvent,
        onPublishEvent,
        maxAttempts: 1,
        retryDelayMs: 0,
      })
    ).rejects.toThrow(
      "attempt 1: selected relay wss://relay.ngit.dev returned timeout (timed out)"
    );
  });

  it("accepts a purgatory ACK without a pre-push visibility request", async () => {
    const stateEvent = createRepoStateEvent({
      repoId: "flotilla-budabit",
      head: "dev",
      refs: [{ type: "heads", name: "dev", commit: "abc123def456" }],
      created_at: 1_717_171_717,
    });

    const onPublishEvent = vi.fn(async (event) => ({
      event: signedEvent(event),
      ackedRelays: ["wss://relay.ngit.dev"],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
      message: "stored in purgatory",
      ok: true,
    }));
    const publishRelays = ["wss://relay.ngit.dev", "wss://relay.extra"];
    await expect(
      publishGraspRepoStateAndWait({
        relayUrl: "wss://relay.ngit.dev",
        stateEvent,
        onPublishEvent,
        publishRelays,
      })
    ).resolves.toEqual({
      ackedRelays: ["wss://relay.ngit.dev"],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
    });

    expect(onPublishEvent).toHaveBeenCalledWith(stateEvent, { relays: publishRelays });
  });

  it("builds and publishes branch state for GRASP push targets", async () => {
    const onPublishEvent = vi.fn(async (event) => ({
      event: signedEvent(event),
      ackedRelays: ["wss://relay.ngit.dev"],
      failedRelays: [],
      successCount: 1,
      hasRelayOutcomes: true,
    }));
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
      })
    ).resolves.toEqual({
      relayUrl: "wss://relay.ngit.dev",
      repoName: "flotilla-budabit",
      event: expect.objectContaining({ kind: 30618 }),
      publishRelays: ["wss://relay.ngit.dev"],
    });

    expect(onPublishEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 30618,
        tags: expect.arrayContaining([
          ["d", "flotilla-budabit"],
          ["refs/heads/dev", "feedbeef1234"],
          ["HEAD", "ref: refs/heads/dev"],
        ]),
      }),
      { relays: ["wss://relay.ngit.dev"] }
    );
  });

  it("refuses to publish an incomplete state when existing GRASP state is unavailable", async () => {
    const onPublishEvent = vi.fn();

    await expect(
      publishGraspRepoStateForPush({
        remoteUrl:
          "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git",
        branch: "dev",
        commitSha: "d".repeat(40),
        authorPubkey: "a".repeat(64),
        onPublishEvent,
        fetchRelayEvents: vi.fn().mockResolvedValue([]),
      })
    ).rejects.toThrow("Existing GRASP repository state is unavailable");

    expect(onPublishEvent).not.toHaveBeenCalled();
  });

  it("preserves existing refs and HEAD when publishing branch state for an existing GRASP target", async () => {
    let publishedState: any;
    const existingState = {
      id: "evt-existing",
      kind: 30618,
      pubkey: "a".repeat(64),
      created_at: Math.floor(Date.now() / 1000) + 100,
      tags: [
        ["d", "flotilla-budabit"],
        ["refs/heads/main", "a".repeat(40)],
        ["refs/heads/dev", "b".repeat(40)],
        ["refs/tags/v1.0.0", "c".repeat(40)],
        ["HEAD", "ref: refs/heads/main"],
      ],
      content: "",
      sig: "sig",
    };

    const onPublishEvent = vi.fn(async (event) => {
      publishedState = event;
      return {
        event: signedEvent(event),
        ackedRelays: ["wss://relay.ngit.dev"],
        failedRelays: [],
        successCount: 1,
        hasRelayOutcomes: true,
      };
    });
    const fetchRelayEvents = vi.fn(async () => [publishedState || existingState]);

    await expect(
      publishGraspRepoStateForPush({
        remoteUrl:
          "https://relay.ngit.dev/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/flotilla-budabit.git",
        branch: "dev",
        commitSha: "d".repeat(40),
        authorPubkey: "a".repeat(64),
        onPublishEvent,
        fetchRelayEvents,
      })
    ).resolves.toEqual({
      relayUrl: "wss://relay.ngit.dev",
      repoName: "flotilla-budabit",
      event: expect.objectContaining({ kind: 30618 }),
      publishRelays: ["wss://relay.ngit.dev"],
    });

    expect(publishedState.tags).toEqual(
      expect.arrayContaining([
        ["d", "flotilla-budabit"],
        ["refs/heads/main", "a".repeat(40)],
        ["refs/heads/dev", "d".repeat(40)],
        ["refs/tags/v1.0.0", "c".repeat(40)],
        ["HEAD", "ref: refs/heads/main"],
      ])
    );
    expect(publishedState.created_at).toBe(existingState.created_at + 1);
  });

  it("requires receive-pack readiness and does not delay after the final failed attempt", async () => {
    graspAvailabilityMocks.checkGraspRepoExists.mockReset();
    graspAvailabilityMocks.checkGraspReceivePackReady.mockReset();
    graspAvailabilityMocks.checkGraspRepoExists.mockResolvedValue({ exists: true });
    graspAvailabilityMocks.checkGraspReceivePackReady.mockResolvedValue(false);
    vi.useFakeTimers();

    try {
      await expect(
        waitForGraspProvisioning({
          relayUrl: "wss://relay.ngit.dev",
          userPubkey: "f".repeat(64),
          owner: "f".repeat(64),
          repoName: "flotilla-budabit",
          maxAttempts: 1,
          delayMs: 1000,
        })
      ).rejects.toThrow("did not provision read/write git endpoints in time");

      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("returns when receive-pack is ready even if upload-pack is not", async () => {
    graspAvailabilityMocks.checkGraspRepoExists.mockReset();
    graspAvailabilityMocks.checkGraspReceivePackReady.mockReset();
    graspAvailabilityMocks.checkGraspRepoExists.mockResolvedValue({ exists: false });
    graspAvailabilityMocks.checkGraspReceivePackReady.mockResolvedValue(true);

    await expect(
      waitForGraspProvisioning({
        relayUrl: "wss://relay.ngit.dev",
        userPubkey: "f".repeat(64),
        owner: "f".repeat(64),
        repoName: "flotilla-budabit",
        maxAttempts: 1,
      })
    ).resolves.toBeUndefined();
  });
});
