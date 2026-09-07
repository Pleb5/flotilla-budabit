import { checkGraspRepoExists, checkGraspReceivePackReady } from "./grasp-availability.js";
import { parseRepoId } from "@nostr-git/core/utils";
import { waitForWorkerOperationTerminal } from "./worker-operation-session.js";
import { assertCompleteRemoteRefPush } from "./remote-sync.js";
import { initialImportDelay, initialImportUrls, type InitialImportGit } from "./initial-import.js";

/** Only the small RPCs this onramp needs; no hosted create, remote delete or force push. */
export function createInitialImportGit(worker: any): InitialImportGit {
  return {
    async refs(url) {
      const refs = await worker.listServerRefs({ url, symrefs: true, initialImport: true });
      if (!Array.isArray(refs)) throw new Error("Git server returned no verifiable refs");
      return refs.map((item: any) => ({ ref: String(item.ref), oid: String(item.oid) }));
    },
    async assertNew(job) {
      const result = await checkGraspRepoExists({
        relayUrl: job.relay,
        userPubkey: job.owner,
        owner: job.owner,
        repoName: job.name,
        bounded: true,
      });
      if (result.exists || result.provisioned)
        throw new Error(
          "GRASP destination already exists, including possible previous import residue. Choose a new name or resume its original job."
        );
    },
    async ready(job, signal) {
      for (let attempt = 0; attempt < 15; attempt++) {
        signal.throwIfAborted();
        if (
          await checkGraspReceivePackReady({
            relayUrl: job.relay,
            owner: job.owner,
            repoName: job.name,
          })
        )
          return;
        await initialImportDelay(signal, 2000);
      }
      throw new Error("GRASP has not provisioned its write endpoint; resume later");
    },
    async clone(job, operationId) {
      await worker.cloneRemoteRepo({
        url: `${job.source.url}.git`,
        dir: `/repos/${parseRepoId(job.localRepoId)}`,
        initialImport: true,
        operationId,
      });
    },
    async verifyLocal(job) {
      for (const item of job.refs) {
        let oid: string;
        try {
          oid = await worker.resolveRef({ repoId: job.localRepoId, ref: item.ref });
        } catch {
          oid = await worker.resolveRef({
            repoId: job.localRepoId,
            ref: item.ref.replace(/^refs\/heads\//, "refs/remotes/origin/"),
          });
        }
        if (oid !== item.oid)
          throw new Error(
            "Local clone differs from the approved refs or is incomplete; no Git push was started"
          );
      }
    },
    async push(job, refs, operationId) {
      const names = refs.map((r) => r.ref);
      const result = await worker.pushToRemote({
        repoId: job.localRepoId,
        remoteUrl: initialImportUrls(job).cloneUrls[0],
        refs: names,
        initialImportRefs: refs,
        token: job.owner,
        provider: "grasp",
        repoRelays: [job.relay],
        operationId,
      });
      assertCompleteRemoteRefPush(result, names, "GRASP import destination");
    },
    async settle(job) {
      if (!job.workerOperation) return true;
      const status = await waitForWorkerOperationTerminal(
        worker,
        job.workerOperation.id,
        job.workerOperation.type
      );
      if (
        status.operationId !== job.workerOperation.id ||
        status.operation !== job.workerOperation.type
      )
        return false;
      if (
        job.workerOperation.type === "cloneRemoteRepo" &&
        ["failed", "cancelled"].includes(status.state)
      )
        throw new Error(
          "Previous clone did not complete. Local refs alone cannot prove complete Git history; inspect before continuing."
        );
      return ["completed", "failed", "cancelled"].includes(status.state);
    },
    async cancel(operationId) {
      await worker.cancelOperation?.({ operationId, reason: "Stop initial import" });
    },
    async cleanup(job, operationId) {
      const result = await worker.deleteRepo({ repoId: job.localRepoId, operationId });
      if (result?.success !== true)
        throw new Error("Repository created, but temporary local cleanup is pending");
    },
  };
}
