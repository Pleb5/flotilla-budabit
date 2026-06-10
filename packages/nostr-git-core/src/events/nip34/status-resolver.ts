// Core: status resolver (separate from existing git status utilities)
import type { NostrEvent } from "nostr-tools";
import {
  GIT_STATUS_APPLIED,
  GIT_STATUS_CLOSED,
  GIT_STATUS_DRAFT,
  GIT_STATUS_OPEN,
} from "./nip34.js";

export type LocalStatusEvent = NostrEvent; // refine when wired to shared-types
export type Nip34StatusState = "open" | "applied" | "closed" | "draft";

const STATUS_KINDS = [GIT_STATUS_OPEN, GIT_STATUS_APPLIED, GIT_STATUS_CLOSED, GIT_STATUS_DRAFT];

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

export function statusKindToState(kind: number | undefined): Nip34StatusState {
  if (kind === GIT_STATUS_APPLIED) return "applied";
  if (kind === GIT_STATUS_CLOSED) return "closed";
  if (kind === GIT_STATUS_DRAFT) return "draft";
  return "open";
}

export function resolveStatusState(args: {
  statuses: LocalStatusEvent[];
  rootAuthor: string;
  maintainers: Set<string>;
  repoOwner?: string;
  importedRoot?: boolean;
}): { state: Nip34StatusState; final: LocalStatusEvent | undefined; reason: string } {
  const resolved = resolveStatus(args);
  return {
    state: statusKindToState(resolved.final?.kind),
    final: resolved.final,
    reason: resolved.reason,
  };
}
