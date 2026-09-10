import { createRepoAnnouncementEvent, createRepoStateEvent } from "@nostr-git/core/events";
import { buildGraspRepoUrls } from "./grasp-pipeline.js";
import type { InitialImportJob } from "./initial-import-store.js";

export const initialImportAddress = (job: Pick<InitialImportJob, "owner" | "name">) =>
  `30617:${job.owner}:${job.name}`;
export const initialImportUrls = (job: Pick<InitialImportJob, "owner" | "name" | "relay">) =>
  buildGraspRepoUrls({ relayUrls: [job.relay], ownerPubkey: job.owner, repoName: job.name });

/** One definition for reviewed metadata, signing, and validating durable recovery. */
export function initialImportMetadata(job: InitialImportJob, type: "announcement" | "state") {
  if (type === "state")
    return createRepoStateEvent({
      repoId: job.name,
      head: job.source.defaultBranch,
      created_at: job.createdAt,
      refs: job.refs.map((r) => ({
        type: r.ref.startsWith("refs/heads/") ? "heads" : "tags",
        name: r.ref.split("/").slice(2).join("/"),
        commit: r.oid,
      })),
    });
  const urls = initialImportUrls(job);
  return createRepoAnnouncementEvent({
    repoId: job.name,
    identifier: job.name,
    name: job.displayName ?? job.name,
    ...(job.upstream ? { upstreams: [["u", job.upstream] as ["u", string]] } : {}),
    description: job.source.description,
    clone: urls.cloneUrls,
    web: urls.webUrls,
    relays: [job.relay],
    maintainers: [job.owner],
    created_at: job.createdAt,
  });
}
