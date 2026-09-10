import { describe, expect, it, vi } from "vitest";

import {
  assertRepoCoordinateAvailable,
  reserveRepoCreation,
  assertRepoCreationPrerequisites,
} from "./repo-creation-preflight.js";
import type { RepoCreationRecoveryRecord } from "./repo-creation-transaction.js";

const target = { id: "git:github.com", label: "GitHub", provider: "github" as const };

describe("repository creation preflight", () => {
  it("checks locally accepted metadata without treating the cache as per-relay readback evidence", async () => {
    const fetch = vi.fn().mockResolvedValue([]);
    await expect(
      assertRepoCoordinateAvailable({
        ownerPubkey: "a",
        repoName: "repo",
        relayUrls: ["wss://relay.test"],
        onFetchRelayEvents: fetch,
        knownEvents: [{ pubkey: "a", kind: 30617, tags: [["d", "repo"]] }],
      })
    ).rejects.toThrow(/already have/);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks state-only creations but not another owner or differently cased identifier", async () => {
    const owner = "a".repeat(64);
    const params = { ownerPubkey: owner, repoName: "repo", relayUrls: ["wss://relay.example"] };
    const state = { kind: 30618, pubkey: owner, tags: [["d", "repo"]] };
    await expect(
      assertRepoCoordinateAvailable({
        ...params,
        onFetchRelayEvents: vi.fn().mockResolvedValue([state]),
      })
    ).rejects.toThrow(/already have/);
    const fetchEvents = vi.fn().mockResolvedValue([
      { ...state, pubkey: "b".repeat(64) },
      { ...state, tags: [["d", "Repo"]] },
    ]);
    await expect(
      assertRepoCoordinateAvailable({ ...params, onFetchRelayEvents: fetchEvents })
    ).resolves.toBeUndefined();
    expect(fetchEvents).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: [{ kinds: [30617, 30618], authors: [owner], "#d": ["repo"] }],
      })
    );
  });

  it("rejects simultaneous creates at the same coordinate, not another owner's identifier", () => {
    const release = reserveRepoCreation("alice", "repo");
    try {
      expect(() => reserveRepoCreation("alice", "repo")).toThrow(/already in progress/);
      reserveRepoCreation("bob", "repo")();
    } finally {
      release();
    }
    reserveRepoCreation("alice", "repo")();
  });

  it("requires unresolved matching creation journals to be recovered instead of silently reused", () => {
    const record = {
      ownerPubkey: "alice",
      repoName: "repo",
      phase: "metadata-pending",
      manualAttention: { required: false },
      pendingCompensations: [],
      localResource: { stage: "cleaned" },
      publishedEvents: [],
    } as unknown as RepoCreationRecoveryRecord;
    expect(() => reserveRepoCreation("alice", "repo", [record])).toThrow(/recovery/);
    reserveRepoCreation("bob", "repo", [record])();
    reserveRepoCreation("alice", "another-id", [record])();
    reserveRepoCreation("alice", "repo", [{ ...record, phase: "failed" }])();
  });
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

    expect(assertRepoCreationPrerequisites(base)).toEqual(["wss://relay.example/"]);
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
      relays[0] === "wss://second.example/"
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
    ).rejects.toThrow(
      'You already have a repository with identifier "repo" on wss://second.example'
    );
    expect(onFetchRelayEvents).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ relays: ["wss://first.example/"], throwOnTimeout: true })
    );
    expect(onFetchRelayEvents).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ relays: ["wss://second.example/"], throwOnTimeout: true })
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
