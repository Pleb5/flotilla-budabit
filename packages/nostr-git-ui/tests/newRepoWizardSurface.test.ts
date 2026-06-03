import {readFile} from "node:fs/promises";
import {resolve} from "node:path";

import {describe, expect, it} from "vitest";

describe("NewRepoWizard modal surface", () => {
  const readPackageSource = async (path: string) => {
    const packageRoot = process.cwd().endsWith("packages/nostr-git-ui")
      ? process.cwd()
      : resolve(process.cwd(), "packages/nostr-git-ui");

    return readFile(resolve(packageRoot, path), "utf8");
  };

  it("uses an opaque card surface instead of the page background utility", async () => {
    const source = await readPackageSource("src/lib/components/git/NewRepoWizard.svelte");

    expect(source).toContain('class="ng-themed-modal bg-card text-card-foreground');
    expect(source).toContain('border-t border-border bg-card');
    expect(source).not.toContain('class="ng-themed-modal bg-background');
  });

  it("does not mix package buttons with host DaisyUI button colors", async () => {
    const source = await readPackageSource("src/lib/components/git/NewRepoWizard.svelte");

    expect(source).not.toContain('class="btn btn-secondary"');
    expect(source).not.toContain('class="btn btn-primary"');
    expect(source).toContain("bg-card text-foreground hover:bg-muted hover:text-foreground");
  });

  it("keeps GRASP relay chips readable on dark cards", async () => {
    const source = await readPackageSource("src/lib/components/git/ProviderSelectionStep.svelte");

    expect(source).toContain("bg-accent/15 text-accent border border-accent/40 dark:bg-accent/20");
    expect(source).toContain("text-foreground placeholder:text-muted-foreground");
    expect(source).toContain("text-red-700 dark:text-red-300");
    expect(source).not.toContain("bg-accent/20 text-accent-foreground");
  });

  it("keeps import and fork CTA text visible in light themed modals", async () => {
    const importDialog = await readPackageSource("src/lib/components/git/ImportRepoDialog.svelte");
    const forkDialog = await readPackageSource("src/lib/components/git/ForkRepoDialog.svelte");
    const editPanel = await readPackageSource("src/lib/components/git/EditRepoPanel.svelte");
    const progressStep = await readPackageSource("src/lib/components/git/RepoProgressStep.svelte");

    expect(importDialog).toContain("bg-blue-600 !text-white");
    expect(importDialog).toContain("bg-red-600 !text-white");
    expect(importDialog).not.toContain("bg-blue-600 text-white");
    expect(importDialog).not.toContain("bg-red-600 text-white");

    expect(forkDialog).toContain("bg-blue-600 hover:bg-blue-700 !text-white");
    expect(forkDialog).not.toContain("bg-blue-600 hover:bg-blue-700 text-white");

    expect(editPanel).toContain("bg-blue-600 hover:bg-blue-700 !text-white");
    expect(editPanel).toContain("bg-red-600 px-3 py-2 !text-white");
    expect(progressStep).toContain("font-medium !text-white bg-blue-600");
    expect(progressStep).toContain("font-medium !text-white bg-green-600");
  });

  it("keeps modal alert surfaces readable in light and dark themes", async () => {
    const importDialog = await readPackageSource("src/lib/components/git/ImportRepoDialog.svelte");
    const forkDialog = await readPackageSource("src/lib/components/git/ForkRepoDialog.svelte");
    const editPanel = await readPackageSource("src/lib/components/git/EditRepoPanel.svelte");

    for (const source of [importDialog, forkDialog, editPanel]) {
      expect(source).toContain("bg-red-50");
      expect(source).toContain("dark:bg-red-900/50");
      expect(source).not.toContain('class="bg-red-900/50');
    }

    expect(importDialog).toContain("bg-green-50");
    expect(importDialog).toContain("dark:bg-green-900/50");
    expect(forkDialog).toContain("bg-amber-50");
    expect(forkDialog).toContain("dark:bg-amber-900/40");
  });

  it("keeps colored modal controls readable in light and dark themes", async () => {
    const importDialog = await readPackageSource("src/lib/components/git/ImportRepoDialog.svelte");
    const forkDialog = await readPackageSource("src/lib/components/git/ForkRepoDialog.svelte");
    const editPanel = await readPackageSource("src/lib/components/git/EditRepoPanel.svelte");
    const progressStep = await readPackageSource("src/lib/components/git/RepoProgressStep.svelte");

    for (const source of [importDialog, forkDialog, editPanel]) {
      expect(source).not.toContain("text-blue-400 hover:text-blue-300");
      expect(source).not.toContain("text-red-400 hover:text-red-300");
      expect(source).not.toContain('class="text-red-400 text-sm mt-1');
      expect(source).not.toContain('class="mt-1 text-sm text-red-400');
      expect(source).toContain(
        "text-blue-700 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
      );
    }

    expect(progressStep).toContain("text-red-600 dark:text-red-400");
    expect(progressStep).toContain("text-green-600 dark:text-green-400");
    expect(editPanel).toContain("text-yellow-700 dark:text-yellow-400");
  });

  it("renders fork Nostr owners separately from repository path suffixes", async () => {
    const forkDialog = await readPackageSource("src/lib/components/git/ForkRepoDialog.svelte");

    expect(forkDialog).toContain("content={ownerDisplayOwner}");
    expect(forkDialog).toContain("/{ownerDisplayName}");
    expect(forkDialog).toContain("content={forkOwnerDisplayOwner}");
    expect(forkDialog).toContain("/{forkOwnerDisplayName}");
    expect(forkDialog).not.toContain("content={ownerDisplay}");
    expect(forkDialog).not.toContain("content={forkOwnerDisplay}");
  });
});
