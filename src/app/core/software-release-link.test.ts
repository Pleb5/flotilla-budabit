import {describe, expect, it} from "vitest"
import {finalizeEvent, nip19} from "nostr-tools"
import {matchFilters, type TrustedEvent} from "@welshman/util"
import {loadSoftwareReleaseLink} from "./software-release-link"

const key = new Uint8Array(32).fill(1)
const sign = (kind: number, tags: string[][], created_at = 100, content = "", secret = key) =>
  finalizeEvent({kind, tags, created_at, content}, secret) as TrustedEvent
const repo = sign(30617, [
  ["d", "software"],
  ["relays", "wss://fixture.test"],
])
const app = sign(32267, [
  ["d", "club.fixture.app"],
  ["name", "Fixture App"],
  ["a", `30617:${repo.pubkey}:software`],
])
const asset = sign(3063, [
  ["i", "club.fixture.app"],
  ["version", "1.0"],
  ["m", "application/octet-stream"],
  ["x", "a".repeat(64)],
  ["filename", "app.bin"],
])
const release = sign(30063, [
  ["d", "club.fixture.app@1.0"],
  ["i", "club.fixture.app"],
  ["version", "1.0"],
  ["e", asset.id, "wss://assets.test"],
])
const pointer = nip19.naddrEncode({
  kind: 30063,
  pubkey: repo.pubkey,
  identifier: "club.fixture.app@1.0",
})
const load = (events: TrustedEvent[], ref = pointer) =>
  loadSoftwareReleaseLink(repo, ref, [], new AbortController().signal, async (relays, filter) => ({
    status: "ok",
    events: events.filter(e => matchFilters([filter], e)),
    complete: true,
    completedRelays: relays,
    failedRelays: [],
    timedOutRelays: [],
  }))

describe("software release share resolution", () => {
  it("resolves the latest authorized revision and pinned asset", async () => {
    const newer = sign(30063, release.tags, 101, "New release notes")
    const result = await load([app, asset, release, newer])
    expect(result?.event.id).toBe(newer.id)
    expect(result?.assets.map(a => a.eventId)).toEqual([asset.id])
  })
  it("returns unavailable for unknown, deleted, unbound and unauthorized records", async () => {
    expect(await load([app, asset])).toBeNull()
    const deletion = sign(5, [["a", `30063:${release.pubkey}:club.fixture.app@1.0`]], 101)
    expect(await load([app, asset, release, deletion])).toBeNull()
    const unrelated = sign(
      32267,
      app.tags.map(t => (t[0] === "a" ? ["a", `30617:${repo.pubkey}:other`] : t)),
      101,
    )
    expect(await load([app, unrelated, asset, release])).toBeNull()
    const forged = sign(30063, release.tags, 101, "", new Uint8Array(32).fill(2))
    expect(
      await load(
        [app, asset, forged],
        nip19.naddrEncode({kind: 30063, pubkey: forged.pubkey, identifier: "club.fixture.app@1.0"}),
      ),
    ).toBeNull()
  })
  it("does not admit mismatched or deleted assets", async () => {
    const wrong = sign(
      3063,
      asset.tags.map(t => (t[0] === "version" ? ["version", "2.0"] : t)),
    )
    const linked = sign(30063, [...release.tags, ["e", wrong.id]])
    const deleted = sign(5, [["e", asset.id]], 101)
    expect(await load([app, asset, wrong, linked, deleted])).toMatchObject({
      assets: [],
      missingAssets: 2,
    })
  })
})
