import { afterEach, describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";
import { getRepoStorageKey } from "@nostr-git/core/git";
import { useForkRepo } from "./useForkRepo.svelte";

vi.mock("$lib/stores/tokens", () => ({
  tokens: {
    subscribe: (callback: (tokens: unknown[]) => void) => {
      callback([]);
      return () => {};
    },
    waitForInitialization: async () => [],
  },
}));
vi.mock("../utils/remote-targets.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/remote-targets.js")>()),
  preflightNewRemoteTargets: async ({ targets }: { targets: unknown[] }) => targets,
}));

afterEach(() => vi.unstubAllGlobals());

describe("fork local collision integration", () => {
  it.each(["github", "grasp"] as const)(
    "checks an old GRASP clone before publishing or cloning to %s",
    async (provider) => {
      vi.stubGlobal(
        "$state",
        Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T) => value })
      );
      vi.stubGlobal("localStorage", { getItem: () => null });
      const owner = "a".repeat(64);
      const identifier = "destination";
      const existingKey = getRepoStorageKey({
        pubkey: owner,
        tags: [
          ["d", identifier],
          ["name", "Some previous display"],
          ["clone", `https://previous-host.test/${nip19.npubEncode(owner)}/${identifier}.git`],
        ],
      });
      const worker = {
        isRepoCloned: vi.fn(async ({ repoId }) => repoId === existingKey),
        clone: vi.fn(),
        cloneRepo: vi.fn(),
        deleteRepo: vi.fn(),
      };
      const onPublishEvent = vi.fn();
      const onDeleteEvent = vi.fn();
      const onFetchRelayEvents = vi.fn().mockResolvedValue([]);
      const fork = useForkRepo({
        userPubkey: owner,
        workerApi: worker,
        onPublishEvent,
        onDeleteEvent,
        onFetchRelayEvents,
        getKnownRepoEvents: () => [],
      });
      const result = await fork.forkRepository(
        {
          owner: "source-owner",
          name: "source-id",
          cloneUrls: ["https://github.com/fixture/source-id.git"],
        },
        {
          forkName: identifier,
          displayName: "My fork",
          relays: ["wss://metadata.test/"],
          targets: [
            {
              id: "target",
              label: "Target",
              provider,
              ...(provider === "grasp"
                ? { relayUrl: "wss://new-host.test/" }
                : { host: "github.com" }),
            },
          ],
        }
      );
      expect(result).toBeNull();
      expect(fork.error).toMatch(/local repository already exists/);
      expect(worker.isRepoCloned).toHaveBeenCalledWith({ repoId: existingKey });
      expect(onFetchRelayEvents).toHaveBeenCalled();
      expect(onPublishEvent).not.toHaveBeenCalled();
      expect(onDeleteEvent).not.toHaveBeenCalled();
      expect(worker.clone).not.toHaveBeenCalled();
      expect(worker.cloneRepo).not.toHaveBeenCalled();
      expect(worker.deleteRepo).not.toHaveBeenCalled();
    }
  );
});
