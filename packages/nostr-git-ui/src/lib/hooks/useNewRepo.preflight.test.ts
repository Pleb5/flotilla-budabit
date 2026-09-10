import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nip19 } from "nostr-tools";
import { getRepoStorageKey } from "@nostr-git/core/git";
import { useNewRepo } from "./useNewRepo.svelte";

vi.mock("../stores/tokens.js", () => ({
  tokens: {
    subscribe: (callback: (tokens: unknown[]) => void) => {
      callback([]);
      return () => {};
    },
    waitForInitialization: async () => [],
    refresh: async () => {},
  },
}));
vi.mock("../utils/remote-targets.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils/remote-targets.js")>()),
  preflightNewRemoteTargets: async ({ targets }: { targets: unknown[] }) => targets,
}));

beforeEach(() => {
  vi.stubGlobal(
    "$state",
    Object.assign(<T>(value: T) => value, { snapshot: <T>(value: T) => value })
  );
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index],
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});
afterEach(() => vi.unstubAllGlobals());

describe("New Repo local collision integration", () => {
  it.each(["github", "grasp"] as const)(
    "rejects a clone from the other hosting convention before creating on %s",
    async (provider) => {
      const owner = "a".repeat(64);
      const identifier = "repository";
      const existingKey = getRepoStorageKey({
        pubkey: owner,
        tags: [
          ["d", identifier],
          ["name", "Old display"],
          [
            "clone",
            provider === "github"
              ? `https://old-grasp.test/${nip19.npubEncode(owner)}/${identifier}.git`
              : `https://github.com/fixture/${identifier}.git`,
          ],
        ],
      });
      const worker = {
        isRepoCloned: vi.fn(async ({ repoId }) => repoId === existingKey),
        initRepo: vi.fn(),
        createRemoteRepo: vi.fn(),
        pushToRemote: vi.fn(),
        deleteRepo: vi.fn(),
      };
      const onPublishEvent = vi.fn();
      const onDeleteEvent = vi.fn();
      const onFetchRelayEvents = vi.fn().mockResolvedValue([]);
      const hook = useNewRepo({
        userPubkey: owner,
        workerApi: worker,
        onPublishEvent,
        onDeleteEvent,
        onFetchRelayEvents,
        getKnownRepoEvents: () => [],
      });
      const result = await hook.createRepository({
        name: identifier,
        displayName: "New display",
        authorPubkey: owner,
        provider,
        relays: ["wss://metadata.test/"],
        ...(provider === "grasp" ? { relayUrl: "wss://new-grasp.test/" } : {}),
      });
      expect(result).toBeNull();
      expect(hook.error()).toMatch(/local repository already exists/);
      expect(worker.isRepoCloned).toHaveBeenCalledWith({ repoId: existingKey });
      expect(onFetchRelayEvents).toHaveBeenCalled();
      expect(onPublishEvent).not.toHaveBeenCalled();
      expect(onDeleteEvent).not.toHaveBeenCalled();
      for (const mutation of [
        worker.initRepo,
        worker.createRemoteRepo,
        worker.pushToRemote,
        worker.deleteRepo,
      ])
        expect(mutation).not.toHaveBeenCalled();
    }
  );
});
