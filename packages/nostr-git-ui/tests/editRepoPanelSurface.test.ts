import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("repository settings feedback surface", () => {
  const packageRoot = process.cwd().endsWith("packages/nostr-git-ui")
    ? process.cwd()
    : resolve(process.cwd(), "packages/nostr-git-ui");
  const workspaceRoot = resolve(packageRoot, "../..");

  const readPackageSource = (path: string) => readFile(resolve(packageRoot, path), "utf8");
  const readWorkspaceSource = (path: string) => readFile(resolve(workspaceRoot, path), "utf8");

  it("keeps declared relays separate from automatically derived GRASP relays", async () => {
    const panel = await readPackageSource("src/lib/components/git/EditRepoPanel.svelte");

    expect(panel).toContain(
      "getRepoSettingsRelayState(copyList(repo.relays), editableCloneUrls).declaredRelays"
    );
    expect(panel).toContain("{#each automaticGraspRelays as relayUrl}");
    expect(panel).toContain("readonly={isMandatoryGraspRelay(relay)}");
    expect(panel).toContain('errors.relays = "At least one repository relay is required"');
  });

  it("renders progress and persistent success, warning, and error feedback", async () => {
    const panel = await readPackageSource("src/lib/components/git/EditRepoPanel.svelte");

    expect(panel).toContain("Publishing repository announcement...");
    expect(panel).toContain("Publishing repository state...");
    expect(panel).toContain("Settings Saved With Warnings");
    expect(panel).toContain("Retry delivery");
    expect(panel).toContain("Update Failed");
    expect(panel).toContain("Try again");
  });

  it("returns relay ACK evidence from both settings entry points", async () => {
    const layout = await readWorkspaceSource("src/routes/git/[id=naddr]/+layout.svelte");

    expect(layout.match(/return publishRepoSettingsEventWithOutcomes\(/g)).toHaveLength(2);
    expect(layout).toContain("context?.relays?.length");
    expect(layout).toContain("context?.additionalRelays");
    expect(layout).toContain("publishLocally: false");
  });
});
