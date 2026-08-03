import { nip19 } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  assertGraspCloneRelayCoupling,
  buildGraspServiceDescriptors,
  getGraspRelayUrlsBackedByCloneUrls,
  getUnbackedGraspCloneRelayUrls,
  getUnbackedKnownGraspRelayUrls,
  mergeGraspServiceDescriptors,
  resolveKnownGraspServices,
} from "./grasp-service-coupling.js";

afterEach(() => vi.unstubAllGlobals());

describe("GRASP service coupling", () => {
  it("merges personal and community evidence without classifying ordinary relays", () => {
    expect(
      mergeGraspServiceDescriptors([
        ...buildGraspServiceDescriptors(["wss://grasp.example/"], "user-10317"),
        ...buildGraspServiceDescriptors(["wss://grasp.example"], "community-10222"),
      ])
    ).toEqual([
      {
        relayUrl: "wss://grasp.example",
        httpBaseAliases: ["https://grasp.example"],
        sources: ["user-10317", "community-10222"],
      },
    ]);
  });

  it("flags known GRASP relays that have no selected target", () => {
    const services = buildGraspServiceDescriptors(["wss://grasp.example"], "community-10222");
    expect(
      getUnbackedKnownGraspRelayUrls({
        repoRelayUrls: ["wss://relay.example", "wss://grasp.example"],
        backedGraspRelayUrls: [],
        knownServices: services,
      })
    ).toEqual(["wss://grasp.example"]);
    expect(
      getUnbackedKnownGraspRelayUrls({
        repoRelayUrls: ["wss://grasp.example"],
        backedGraspRelayUrls: ["https://grasp.example"],
        knownServices: services,
      })
    ).toEqual([]);
  });

  it("enriches explicit community evidence with NIP-11 Smart HTTP aliases", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes("events.community.example")
            ? {
                supported_grasps: ["GRASP-01"],
                smart_http: "https://git.community.example",
              }
            : { supported_grasps: [] },
      }))
    );

    await expect(
      resolveKnownGraspServices({
        relayUrls: ["wss://git.community.example"],
        knownServices: buildGraspServiceDescriptors(
          ["wss://events.community.example"],
          "community-10222"
        ),
        enrichKnownServices: true,
      })
    ).resolves.toEqual([
      {
        relayUrl: "wss://events.community.example",
        httpBaseAliases: [
          "https://events.community.example",
          "https://git.community.example",
          "https://events.community.example/git",
        ],
        sources: ["community-10222", "nip11"],
      },
    ]);
  });

  it("ignores malformed NIP-11 aliases without rejecting capability resolution", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          supported_grasps: ["GRASP-01"],
          smart_http: 42,
        }),
      })
    );

    await expect(
      resolveKnownGraspServices({
        relayUrls: ["wss://malformed.example"],
      })
    ).resolves.toEqual([
      {
        relayUrl: "wss://malformed.example",
        httpBaseAliases: ["https://malformed.example", "https://malformed.example/git"],
        sources: ["nip11"],
      },
    ]);
  });

  it("requires an exact destination clone for a known GRASP relay", () => {
    const ownerPubkey = "a".repeat(64);
    const ownerNpub = nip19.npubEncode(ownerPubkey);
    const services = buildGraspServiceDescriptors(["wss://grasp.example/git"], "user-10317");
    const cloneUrl = `https://grasp.example/git/${ownerNpub}/repo.git`;

    expect(
      getUnbackedGraspCloneRelayUrls({
        repoRelayUrls: ["wss://grasp.example/git"],
        cloneUrls: [cloneUrl],
        knownServices: services,
        ownerPubkey,
        identifier: "repo",
      })
    ).toEqual([]);
    expect(
      getUnbackedGraspCloneRelayUrls({
        repoRelayUrls: ["wss://grasp.example/git"],
        cloneUrls: [cloneUrl],
        knownServices: services,
        ownerPubkey,
        identifier: "other",
      })
    ).toEqual(["wss://grasp.example/git"]);
  });

  it("rejects an exact GRASP clone without its matching relay", () => {
    const ownerPubkey = "a".repeat(64);
    const ownerNpub = nip19.npubEncode(ownerPubkey);
    expect(() =>
      assertGraspCloneRelayCoupling({
        repoRelayUrls: ["wss://ordinary.example"],
        cloneUrls: [`https://grasp.example/${ownerNpub}/repo.git`],
        knownServices: [],
        ownerPubkey,
        identifier: "repo",
      })
    ).toThrow("matching GRASP repository relay");
  });

  it("allows only authoritative source clones to remain without their legacy relay", () => {
    const ownerPubkey = "a".repeat(64);
    const ownerNpub = nip19.npubEncode(ownerPubkey);
    const sourceCloneUrl = `https://legacy.example/${ownerNpub}/repo.git`;
    const unexpectedCloneUrl = `https://unexpected.example/${ownerNpub}/repo.git`;
    const params = {
      repoRelayUrls: ["wss://selected.example"],
      cloneUrls: [sourceCloneUrl],
      knownServices: [],
      ownerPubkey,
      identifier: "repo",
    };

    expect(() =>
      assertGraspCloneRelayCoupling({
        ...params,
        allowedUnlistedCloneUrls: [
          sourceCloneUrl.replace("https://legacy.example", "HTTPS://LEGACY.EXAMPLE:443") +
            "#source",
        ],
      })
    ).not.toThrow();
    expect(() =>
      assertGraspCloneRelayCoupling({
        ...params,
        cloneUrls: [sourceCloneUrl, unexpectedCloneUrl],
        allowedUnlistedCloneUrls: [sourceCloneUrl],
      })
    ).toThrow(unexpectedCloneUrl);
  });

  it("recognizes an exact source clone as backing its advertised repository relay", () => {
    const ownerPubkey = "a".repeat(64);
    const ownerNpub = nip19.npubEncode(ownerPubkey);
    const cloneUrl = `https://grasp.example/${ownerNpub}/repo.git`;

    expect(
      getGraspRelayUrlsBackedByCloneUrls({
        repoRelayUrls: ["wss://grasp.example", "wss://other.example"],
        cloneUrls: [cloneUrl],
        knownServices: buildGraspServiceDescriptors(
          ["wss://grasp.example", "wss://other.example"],
          "selected-target"
        ),
        ownerPubkey,
        identifier: "repo",
      })
    ).toEqual(["wss://grasp.example"]);

    const splitHostCloneUrl = `https://git.example/${ownerNpub}/repo.git`;
    expect(
      getGraspRelayUrlsBackedByCloneUrls({
        repoRelayUrls: ["wss://events.example"],
        cloneUrls: [splitHostCloneUrl],
        knownServices: [
          {
            relayUrl: "wss://events.example",
            httpBaseAliases: ["https://git.example"],
            sources: ["nip11"],
          },
        ],
        ownerPubkey,
        identifier: "repo",
      })
    ).toEqual(["wss://events.example"]);
  });
});
