// Core: status resolver (separate from existing git status utilities)
import type { NostrEvent } from "nostr-tools";

export type LocalStatusEvent = NostrEvent; // refine when wired to shared-types

const STATUS_KINDS = [1630, 1631, 1632, 1633];

export function isImportedEvent(event: Pick<NostrEvent, "tags"> | undefined): boolean {
  return Boolean(event?.tags?.some((tag) => tag[0] === "imported"));
}

export function isStatusAuthorized(args: {
  status: LocalStatusEvent;
  rootAuthor: string;
  maintainers: Set<string>;
  repoOwner?: string;
  importedRoot?: boolean;
}): boolean {
  const { status, rootAuthor, maintainers, repoOwner = "", importedRoot = false } = args;
  const statusAuthor = status.pubkey || "";
  if (!statusAuthor) return false;
  if (repoOwner && statusAuthor === repoOwner) return true;
  if (maintainers.has(statusAuthor)) return true;
  if (!importedRoot && rootAuthor && statusAuthor === rootAuthor) return true;
  return importedRoot && isImportedEvent(status);
}

export function resolveStatus(args: {
  statuses: LocalStatusEvent[];
  rootAuthor: string;
  maintainers: Set<string>;
  repoOwner?: string;
  importedRoot?: boolean;
}): { final: LocalStatusEvent | undefined; reason: string } {
  let final: LocalStatusEvent | undefined;

  for (const status of args.statuses) {
    if (typeof status?.kind !== "number" || !STATUS_KINDS.includes(status.kind)) continue;
    if (
      !isStatusAuthorized({
        status,
        rootAuthor: args.rootAuthor,
        maintainers: args.maintainers,
        repoOwner: args.repoOwner,
        importedRoot: args.importedRoot,
      })
    ) {
      continue;
    }

    const statusTime = status.created_at ?? 0;
    const finalTime = final?.created_at ?? 0;
    if (
      !final ||
      statusTime > finalTime ||
      (statusTime === finalTime && (status.id || "").localeCompare(final.id || "") > 0)
    ) {
      final = status;
    }
  }

  if (!final) return { final: undefined, reason: "no-authorized-status-events" };

  return {
    final,
    reason: `selected-by latest authorized status (${final.created_at ?? 0})`,
  };
}
