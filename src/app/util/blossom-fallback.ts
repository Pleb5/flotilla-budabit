import {normalizeUrl, uniq} from "@welshman/lib"
import {buildBlobUrl, getTagValues} from "@welshman/util"

const SHA256_HEX_RE = /[0-9a-f]{64}/

export type BlossomFallbackTarget = {
  server: string
  url: string
  source: "original" | "community" | "author"
}

export const extractSha256FromUrl = (url: string) => {
  const getFilename = (value: string) => value.split(/[?#]/, 1)[0].split("/").at(-1) || ""

  try {
    return new URL(url).pathname.split("/").at(-1)?.match(SHA256_HEX_RE)?.[0] || ""
  } catch {
    return getFilename(url).match(SHA256_HEX_RE)?.[0] || ""
  }
}

export const normalizeBlossomFallbackServers = (servers: Array<string | undefined | null>) =>
  uniq(
    servers
      .flatMap(server => (server ? [server] : []))
      .map(server => {
        try {
          const value = server.trim()
          if (!/^(https?|wss?):\/\//i.test(value)) return ""

          const normalized = normalizeUrl(value.replace(/^ws/i, "http"))
          const url = new URL(normalized)

          return url.protocol === "http:" || url.protocol === "https:" ? url.origin : ""
        } catch {
          return ""
        }
      })
      .filter(Boolean),
  )

export const getBlossomServersFromList = (list?: {
  publicTags?: string[][]
  privateTags?: string[][]
}) =>
  normalizeBlossomFallbackServers(
    getTagValues("server", [...(list?.publicTags || []), ...(list?.privateTags || [])]),
  )

export const getBlossomFallbackTargets = ({
  hash,
  originalUrl,
  originalServers = [],
  communityServers = [],
  authorServers = [],
}: {
  hash: string
  originalUrl?: string
  originalServers?: string[]
  communityServers?: string[]
  authorServers?: string[]
}): BlossomFallbackTarget[] => {
  const targets: BlossomFallbackTarget[] = []
  const seen = new Set<string>()

  for (const [source, servers] of [
    ["original", originalServers],
    ["community", communityServers],
    ["author", authorServers],
  ] as const) {
    for (const server of normalizeBlossomFallbackServers(servers)) {
      const url = buildBlobUrl(server, hash)
      if (url === originalUrl || seen.has(url)) continue

      seen.add(url)
      targets.push({server, url, source})
    }
  }

  return targets
}

export const getBlossomFallbackUrls = (options: Parameters<typeof getBlossomFallbackTargets>[0]) =>
  getBlossomFallbackTargets(options).map(target => target.url)
