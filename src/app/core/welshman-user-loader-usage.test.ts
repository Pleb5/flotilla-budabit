import {readdirSync, readFileSync, statSync} from "node:fs"
import path from "node:path"
import {describe, expect, it} from "vitest"

const currentUserLoaders = [
  "forceLoadUserBlockedRelayList",
  "forceLoadUserBlossomServerList",
  "forceLoadUserFollowList",
  "forceLoadUserMessagingRelayList",
  "forceLoadUserMuteList",
  "forceLoadUserPinList",
  "forceLoadUserProfile",
  "forceLoadUserRelayList",
  "forceLoadUserSearchRelayList",
  "loadUserBlockedRelayList",
  "loadUserBlossomServerList",
  "loadUserFollowList",
  "loadUserMessagingRelayList",
  "loadUserMuteList",
  "loadUserPinList",
  "loadUserProfile",
  "loadUserRelayList",
  "loadUserSearchRelayList",
]

const sourceExtensions = new Set([".js", ".svelte", ".ts"])
const suspiciousPubkeyArgument =
  /\b(?:pubkey|Pubkey|profile|Profile|recipient|Recipient|author|Author|user|User|pk|PK)\b/
const hexPubkeyLiteral = /^["'`][0-9a-f]{64}["'`]$/i

const getSourceFiles = (directory: string): string[] =>
  readdirSync(directory).flatMap(name => {
    const filePath = path.join(directory, name)
    const stats = statSync(filePath)

    if (stats.isDirectory()) return getSourceFiles(filePath)
    if (!sourceExtensions.has(path.extname(filePath))) return []
    if (/\.test\.[tj]s$/.test(filePath)) return []

    return [filePath]
  })

describe("Welshman current-user loader usage", () => {
  it("does not pass pubkeys to loadUser/forceLoadUser helpers", () => {
    const sourceRoot = path.resolve(process.cwd(), "src")
    const callPattern = new RegExp(
      `\\b(${currentUserLoaders.join("|")})\\s*\\(\\s*([^),\\n]*)`,
      "g",
    )
    const violations: string[] = []

    for (const filePath of getSourceFiles(sourceRoot)) {
      const source = readFileSync(filePath, "utf8")

      for (const match of source.matchAll(callPattern)) {
        const argument = (match[2] || "").trim()
        if (!argument) continue
        if (!suspiciousPubkeyArgument.test(argument) && !hexPubkeyLiteral.test(argument)) continue

        violations.push(`${path.relative(process.cwd(), filePath)}: ${match[1]}(${argument})`)
      }
    }

    expect(violations).toEqual([])
  })
})
