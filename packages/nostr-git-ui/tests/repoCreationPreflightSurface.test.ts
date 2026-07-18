import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("repository creation preflight ordering", () => {
  const packageRoot = process.cwd().endsWith("packages/nostr-git-ui")
    ? process.cwd()
    : resolve(process.cwd(), "packages/nostr-git-ui");
  const readSource = (path: string) => readFile(resolve(packageRoot, path), "utf8");

  it("checks new destinations and local state before local creation", async () => {
    const source = await readSource("src/lib/hooks/useNewRepo.svelte.ts");
    const prerequisites = source.indexOf("assertRepoCreationPrerequisites({");
    const coordinate = source.indexOf("await assertRepoCoordinateAvailable({");
    const localExists = source.indexOf("await workerApi.isRepoCloned");
    const remotePreflight = source.indexOf("await preflightNewRemoteTargets({");
    const localCreate = source.indexOf("const localRepo = await createLocalRepo");

    expect(prerequisites).toBeGreaterThan(0);
    expect(coordinate).toBeGreaterThan(prerequisites);
    expect(localExists).toBeGreaterThan(coordinate);
    expect(remotePreflight).toBeGreaterThan(localExists);
    expect(localCreate).toBeGreaterThan(remotePreflight);
  });

  it("checks fork metadata and targets before source clone", async () => {
    const source = await readSource("src/lib/hooks/useForkRepo.svelte.ts");
    const prerequisites = source.indexOf("assertRepoCreationPrerequisites({");
    const coordinate = source.indexOf("await assertRepoCoordinateAvailable({");
    const remotePreflight = source.indexOf("await preflightNewRemoteTargets({");
    const clone = source.indexOf("gitWorkerApi.cloneRemoteRepo({");

    expect(prerequisites).toBeGreaterThan(0);
    expect(coordinate).toBeGreaterThan(prerequisites);
    expect(remotePreflight).toBeGreaterThan(coordinate);
    expect(clone).toBeGreaterThan(remotePreflight);
  });

  it("makes wizard availability checks fail closed across every GRASP relay", async () => {
    const source = await readSource("src/lib/components/git/NewRepoWizard.svelte");

    expect(source).toContain("graspRelayUrls.map((relayUrl)");
    expect(source).toContain("availabilityBlocksCreation(nameAvailabilityResults)");
    expect(source).toContain("const availability = await checkNameAvailability(repoDetails.name)");
    expect(source).toContain("!item.available || Boolean(item.error)");
  });
});
