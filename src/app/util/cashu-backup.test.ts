import {describe, expect, it} from "vitest"
import {
  createCashuBackupText,
  createEncryptedCashuBackupText,
  decryptCashuBackupData,
  parseCashuBackupText,
  validateCashuMnemonic,
} from "./cashu-backup"

const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about"
const mints = ["https://mint.example.com", "https://mint.minibits.cash/Bitcoin"]

describe("cashu backup files", () => {
  it("creates and parses a Budabit Cashu backup file", () => {
    const text = createCashuBackupText({mnemonic, mints})
    const parsed = parseCashuBackupText(text)

    expect(parsed).toEqual({type: "plain", data: {mnemonic, mints}})
  })

  it("falls back to parsing a seed phrase from plain text", () => {
    const parsed = parseCashuBackupText(
      `Cashu words:\n\n${mnemonic}\n\nMint: https://mint.example.com.`,
    )

    expect(parsed).toEqual({
      type: "plain",
      data: {mnemonic, mints: ["https://mint.example.com"]},
    })
  })

  it("creates and decrypts an encrypted Budabit Cashu backup file", async () => {
    const text = await createEncryptedCashuBackupText({mnemonic, mints}, "correct horse battery")
    const parsed = parseCashuBackupText(text)

    expect(parsed.type).toBe("encrypted")
    if (parsed.type !== "encrypted") throw new Error("expected encrypted backup")

    await expect(
      decryptCashuBackupData(parsed.encrypted, "correct horse battery"),
    ).resolves.toEqual({
      mnemonic,
      mints,
    })
    await expect(decryptCashuBackupData(parsed.encrypted, "wrong horse battery")).rejects.toThrow()
  })

  it("rejects invalid seed phrases", () => {
    expect(() => validateCashuMnemonic("abandon abandon abandon")).toThrow(
      "valid Cashu seed phrase",
    )
  })

  it("reports files without a seed phrase", () => {
    expect(parseCashuBackupText("no wallet backup here")).toEqual({
      type: "none",
      reason: "No valid Cashu seed phrase was found in the selected file.",
    })
  })
})
