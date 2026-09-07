import { describe, expect, it } from "vitest";
import * as nip19 from "nostr-tools/nip19";
import { getCopySuccessMessage } from "./clipboard";

const pubkey = "2".repeat(64);
const eventId = "1".repeat(64);
const relays = ["wss://repo.example.com"];
const identifiers = [
  ["npub", nip19.npubEncode(pubkey)],
  ["nprofile", nip19.nprofileEncode({ pubkey, relays })],
  ["note", nip19.noteEncode(eventId)],
  ["nevent", nip19.neventEncode({ id: eventId, author: pubkey, kind: 1618, relays })],
  ["naddr", nip19.naddrEncode({ pubkey, kind: 30617, identifier: "repo", relays })],
] as const;

describe.each(identifiers)("%s copy confirmations", (_type, identifier) => {
  it.each(["", "nostr:", "nostr://"])("recognizes the %s prefix", (prefix) => {
    expect(getCopySuccessMessage(`${prefix}${identifier}`)).toBe("Nostr Event Link Copied");
  });

  it("recognizes uppercase and surrounding whitespace", () => {
    expect(getCopySuccessMessage(`  NOSTR:${identifier.toUpperCase()}  `)).toBe(
      "Nostr Event Link Copied"
    );
  });

  it("does not mistake a bad checksum for a shareable identity", () => {
    const invalid = identifier.slice(0, -1) + (identifier.endsWith("q") ? "p" : "q");
    expect(getCopySuccessMessage(invalid)).toBe("Copied to clipboard!");
  });
});

describe("non-Nostr copy confirmations", () => {
  it.each([
    "",
    "ordinary text",
    "https://example.com",
    `https://example.com/${nip19.npubEncode(pubkey)}`,
    `Mention nostr:${nip19.noteEncode(eventId)}`,
    "npub1invalid",
    eventId,
    `30617:${pubkey}:repo`,
    nip19.nsecEncode(new Uint8Array(32).fill(7)),
    `nostr:${nip19.nsecEncode(new Uint8Array(32).fill(7))}`,
    "lnbc123example",
    "cashuAexample",
  ])("keeps generic feedback for non-share value %#", (value) => {
    expect(getCopySuccessMessage(value)).toBe("Copied to clipboard!");
  });

  it("preserves custom fallback messages, including silent copy paths", () => {
    expect(getCopySuccessMessage("https://example.com", "URL copied")).toBe("URL copied");
    expect(getCopySuccessMessage("https://example.com", "")).toBe("");
    expect(getCopySuccessMessage(nip19.npubEncode(pubkey), "")).toBe("Nostr Event Link Copied");
  });
});
