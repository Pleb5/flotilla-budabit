import {now} from "@welshman/lib"
import {BLOSSOM_AUTH, makeEvent} from "@welshman/util"

export type BudabitBlossomAuthAction = "get" | "upload" | "list" | "delete" | "media"

export type BudabitBlossomAuthOptions = {
  action: BudabitBlossomAuthAction
  server?: string
  hashes?: string[]
  expiration?: number
  content?: string
}

export const getBudabitBlossomAuthServerDomain = (server?: string) => {
  if (!server?.trim()) return ""

  try {
    return new URL(server.trim().replace(/^ws/i, "http")).hostname.toLowerCase()
  } catch {
    return ""
  }
}

export const makeBudabitBlossomAuthEvent = ({
  action,
  server,
  hashes = [],
  expiration = now() + 60,
  content,
}: BudabitBlossomAuthOptions) => {
  const domain = getBudabitBlossomAuthServerDomain(server)
  const tags: string[][] = [
    ["t", action],
    ["expiration", expiration.toString()],
  ]

  if (domain) {
    tags.push(["server", domain])
  }

  for (const hash of hashes) {
    if (hash) tags.push(["x", hash.toLowerCase()])
  }

  return makeEvent(BLOSSOM_AUTH, {
    content: content || `Authorization for ${action}${domain ? ` at ${domain}` : ""}`,
    tags,
  })
}

const encodeBase64Url = (value: string) => {
  const bytes = new TextEncoder().encode(value)
  let binary = ""

  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }

  const base64 =
    typeof btoa === "function"
      ? btoa(binary)
      : (globalThis as any).Buffer.from(bytes).toString("base64")

  return base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "")
}

export const makeBudabitBlossomAuthHeader = (event: unknown) =>
  `Nostr ${encodeBase64Url(JSON.stringify(event))}`
