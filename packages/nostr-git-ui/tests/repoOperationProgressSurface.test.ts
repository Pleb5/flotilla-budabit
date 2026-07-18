import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("repository operation progress integration", () => {
  const packageRoot = process.cwd().endsWith("packages/nostr-git-ui")
    ? process.cwd()
    : resolve(process.cwd(), "packages/nostr-git-ui");
  const readSource = (path: string) => readFile(resolve(packageRoot, path), "utf8");

  it("correlates and unsubscribes import, new, and fork worker progress", async () => {
    const hooks = await Promise.all([
      readSource("src/lib/hooks/useImportRepo.svelte.ts"),
      readSource("src/lib/hooks/useNewRepo.svelte.ts"),
      readSource("src/lib/hooks/useForkRepo.svelte.ts"),
    ]);

    for (const source of hooks) {
      expect(source).toContain("createGitOperationId(");
      expect(source).toContain("createGitOperationProgressObserver(");
      expect(source).toContain("subscribeGitProgress?.(onOperationProgress)");
      expect(source).toContain("unsubscribeGitProgress?.()");
      expect(source).toContain("operationId");
      expect(source).toContain("onOperationProgress");
    }
  });

  it("renders one truthful activity component in every repository flow", async () => {
    const importDialog = await readSource("src/lib/components/git/ImportRepoDialog.svelte");
    const newProgress = await readSource("src/lib/components/git/RepoProgressStep.svelte");
    const forkDialog = await readSource("src/lib/components/git/ForkRepoDialog.svelte");
    const activity = await readSource("src/lib/components/git/GitOperationActivity.svelte");

    for (const source of [importDialog, newProgress, forkDialog]) {
      expect(source).toContain("<GitOperationActivity");
    }

    expect(activity).toContain("activity?.current != null");
    expect(activity).toContain("activity?.total != null");
    expect(activity).toContain("Last activity");
    expect(activity).not.toContain("setTimeout(() =>");
  });
});
