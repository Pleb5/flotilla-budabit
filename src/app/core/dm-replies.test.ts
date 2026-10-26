import {describe, expect, it} from "vitest"
import {finalizeEvent, getPublicKey, nip44} from "nostr-tools"
import {dmReplyId, isDmReplyTarget} from "./dm-replies"

describe("Freedom Builders kind4444 reply contract", () => {
  const key = new Uint8Array(32).fill(61)
  const other = new Uint8Array(32).fill(62)
  const account = getPublicKey(key)
  const peer = getPublicKey(other)
  const event = (tags: string[][]) =>
    finalizeEvent(
      {
        kind: 4444,
        created_at: 42,
        tags,
        content: nip44.v2.encrypt("private text", nip44.v2.utils.getConversationKey(key, peer)),
      },
      key,
    )
  it("resolves the explicit native parent ID without decoding public content", () => {
    const parent = event([["p", peer]])
    const child = event([
      ["p", peer],
      ["e", parent.id, "", "reply"],
    ])
    expect(dmReplyId(child)).toBe(parent.id)
    expect(isDmReplyTarget(parent, account, peer)).toBe(true)
    expect(nip44.v2.decrypt(child.content, nip44.v2.utils.getConversationKey(other, account))).toBe(
      "private text",
    )
  })
  it("ignores unmarked, malformed and ambiguous references", () => {
    for (const tags of [
      [["e", "a".repeat(64)]],
      [["e", "bad", "", "reply"]],
      [
        ["e", "a".repeat(64), "", "reply"],
        ["e", "b".repeat(64), "", "reply"],
      ],
    ]) {
      expect(dmReplyId(event(tags))).toBeUndefined()
    }
  })
  it("rejects cross-conversation and ambiguous recipients", () => {
    expect(isDmReplyTarget(event([["p", "f".repeat(64)]]), account, peer)).toBe(false)
    expect(
      isDmReplyTarget(
        event([
          ["p", peer],
          ["p", account],
        ]),
        account,
        peer,
      ),
    ).toBe(false)
    expect(isDmReplyTarget(event([["p", peer]]), "f".repeat(64), account)).toBe(false)
  })
})
