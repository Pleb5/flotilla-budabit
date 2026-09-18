import type { PublicRepoSource } from "@nostr-git/core/git";
import type { PreparedSourceRefs } from "../hooks/useRepoCopy.svelte.js";

export const PUBLIC_COPY_MAX_REFS = 100;
export const PUBLIC_COPY_MAX_SIZE_KIB = 50 * 1024;

export function publicRepoCopyAdmissionError(source: PublicRepoSource): string | undefined {
  if (source.empty)
    return "This source has no Git history to copy. Add a commit on the source host, or choose Brand new Repo to start a repository.";
  if (source.sizeKiB !== undefined && source.sizeKiB > PUBLIC_COPY_MAX_SIZE_KIB)
    return "Source exceeds the 50 MiB browser copy estimate. Copy it with a local Git client, or choose a smaller source.";
  return undefined;
}

export async function readPublicCopyRefs(
  worker: any,
  source: PublicRepoSource,
  signal: AbortSignal
): Promise<PreparedSourceRefs> {
  signal.throwIfAborted();
  const advertised = await worker.listServerRefs({
    url: source.cloneUrl,
    symrefs: true,
    publicSource: true,
  });
  signal.throwIfAborted();
  if (!Array.isArray(advertised)) throw new Error("Source refs could not be verified");
  const refs: PreparedSourceRefs["refs"] = [];
  for (const entry of advertised) {
    const match = /^refs\/(heads|tags)\/(.+)$/.exec(String(entry.ref));
    if (!match || match[2].endsWith("^{}")) continue;
    if (!/^[0-9a-f]{40}$/.test(entry.oid) || refs.some((ref) => ref.ref === entry.ref))
      throw new Error("Source returned invalid or duplicate Git refs");
    refs.push({
      type: match[1] as "heads" | "tags",
      name: match[2],
      ref: entry.ref,
      commit: entry.oid,
    });
  }
  if (refs.length > PUBLIC_COPY_MAX_REFS)
    throw new Error(
      `Source exceeds the browser limit of ${PUBLIC_COPY_MAX_REFS} branches and tags. Copy it with a local Git client, or choose a smaller source`
    );
  if (!refs.some((ref) => ref.ref === `refs/heads/${source.defaultBranch}`))
    throw new Error(
      "Source default branch is missing or changed. Inspect the source again after adding or restoring its default branch"
    );
  return {
    defaultBranch: source.defaultBranch,
    branches: refs.filter((ref) => ref.type === "heads").map((ref) => ref.name),
    tags: refs.filter((ref) => ref.type === "tags").map((ref) => ref.name),
    refs,
  };
}

export async function verifyPublicCopyRefs(
  worker: any,
  repoId: string,
  source: PublicRepoSource,
  snapshot: PreparedSourceRefs,
  signal: AbortSignal
): Promise<void> {
  for (const ref of snapshot.refs) {
    signal.throwIfAborted();
    let oid: string;
    try {
      oid = await worker.resolveRef({ repoId, ref: ref.ref });
    } catch {
      oid = await worker.resolveRef({
        repoId,
        ref: ref.ref.replace(/^refs\/heads\//, "refs/remotes/origin/"),
      });
    }
    if (oid !== ref.commit)
      throw new Error(
        "Local clone differs from the source snapshot or is incomplete; no Git push was started"
      );
  }
  const latest = await readPublicCopyRefs(worker, source, signal);
  const serialize = (value: PreparedSourceRefs) =>
    JSON.stringify(value.refs.map((ref) => [ref.ref, ref.commit]).sort());
  if (serialize(latest) !== serialize(snapshot))
    throw new Error(
      "Source branches or tags changed during cloning. Inspect the source again; no Git push was started"
    );
}
