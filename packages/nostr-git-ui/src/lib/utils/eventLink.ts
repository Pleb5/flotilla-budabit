import { nip19, type NostrEvent } from "nostr-tools";
import { sanitizeRelays, shareableRelays } from "@nostr-git/core/utils";

// Relay hints embedded in shared entities must be publicly reachable
export const getEventRelayHints = (_event: Pick<NostrEvent, "tags">, relays: string[] = []) =>
  shareableRelays(relays);

export const getReferenceRelayHints = (
  event: Pick<NostrEvent, "tags">,
  tagName: string,
  value = ""
) =>
  sanitizeRelays(
    (event.tags || [])
      .filter((tag) => tag[0] === tagName && (!value || tag[1] === value))
      .flatMap((tag) => tag.slice(2))
  );

export const makeNaddrFromAddress = (address: string, relays: string[] = []) => {
  const [kindText, pubkey, ...identifierParts] = address.split(":");
  const kind = Number.parseInt(kindText, 10);
  const identifier = identifierParts.join(":");
  if (!Number.isFinite(kind) || !pubkey || !identifier) return "";

  try {
    return nip19.naddrEncode({
      kind,
      pubkey,
      identifier,
      relays: shareableRelays(relays),
    });
  } catch {
    return "";
  }
};

export const makeEventNevent = (
  event: Pick<NostrEvent, "id" | "kind" | "pubkey" | "tags">,
  relays: string[] = []
) => {
  if (!event.id) return "";

  try {
    return nip19.neventEncode({
      id: event.id,
      relays: getEventRelayHints(event, relays),
      author: event.pubkey || undefined,
      kind: event.kind,
    });
  } catch {
    return "";
  }
};
