import {isGraspRepoHttpUrl, resolveCorsProxyForUrl} from "./grasp-url.js"

export type AdvertisedServerRef = {
  ref?: string
  oid?: string
  target?: string
  symref?: string
  value?: string
}

export type AdvertisedRefsSummary = {
  refs: AdvertisedServerRef[]
  branches: string[]
  tags: string[]
  headBranch: string | null
  hasRemoteHead: boolean
}

const normalizeHeadRef = (value: unknown): string => {
  const raw = String(value || "")
  return raw.startsWith("ref: ") ? raw.slice("ref: ".length) : raw
}

export const parseAdvertisedHeadBranch = (refs: AdvertisedServerRef[]): string | null => {
  const headEntry = refs.find(ref => String(ref?.ref || "") === "HEAD")
  const directCandidates = [headEntry?.target, headEntry?.symref, headEntry?.value]

  for (const candidate of directCandidates) {
    const normalized = normalizeHeadRef(candidate)
    if (normalized.startsWith("refs/heads/")) {
      return normalized.slice("refs/heads/".length)
    }
  }

  const headOid = String(headEntry?.oid || "")
  if (!headOid) return null

  const matchingBranches = refs
    .filter(ref => String(ref?.ref || "").startsWith("refs/heads/"))
    .filter(ref => String(ref?.oid || "") === headOid)
    .map(ref => String(ref.ref).slice("refs/heads/".length))

  return matchingBranches.length === 1 ? matchingBranches[0] : null
}

export const summarizeAdvertisedRefs = (refs: AdvertisedServerRef[]): AdvertisedRefsSummary => {
  const branches = Array.from(
    new Set(
      refs
        .map(ref => String(ref?.ref || ""))
        .filter(ref => ref.startsWith("refs/heads/"))
        .map(ref => ref.slice("refs/heads/".length))
        .filter(Boolean),
    ),
  )

  const tags = Array.from(
    new Set(
      refs
        .map(ref => String(ref?.ref || ""))
        .filter(ref => ref.startsWith("refs/tags/"))
        .map(ref => ref.slice("refs/tags/".length))
        .filter(name => Boolean(name && !name.endsWith("^{}"))),
    ),
  )

  const headBranch = parseAdvertisedHeadBranch(refs)

  return {
    refs,
    branches,
    tags,
    headBranch,
    hasRemoteHead: Boolean(headBranch),
  }
}

export const buildAdvertisedBranchCandidates = ({
  requestedBranch,
  headBranch,
  branches = [],
  fallbackBranches = ["main", "master", "develop", "dev"],
}: {
  requestedBranch?: string | null
  headBranch?: string | null
  branches?: string[]
  fallbackBranches?: string[]
}): string[] =>
  Array.from(
    new Set(
      [requestedBranch, headBranch, ...branches, ...fallbackBranches]
        .map(branch => String(branch || "").trim())
        .filter(Boolean),
    ),
  )

const parsePktLines = (text: string): string[] => {
  const packets: string[] = []
  let offset = 0

  while (offset + 4 <= text.length) {
    const lengthHex = text.slice(offset, offset + 4)
    const length = Number.parseInt(lengthHex, 16)
    if (Number.isNaN(length)) break
    offset += 4

    if (length === 0) continue
    if (length < 4) break

    const payloadLength = length - 4
    packets.push(text.slice(offset, offset + payloadLength))
    offset += payloadLength
  }

  return packets
}

const parseGitUploadPackAdvertisement = (text: string): AdvertisedServerRef[] => {
  const refs: AdvertisedServerRef[] = []
  const symrefs = new Map<string, string>()

  for (const packet of parsePktLines(text)) {
    if (!packet || packet.startsWith("# service=")) continue

    const [record, capabilitySegment = ""] = packet.split("\0", 2)
    const trimmedRecord = record.replace(/\n$/, "")
    const separatorIndex = trimmedRecord.indexOf(" ")
    if (separatorIndex <= 0) continue

    const oid = trimmedRecord.slice(0, separatorIndex)
    const ref = trimmedRecord.slice(separatorIndex + 1).trim()
    if (!ref) continue

    refs.push({ref, oid})

    for (const capability of capabilitySegment.trim().split(/\s+/).filter(Boolean)) {
      if (!capability.startsWith("symref=")) continue
      const mapping = capability.slice("symref=".length)
      const separator = mapping.indexOf(":")
      if (separator <= 0) continue
      symrefs.set(mapping.slice(0, separator), mapping.slice(separator + 1))
    }
  }

  for (const [from, to] of symrefs.entries()) {
    const target = refs.find(ref => ref.ref === to)
    const existing = refs.find(ref => ref.ref === from)
    const next = {
      ref: from,
      oid: existing?.oid || target?.oid,
      symref: to,
      target: to,
      value: `ref: ${to}`,
    }

    if (existing) {
      Object.assign(existing, next)
    } else {
      refs.unshift(next)
    }
  }

  return refs
}

const buildInfoRefsUrl = (url: string): string =>
  `${String(url || "").replace(/\/+$/, "")}/info/refs?service=git-upload-pack`

const buildCorsProxyUrl = (url: string, corsProxy: string): string =>
  `${corsProxy.replace(/\/+$/, "")}/${url.replace(/^https?:\/\//i, "")}`

const fetchAdvertisedRefsText = async (url: string, corsProxy?: string | null): Promise<string> => {
  const infoRefsUrl = buildInfoRefsUrl(url)
  const attempts = [infoRefsUrl]
  if (corsProxy) attempts.push(buildCorsProxyUrl(infoRefsUrl, corsProxy))

  const failures: string[] = []

  for (const attemptUrl of attempts) {
    try {
      const response = await fetch(attemptUrl, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
      })

      if (!response.ok) {
        failures.push(`${attemptUrl}: ${response.status} ${response.statusText}`)
        continue
      }

      return await response.text()
    } catch (error) {
      failures.push(`${attemptUrl}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw new Error(`Failed to fetch advertised refs: ${failures.join("; ")}`)
}

const filterAdvertisedRefs = (
  refs: AdvertisedServerRef[],
  opts: {prefix?: string; symrefs?: boolean},
): AdvertisedServerRef[] =>
  refs.filter(ref => {
    const refName = String(ref?.ref || "")
    if (!refName) return false
    if (refName === "HEAD") return Boolean(opts.symrefs)
    if (!opts.prefix) return true
    return refName.startsWith(opts.prefix)
  })

export async function listAdvertisedServerRefs(
  git: any,
  opts: {url: string; prefix?: string; symrefs?: boolean; onAuth?: any; corsProxy?: string | null},
): Promise<AdvertisedServerRef[]> {
  if (isGraspRepoHttpUrl(opts.url)) {
    const body = await fetchAdvertisedRefsText(opts.url, opts.corsProxy)
    return filterAdvertisedRefs(parseGitUploadPackAdvertisement(body), opts)
  }

  if (typeof git?.listServerRefs !== "function") {
    return []
  }

  const corsProxy = resolveCorsProxyForUrl(opts.url, opts.corsProxy)

  const refs = await git.listServerRefs({
    url: opts.url,
    prefix: opts.prefix,
    symrefs: opts.symrefs,
    ...(opts.onAuth ? {onAuth: opts.onAuth} : {}),
    ...(corsProxy !== undefined ? {corsProxy} : {}),
  })

  return Array.isArray(refs) ? refs : []
}

export async function discoverAdvertisedRefs(
  git: any,
  opts: {url: string; onAuth?: any; corsProxy?: string | null},
): Promise<AdvertisedRefsSummary> {
  const refs = await listAdvertisedServerRefs(git, {
    url: opts.url,
    symrefs: true,
    onAuth: opts.onAuth,
    corsProxy: opts.corsProxy,
  })

  return summarizeAdvertisedRefs(refs)
}
