import {normalizeUrl, uniq} from "@welshman/lib"
import {buildBlobUrl, getTagValues} from "@welshman/util"
import type {BlossomUploadRecord} from "@app/core/blossom"

const SHA256_HEX_RE = /[0-9a-f]{64}/

export type BlossomFallbackSource =
  | "original"
  | "mirror"
  | "community"
  | "author"
  | "last-resort"

export type BlossomFallbackTarget = {
  server: string
  url: string
  source: BlossomFallbackSource
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

const getServerFromUrl = (url: string | undefined | null) => {
  if (!url) return ""

  try {
    return new URL(url).origin
  } catch {
    return ""
  }
}

const normalizeFallbackUrl = (url: string | undefined | null) => {
  if (!url) return ""

  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return ""

    return parsed.toString()
  } catch {
    return ""
  }
}

export const getBlossomMirrorUrlsFromUploads = ({
  hash,
  uploads = [],
}: {
  hash: string
  uploads?: BlossomUploadRecord[]
}) => {
  const normalizedHash = hash.toLowerCase()

  return uniq(
    uploads
      .filter(upload => upload.canonical.sha256 === normalizedHash)
      .flatMap(upload => [
        upload.canonical.url,
        ...upload.mirrorJobs.flatMap(job =>
          job.status === "succeeded" ? [job.resultUrl, buildBlobUrl(job.targetUrl, normalizedHash)] : [],
        ),
      ])
      .map(normalizeFallbackUrl)
      .filter(Boolean),
  )
}

export const getBlossomFallbackTargets = ({
  hash,
  originalUrl,
  originalServers = [],
  mirrorUrls = [],
  mirrorServers = [],
  communityServers = [],
  authorServers = [],
  lastResortServers = [],
}: {
  hash: string
  originalUrl?: string
  originalServers?: string[]
  mirrorUrls?: string[]
  mirrorServers?: string[]
  communityServers?: string[]
  authorServers?: string[]
  lastResortServers?: string[]
}): BlossomFallbackTarget[] => {
  const targets: BlossomFallbackTarget[] = []
  const seen = new Set<string>()

  const addTarget = (source: BlossomFallbackSource, server: string, url: string) => {
    const normalizedUrl = normalizeFallbackUrl(url)
    if (!normalizedUrl || normalizedUrl === originalUrl || seen.has(normalizedUrl)) return

    seen.add(normalizedUrl)
    targets.push({server, url: normalizedUrl, source})
  }

  for (const url of mirrorUrls) {
    const server = getServerFromUrl(url)
    if (server) addTarget("mirror", server, url)
  }

  for (const [source, servers] of [
    ["original", originalServers],
    ["mirror", mirrorServers],
    ["community", communityServers],
    ["author", authorServers],
    ["last-resort", lastResortServers],
  ] as const) {
    for (const server of normalizeBlossomFallbackServers(servers)) {
      addTarget(source, server, buildBlobUrl(server, hash))
    }
  }

  return targets
}

export const getBlossomFallbackUrls = (options: Parameters<typeof getBlossomFallbackTargets>[0]) =>
  getBlossomFallbackTargets(options).map(target => target.url)
