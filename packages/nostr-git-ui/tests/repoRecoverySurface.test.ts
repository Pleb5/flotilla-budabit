import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("repository recovery integration", () => {
  const workspaceRoot = process.cwd().endsWith("packages/nostr-git-ui")
    ? resolve(process.cwd(), "../..")
    : process.cwd();
  const readWorkspace = (path: string) => readFile(resolve(workspaceRoot, path), "utf8");
  const readPackage = (path: string) => readWorkspace(`packages/nostr-git-ui/${path}`);

  it("persists target checkpoints incrementally in all repository flows", async () => {
    const hooks = await Promise.all([
      readPackage("src/lib/hooks/useImportRepo.svelte.ts"),
      readPackage("src/lib/hooks/useNewRepo.svelte.ts"),
      readPackage("src/lib/hooks/useForkRepo.svelte.ts"),
    ]);

    for (const source of hooks) {
      expect(source).toContain("recordRemoteSyncCheckpoint(checkpoint)");
      expect(source).toMatch(/recordTargetResult\((result|targetResult)\)/);
    }
  });

  it("cleans temporary mirrors while retaining successful new local repositories", async () => {
    const importHook = await readPackage("src/lib/hooks/useImportRepo.svelte.ts");
    const forkHook = await readPackage("src/lib/hooks/useForkRepo.svelte.ts");
    const newHook = await readPackage("src/lib/hooks/useNewRepo.svelte.ts");

    expect(importHook.indexOf("temporary import mirror")).toBeLessThan(
      importHook.indexOf("onImportCompleted?.(result)")
    );
    expect(forkHook.indexOf("temporary fork mirror")).toBeLessThan(
      forkHook.indexOf("onForkCompleted?.(result)")
    );
    expect(newHook).toContain("!hasSuccessfulTarget");
    expect(newHook).not.toContain("temporary new repository");
  });

  it("routes every pending phase through the conservative recovery coordinator", async () => {
    const route = await readWorkspace("src/routes/git/+page.svelte");

    expect(route).toContain("recoverRepoCreationRecord(record");
    expect(route).not.toContain('if (record.phase === "metadata-pending")');
    expect(route).not.toContain("createRemoteRepo(");
    expect(route).not.toContain("pushToRemote(");
  });
});
