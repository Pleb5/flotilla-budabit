import {describe, expect, it} from "vitest"
import {encrypt as nip49Encrypt} from "nostr-tools/nip49"
import {hexToBytes} from "@welshman/lib"
import {ncryptsecDecode, nsecEncode, parseNsecsFromText} from "./util"

const secretA = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
const secretB = "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"

describe("parseNsecsFromText", () => {
  it("extracts an nsec from downloaded key-file text", () => {
    const nsec = nsecEncode(secretA)
    const text = `This file contains a backup of your Nostr secret key.

Your private key is:

${nsec}

Keep it secret.`

    expect(parseNsecsFromText(text)).toEqual({
      nsecs: [nsec],
      ncryptsecs: [],
      hasInvalidNsec: false,
      hasEncryptedNsec: false,
    })
  })

  it("deduplicates repeated nsecs", () => {
    const nsec = nsecEncode(secretA)

    expect(parseNsecsFromText(`${nsec}\n${nsec}`).nsecs).toEqual([nsec])
  })

  it("extracts multiple valid nsecs", () => {
    const nsecA = nsecEncode(secretA)
    const nsecB = nsecEncode(secretB)

    expect(parseNsecsFromText(`${nsecA}\n${nsecB}`).nsecs).toEqual([nsecA, nsecB])
  })

  it("accepts uppercase nsecs", () => {
    const nsec = nsecEncode(secretA)

    expect(parseNsecsFromText(nsec.toUpperCase()).nsecs).toEqual([nsec])
  })

  it("reports invalid nsec candidates", () => {
    expect(parseNsecsFromText("nsec1notavalidprivatekey")).toEqual({
      nsecs: [],
      ncryptsecs: [],
      hasInvalidNsec: true,
      hasEncryptedNsec: false,
    })
  })

  it("reports encrypted private key candidates", () => {
    expect(parseNsecsFromText("ncryptsec1nothandledhere")).toEqual({
      nsecs: [],
      ncryptsecs: ["ncryptsec1nothandledhere"],
      hasInvalidNsec: false,
      hasEncryptedNsec: true,
    })
  })

  it("extracts encrypted private keys", () => {
    const ncryptsec = nip49Encrypt(hexToBytes(secretA), "correct horse", 4)

    expect(parseNsecsFromText(`Your encrypted private key is:\n\n${ncryptsec}`)).toEqual({
      nsecs: [],
      ncryptsecs: [ncryptsec],
      hasInvalidNsec: false,
      hasEncryptedNsec: true,
    })
  })

  it("ignores text without private keys", () => {
    expect(parseNsecsFromText("No key here.")).toEqual({
      nsecs: [],
      ncryptsecs: [],
      hasInvalidNsec: false,
      hasEncryptedNsec: false,
    })
  })
})

describe("ncryptsecDecode", () => {
  it("decrypts encrypted private keys", () => {
    const ncryptsec = nip49Encrypt(hexToBytes(secretA), "correct horse", 4)

    expect(ncryptsecDecode(ncryptsec, "correct horse")).toBe(secretA)
  })
})
