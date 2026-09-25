import {describe, expect, it} from "vitest"
import {npubEncode} from "nostr-tools/nip19"
import {getPublicKey} from "nostr-tools/pure"
import {makeCiRepoWatcherDrafts, validateCiRepoWatcherDrafts} from "./ci-repo-watchers"

const pubkey = getPublicKey(new Uint8Array(32).fill(7))

describe("CI repository watcher drafts", () => {
  it("accepts an optional empty list and normalizes npubs, hex, and repeated relays", () => {
    expect(validateCiRepoWatcherDrafts([])).toEqual({watchers: [], errors: {}})
    const result = validateCiRepoWatcherDrafts([
      {pubkey: ` ${npubEncode(pubkey)} `, relays: " wss://ci.example/ \n\nwss://ci.example"},
      {pubkey: pubkey.toUpperCase(), relays: "wss://backup.example/"},
    ])
    expect(result).toEqual({
      watchers: [{pubkey, relays: ["wss://ci.example", "wss://backup.example"]}],
      errors: {},
    })
    const drafts = makeCiRepoWatcherDrafts(result.watchers)
    expect(validateCiRepoWatcherDrafts(drafts)).toEqual(result)
    drafts[0].pubkey = "edited"
    expect(result.watchers[0].pubkey).toBe(pubkey)
  })

  it("identifies incomplete and invalid rows without publishing a partial list", () => {
    const result = validateCiRepoWatcherDrafts([
      {pubkey, relays: "wss://valid.example"},
      {pubkey: "not-a-key", relays: ""},
      {pubkey, relays: "wss://valid.example\nhttps://invalid.example"},
    ])
    expect(result.watchers).toEqual([])
    expect(result.errors).toEqual({
      "ci-repo-watcher-1-pubkey": "Enter the watcher's npub or 64-character hex public key.",
      "ci-repo-watcher-1-relays": "Add at least one relay for this watcher.",
      "ci-repo-watcher-2-relays": "Line 2 must be a valid wss:// URL.",
    })
  })

  it("enforces both input and merged relay limits", () => {
    const relays = Array.from({length: 21}, (_, index) => `wss://relay-${index}.example`)
    expect(
      validateCiRepoWatcherDrafts([{pubkey, relays: relays.join("\n")}]).errors,
    ).toHaveProperty("ci-repo-watcher-0-relays")
    expect(
      validateCiRepoWatcherDrafts([
        {pubkey, relays: relays.slice(0, 20).join("\n")},
        {pubkey, relays: relays[20]},
      ]).errors,
    ).toHaveProperty("ciRepoWatchers")
    expect(
      validateCiRepoWatcherDrafts(Array(21).fill({pubkey, relays: relays[0]})).errors,
    ).toHaveProperty("ciRepoWatchers")
  })
})
