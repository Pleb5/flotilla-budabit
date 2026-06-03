import type { CommentEvent } from "@nostr-git/core/events";
import type { NostrEvent } from "nostr-tools";

export type DiffViewerRootEvent =
  | NostrEvent
  | { id: string; pubkey?: string; kind?: number; tags?: string[][] };

export const canUseInlineComments = ({
  rootEvent,
  onComment,
  currentPubkey,
}: {
  rootEvent?: DiffViewerRootEvent;
  onComment?: (comment: Omit<CommentEvent, "id" | "pubkey" | "sig">) => void;
  currentPubkey?: string | null;
}) => Boolean(rootEvent && onComment && currentPubkey);
