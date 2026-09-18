import {describe, expect, it} from "vitest"
import {Amount, getEncodedToken} from "@cashu/cashu-ts"
import {ParsedType, type ParsedText} from "@welshman/content"
import {parseCashuTokenAmount} from "../../../packages/budabit-pipelines-extension/packages/iframe-app/src/lib/payment"
import {
  findCashuTokenStart,
  getCashuTokenAtStart,
  getCashuTokenInfo,
  replaceCashuTokens,
  shortenCashuToken,
} from "./cashu-token"

const MINT = "https://mint.example"

const makeToken = () =>
  getEncodedToken({
    mint: MINT,
    proofs: [
      {
        id: "009a1f293253e41e",
        amount: Amount.from(2),
        secret: "test-secret",
        C: `02${"a".repeat(64)}`,
      },
    ],
  })

describe("cashu-token utilities", () => {
  it("reads compact 01 tokens without guessing full keyset IDs in app and extension metadata", async () => {
    const token = getEncodedToken({
      mint: MINT,
      proofs: [
        {
          id: `01${"ab".repeat(31)}`,
          amount: Amount.from(4),
          secret: "public",
          C: `02${"a".repeat(64)}`,
        },
      ],
    })
    expect(getCashuTokenInfo(token)?.amount).toBe(4)
    expect(await parseCashuTokenAmount(token)).toBe(4)
  })

  it("rejects totals too large for the numeric UI/extension boundary", async () => {
    const token = getEncodedToken({
      mint: MINT,
      proofs: [
        {
          id: "009a1f293253e41e",
          amount: Amount.from(2n ** 54n),
          secret: "public",
          C: `02${"a".repeat(64)}`,
        },
      ],
    })
    expect(getCashuTokenInfo(token)).toBeUndefined()
    await expect(parseCashuTokenAmount(token)).rejects.toThrow()
  })

  it("reads metadata from generated bare Cashu tokens", () => {
    const token = makeToken()
    const info = getCashuTokenInfo(token)

    expect(info).toMatchObject({token, mintUrl: MINT, amount: 2, unit: "sat"})
  })

  it("reads metadata from cashu-prefixed tokens", () => {
    const token = `cashu:${makeToken()}`

    expect(getCashuTokenInfo(token)).toMatchObject({token, mintUrl: MINT, amount: 2})
  })

  it("finds standalone tokens but not URL path fragments", () => {
    const token = makeToken()

    expect(findCashuTokenStart(`pay ${token} now`)).toBe(4)
    expect(findCashuTokenStart(`https://example.com/${token}`)).toBe(-1)
  })

  it("tokenizes tokens followed by punctuation", () => {
    const token = makeToken()

    expect(getCashuTokenAtStart(`${token}.`)?.token).toBe(token)
  })

  it("splits generated tokens out of text tokens", () => {
    const token = makeToken()
    const text = `pay ${token} now`
    const parsed: ParsedText = {type: ParsedType.Text, value: text, raw: text}

    const result = replaceCashuTokens([parsed])

    expect(result).toHaveLength(3)
    expect(result[0]).toMatchObject({type: ParsedType.Text, value: "pay "})
    expect(result[1]).toMatchObject({type: ParsedType.Cashu, value: token})
    expect(result[2]).toMatchObject({type: ParsedType.Text, value: " now"})
  })

  it("shortens display tokens without the optional cashu URI prefix", () => {
    const token = makeToken()

    expect(shortenCashuToken(`cashu:${token}`)).toBe(shortenCashuToken(token))
    expect(shortenCashuToken(token)).toContain("...")
  })
})
