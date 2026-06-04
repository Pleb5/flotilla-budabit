import type { NostrEvent } from "nostr-tools";
import { resolveStatus } from "./status-resolver.js";
import type { IssueThread } from "../../types/index.js";

export type { IssueThread };

function asSet<T>(arr: T[]): Set<T> {
  return new Set(arr);
}

function getRootAddresses(root: NostrEvent): string[] {
  // If the issue root carries address tags ('a'), include them for matching comment 'A'/'a' references
  return root.tags?.filter((t) => t[0] === "a").map((t) => t[1]) ?? [];
}

function hasKindScoped(tags: string[][], kind: number): boolean {
  // Respect optional K/k scoping. If present, ensure it matches root.kind; otherwise allow.
  const K = tags.find((t) => t[0] === "K");
  if (K) return String(kind) === K[1];
  const k = tags.find((t) => t[0] === "k");
  if (k) return String(kind) === k[1];
  return true;
}

function commentMatchesRoot(comment: NostrEvent, root: NostrEvent, rootAddresses: Set<string>): boolean {
  const tags = (comment.tags as string[][]) || [];
  if (!hasKindScoped(tags, root.kind)) return false;

  // Root ID match via uppercase 'E' (root) or lowercase 'e' (parent chain). Prefer explicit uppercase but accept lowercase when pointing to root.
  const eVals = tags.filter((t) => t[0] === "E" || t[0] === "e").map((t) => t[1]);
  if (eVals.includes(root.id)) return true;

  // Address match via 'A' or 'a'
  const aVals = tags.filter((t) => t[0] === "A" || t[0] === "a").map((t) => t[1]);
  for (const v of aVals) {
    if (rootAddresses.has(v)) return true;
  }

  // External id match ('I'/'i') unsupported for issues; ignore for now.
  return false;
}

function statusMatchesRoot(status: NostrEvent, root: NostrEvent, rootAddresses: Set<string>): boolean {
  const tags = (status.tags as string[][]) || [];
  // NIP-34 status often references root via e-tag with marker 'root'. Accept any 'e' id match.
  const eRefs = tags.filter((t) => t[0] === "e");
  if (eRefs.some((t) => t[1] === root.id)) return true;
  // Or via address 'a'
  const aRefs = tags.filter((t) => t[0] === "a").map((t) => t[1]);
  for (const v of aRefs) {
    if (rootAddresses.has(v)) return true;
  }
  return false;
}

function dedupeById<T extends { id?: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const it of items) {
    const id = (it.id as string) || "";
    if (!id || !seen.has(id)) {
      out.push(it);
      if (id) seen.add(id);
    }
  }
  return out;
}

export function assembleIssueThread(args: {
  root: NostrEvent;
  comments: NostrEvent[];
  statuses: NostrEvent[];
}): IssueThread {
  const { root } = args;
  const addrSet = asSet(getRootAddresses(root));

  const filteredComments = args.comments.filter((c) => commentMatchesRoot(c, root, addrSet));
  const filteredStatuses = args.statuses.filter((s) => statusMatchesRoot(s, root, addrSet));

  // Dedupe and order by created_at ascending for stable threading
  const comments = dedupeById(filteredComments).sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  const statuses = dedupeById(filteredStatuses).sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));

  return { root, comments, statuses };
}

// Select the latest status from an authorized issue actor.
export function resolveIssueStatus(
  thread: IssueThread,
  rootAuthor: string,
  maintainers: Set<string>,
  options: { repoOwner?: string; importedRoot?: boolean } = {}
): { final: NostrEvent | undefined; reason: string } {
  return resolveStatus({
    statuses: thread.statuses as NostrEvent[],
    rootAuthor,
    maintainers,
    repoOwner: options.repoOwner,
    importedRoot: options.importedRoot,
  });
}
