import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("Repo dark theme surfaces", () => {
  const packageRoot = process.cwd().endsWith("packages/nostr-git-ui")
    ? process.cwd()
    : resolve(process.cwd(), "packages/nostr-git-ui");
  const workspaceRoot = resolve(packageRoot, "../..");

  const readPackageSource = (path: string) => readFile(resolve(packageRoot, path), "utf8");
  const readWorkspaceSource = (path: string) => readFile(resolve(workspaceRoot, path), "utf8");

  it("pairs repo event and conflict light surfaces with dark variants", async () => {
    const repoState = await readPackageSource(
      "src/lib/components/events/GitRepoStateComponent.svelte"
    );
    const unknownEvent = await readPackageSource(
      "src/lib/components/events/UnknownEventComponent.svelte"
    );
    const conflictVisualizer = await readPackageSource(
      "src/lib/components/git/ConflictVisualizer.svelte"
    );

    expect(repoState).toContain("bg-green-50");
    expect(repoState).toContain("dark:bg-green-950/30");
    expect(unknownEvent).toContain("bg-yellow-50");
    expect(unknownEvent).toContain("dark:bg-yellow-950/30");
    expect(conflictVisualizer).toContain("dark:bg-red-950/30");
    expect(conflictVisualizer).toContain("dark:bg-orange-950/30");
    expect(conflictVisualizer).toContain("dark:bg-yellow-950/30");
  });

  it("pairs repo badge palettes with dark variants", async () => {
    const authStatus = await readPackageSource(
      "src/lib/components/git/AuthStatusIndicator.svelte"
    );
    const commitSelector = await readPackageSource("src/lib/components/git/CommitSelector.svelte");
    const repoAlertBadge = await readPackageSource("src/lib/components/git/RepoAlertBadge.svelte");
    const maintainerBadge = await readPackageSource("src/lib/components/git/MaintainerBadge.svelte");

    for (const source of [authStatus, commitSelector, repoAlertBadge, maintainerBadge]) {
      expect(source).toContain("dark:bg-");
      expect(source).toContain("dark:text-");
    }

    expect(authStatus).not.toContain('bgColor: "bg-gray-100"');
    expect(commitSelector).not.toContain('return "bg-green-100 text-green-800 border-green-200"');
    expect(repoAlertBadge).not.toContain('class="bg-amber-100 text-amber-800 border-amber-200"');
    expect(maintainerBadge).not.toContain('"bg-purple-50 text-purple-700 border-purple-200"');
  });

  it("keeps route-level repo alerts and extension surfaces dark safe", async () => {
    const commitsPage = await readWorkspaceSource(
      "src/routes/git/[id=naddr]/commits/+page.svelte"
    );
    const testPage = await readWorkspaceSource("src/routes/git/[id=naddr]/test/+page.svelte");
    const extensionPage = await readWorkspaceSource(
      "src/routes/git/[id=naddr]/extensions/[extId]/+page.svelte"
    );

    expect(commitsPage).toContain("dark:bg-red-900/50");
    expect(testPage).toContain("dark:bg-purple-950/30");
    expect(testPage).toContain("dark:bg-blue-950/30");
    expect(extensionPage).toContain("hsl(var(--ng-card");
    expect(extensionPage).toContain("hsl(var(--ng-destructive");
    expect(extensionPage).not.toContain("#991b1b");
    expect(extensionPage).not.toContain("var(--card, #fff)");
  });

  it("avoids dim gray-500 captions on dark modal surfaces", async () => {
    const importDialog = await readPackageSource("src/lib/components/git/ImportRepoDialog.svelte");
    const forkDialog = await readPackageSource("src/lib/components/git/ForkRepoDialog.svelte");
    const editPanel = await readPackageSource("src/lib/components/git/EditRepoPanel.svelte");
    const advancedStep = await readPackageSource("src/lib/components/git/AdvancedSettingsStep.svelte");

    for (const source of [importDialog, forkDialog, editPanel, advancedStep]) {
      expect(source).not.toContain("text-gray-500");
    }
  });
});
