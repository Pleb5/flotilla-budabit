import { describe, expect, it, vi } from "vitest";

import {
  assertRepoCoordinateAvailable,
  assertRepoCreationPrerequisites,
} from "./repo-creation-preflight.js";

const target = { id: "git:github.com", label: "GitHub", provider: "github" as const };

describe("repository creation preflight", () => {
  it("requires metadata capabilities before mutation", () => {
    const base = {
      ownerPubkey: "a".repeat(64),
      repoName: "repo",
      targets: [target],
      relayUrls: ["wss://relay.example"],
      onPublishEvent: vi.fn(),
      onFetchRelayEvents: vi.fn(),
      onDeleteEvent: vi.fn(),
    };

    expect(assertRepoCreationPrerequisites(base)).toEqual(["wss://relay.example"]);
    expect(() => assertRepoCreationPrerequisites({ ...base, relayUrls: [] })).toThrow(
      "metadata relay"
    );
    expect(() => assertRepoCreationPrerequisites({ ...base, onPublishEvent: undefined })).toThrow(
      "metadata publication"
    );
    expect(() =>
      assertRepoCreationPrerequisites({ ...base, onFetchRelayEvents: undefined })
    ).toThrow("per-relay metadata reads");
    expect(() => assertRepoCreationPrerequisites({ ...base, onDeleteEvent: undefined })).toThrow(
      "metadata compensation"
    );
  });

  it("checks every relay independently and fails on an existing coordinate", async () => {
    const onFetchRelayEvents = vi.fn(async ({ relays }: { relays: string[] }) =>
      relays[0] === "wss://second.example"
        ? [
            {
              id: "event",
              sig: "sig",
              kind: 30617,
              pubkey: "a".repeat(64),
              created_at: 1,
              content: "",
              tags: [["d", "repo"]],
            },
          ]
        : []
    );

    await expect(
      assertRepoCoordinateAvailable({
        ownerPubkey: "a".repeat(64),
        repoName: "repo",
        relayUrls: ["wss://first.example", "wss://second.example"],
        onFetchRelayEvents,
      })
    ).rejects.toThrow("already exists on wss://second.example");
    expect(onFetchRelayEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ relays: ["wss://first.example"], throwOnTimeout: true })
    );
    expect(onFetchRelayEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ relays: ["wss://second.example"], throwOnTimeout: true })
    );
  });

  it("fails closed when a relay read is incomplete", async () => {
    await expect(
      assertRepoCoordinateAvailable({
        ownerPubkey: "a".repeat(64),
        repoName: "repo",
        relayUrls: ["wss://relay.example"],
        onFetchRelayEvents: vi.fn().mockRejectedValue(new Error("Relay query timed out")),
      })
    ).rejects.toThrow("Could not verify repository coordinate availability");
  });
});
