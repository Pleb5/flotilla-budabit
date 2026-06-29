import {describe, expect, it} from "vitest"

import {validateNewPassphrase} from "./passphrase"

describe("validateNewPassphrase", () => {
  it("accepts matching passphrases of at least 12 characters", () => {
    expect(validateNewPassphrase("correct horse", "correct horse")).toBe("")
  })

  it("requires at least 12 characters", () => {
    expect(validateNewPassphrase("short", "short")).toBe(
      "Use an encryption passphrase of at least 12 characters.",
    )
  })

  it("requires matching passphrases", () => {
    expect(validateNewPassphrase("correct horse", "correct zebra")).toBe(
      "Encryption passphrases do not match.",
    )
  })
})
