import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("repository admission ordering", () => {
  const packageRoot = process.cwd().endsWith("packages/nostr-git-ui")
    ? process.cwd()
    : resolve(process.cwd(), "packages/nostr-git-ui");
  const readSource = (path: string) => readFile(resolve(packageRoot, path), "utf8");

  it("admits new repository metadata before local creation", async () => {
    const source = await readSource("src/lib/hooks/useNewRepo.svelte.ts");
    const admission = source.indexOf("await publishRepoSyncAnnouncement({");
    const localCreate = source.indexOf("const localRepo = await createLocalRepo");

    expect(admission).toBeGreaterThan(0);
    expect(localCreate).toBeGreaterThan(admission);
    expect(source).toContain("prepublishedAnnouncement: announcementAdmission.announcementEvent");
    expect(source).toContain("preprovisionedGraspRelayUrls: announcementAdmission.graspRelayUrls");
    expect(source).toContain("graspFirst: true");
  });

  it("admits fork metadata before source clone", async () => {
    const source = await readSource("src/lib/hooks/useForkRepo.svelte.ts");
    const admission = source.indexOf("await publishRepoSyncAnnouncement({");
    const clone = source.indexOf("gitWorkerApi.cloneRemoteRepo({");

    expect(admission).toBeGreaterThan(0);
    expect(clone).toBeGreaterThan(admission);
    expect(source).toContain("prepublishedAnnouncement: announcementAdmission.announcementEvent");
    expect(source).toContain("preprovisionedGraspRelayUrls: announcementAdmission.graspRelayUrls");
    expect(source).toContain("graspFirst: true");
  });

  it("keeps rollback event-specific and defaults synchronization to GRASP-first", async () => {
    const importHook = await readSource("src/lib/hooks/useImportRepo.svelte.ts");
    const forkHook = await readSource("src/lib/hooks/useForkRepo.svelte.ts");
    const remoteSync = await readSource("src/lib/utils/remote-sync.ts");

    expect(importHook).toContain("relays: item.relayUrls");
    expect(importHook).toContain("events: [item.event]");
    expect(forkHook).toContain("await options.onDeleteEvent(item.event, item.relayUrls)");
    expect(remoteSync).toContain("graspFirst = true");
  });
});
