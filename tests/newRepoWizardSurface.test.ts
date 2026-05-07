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

  it("keeps import and fork CTA text visible in light themed modals", async () => {
    const importDialog = await readPackageSource("src/lib/components/git/ImportRepoDialog.svelte");
    const forkDialog = await readPackageSource("src/lib/components/git/ForkRepoDialog.svelte");

    expect(importDialog).toContain("bg-blue-600 !text-white");
    expect(importDialog).toContain("bg-red-600 !text-white");
    expect(importDialog).not.toContain("bg-blue-600 text-white");
    expect(importDialog).not.toContain("bg-red-600 text-white");

    expect(forkDialog).toContain("bg-blue-600 hover:bg-blue-700 !text-white");
    expect(forkDialog).not.toContain("bg-blue-600 hover:bg-blue-700 text-white");
  });
});
