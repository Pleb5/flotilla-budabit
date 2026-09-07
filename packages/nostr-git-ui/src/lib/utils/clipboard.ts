import { decode } from "nostr-tools/nip19";

export const NOSTR_EVENT_LINK_COPIED = "Nostr Event Link Copied";

export const getCopySuccessMessage = (value: string, fallback = "Copied to clipboard!") => {
  const identifier = value.trim().replace(/^nostr:(?:\/\/)?/i, "");

  // Only public NIP-19 identities are share links, never private keys or payment data.
  if (/^(?:npub|nprofile|note|nevent|naddr)1/i.test(identifier)) {
    try {
      decode(identifier);
      return NOSTR_EVENT_LINK_COPIED;
    } catch {
      // Malformed identifiers are ordinary copied text, not valid event links.
    }
  }

  return fallback;
};
