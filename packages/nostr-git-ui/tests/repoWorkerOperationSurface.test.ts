import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("repository worker operation integration", () => {
  const packageRoot = process.cwd().endsWith("packages/nostr-git-ui")
    ? process.cwd()
    : resolve(process.cwd(), "packages/nostr-git-ui");
  const readSource = (path: string) => readFile(resolve(packageRoot, path), "utf8");

  it("wires remote mutations through child operation tracking callbacks", async () => {
    const remoteSync = await readSource("src/lib/utils/remote-sync.ts");
    const hooks = await Promise.all([
      readSource("src/lib/hooks/useImportRepo.svelte.ts"),
      readSource("src/lib/hooks/useNewRepo.svelte.ts"),
      readSource("src/lib/hooks/useForkRepo.svelte.ts"),
    ]);

    expect(remoteSync).toContain(
      'runWorkerMutation<WorkerCreateRemoteRepoResult>(\n                "createRemoteRepo"'
    );
    expect(remoteSync.match(/runWorkerMutation<WorkerPushToRemoteResult>/g)).toHaveLength(2);
    expect(remoteSync).toContain('params.runWorkerMutation<any>(\n      "deleteRemoteRepo"');
    expect(remoteSync).not.toContain("upsertBranchRef");

    for (const hook of hooks) {
      expect(hook).toContain("new WorkerOperationSession(");
      expect(hook).toContain("createWorkerOperationId:");
      expect(hook).toContain("onWorkerOperationStart:");
      expect(hook).toContain("onWorkerOperationSettled:");
      expect(hook).toContain("waitForWorkerOperationTerminal:");
      expect(hook).toContain('result.outcome === "unknown"');
    }
  });

  it("requests worker cancellation before aborting each UI wait", async () => {
    const importHook = await readSource("src/lib/hooks/useImportRepo.svelte.ts");
    const newHook = await readSource("src/lib/hooks/useNewRepo.svelte.ts");
    const forkHook = await readSource("src/lib/hooks/useForkRepo.svelte.ts");

    expect(importHook.indexOf("activeOperationSession?.requestCancellation")).toBeLessThan(
      importHook.indexOf("abortController.abort(reason)")
    );
    expect(newHook.indexOf("activeOperationSession?.requestCancellation")).toBeLessThan(
      newHook.indexOf("activeAbortController?.abort(reason)")
    );
    expect(forkHook.indexOf("activeOperationSession?.requestCancellation")).toBeLessThan(
      forkHook.indexOf("abortController.abort(message)")
    );
  });

  it("requires an unused local target for new repository creation", async () => {
    const source = await readSource("src/lib/hooks/useNewRepo.svelte.ts");
    const paramsStart = source.indexOf("const createLocalRepoParams = {");
    const callStart = source.indexOf(
      "api.createLocalRepo({ ...createLocalRepoParams, operationId })"
    );
    const params = source.slice(paramsStart, callStart);

    expect(paramsStart).toBeGreaterThan(0);
    expect(callStart).toBeGreaterThan(paramsStart);
    expect(params).toContain("mustNotExist: true");
  });
});
