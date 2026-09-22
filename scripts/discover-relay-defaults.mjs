#!/usr/bin/env node

import {readFile, mkdir, writeFile} from "node:fs/promises"
import path from "node:path"
import process from "node:process"
import {pathToFileURL} from "node:url"
import {parseArgs} from "node:util"
import {parse as parseDotenv} from "dotenv"
import {verifyEvent} from "nostr-tools"
import * as nip19 from "nostr-tools/nip19"
import {schnorr} from "@noble/curves/secp256k1"
import {auditRelayWrites, parseWriteAuditEvents} from "./relay-write-audit.mjs"

export const DEFAULT_SEED = "npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw"
export const DEFAULT_BOOTSTRAP_RELAYS = ["wss://nos.lol/", "wss://purplepag.es/"]
export const COMMUNITY_DEFINITION_KIND = 32222
export const PROFILE_LIST_KIND = 30000
export const DEFAULT_OUTPUT_DIR = "relay-discovery-output"

const ROLE_NAMES = ["indexer", "search", "git", "widget", "signer", "blossom"]
const AUTHOR_LIST_KINDS = [0, 10002, 10007, 10019, 10050, 10063, 10317, 30078, 30617, 30033, 30222]
const INDEXER_REFERENCE_KINDS = new Set([
  0, 3, 10000, 10002, 10007, 10019, 10050, 10063, 10317, 30000, 32222,
])
const GIT_REFERENCE_KINDS = new Set([10317, 30078, 30617, 30618])
const WIDGET_REFERENCE_KINDS = new Set([5, 30033, 30222])
const SOURCE_POLICY = {
  community_definition: {priority: 5, score: 100, label: "community definition"},
  seed_own: {priority: 4, score: 90, label: "seed's own list"},
  community_owner: {priority: 3, score: 80, label: "community owner list"},
  moderator: {priority: 3, score: 32, label: "community moderator list"},
  member: {priority: 3, score: 18, label: "community member list"},
  default_community_fallback: {priority: 2, score: 36, label: "default community hint"},
  direct_follow: {priority: 1, score: 8, label: "direct follow list"},
  observed: {priority: 0, score: 1, label: "observed event relay"},
  configured: {priority: 0, score: 0, label: "currently configured"},
}

const HELP = `Discover community-first relay candidates for Budabit VITE defaults.

Usage:
  pnpm discover:relay-defaults -- [npub ...] [options]
  node scripts/discover-relay-defaults.mjs [npub ...] [options]

Seeds:
  Positional npubs or repeatable --seed values. If omitted, defaults to:
  ${DEFAULT_SEED}

Options:
  --seed <npub>                 Add a seed (repeatable)
  --bootstrap-relay <wss>      Add a discovery relay (repeatable)
  --default-community <input>  Override VITE_DEFAULT_COMMUNITY
  --no-default-community       Ignore VITE_DEFAULT_COMMUNITY
  --env-file <path>            Read current defaults from this file (default: .env)
  --role <name[,name]>         Roles to evaluate (repeatable)
  --signer-relay <wss>         Signer relay to health-check (repeatable)
  --probe <none|quick|standard> Probe depth (default: standard)
  --timeout-ms <number>        Per-request timeout (default: 7000)
  --concurrency <number>       Concurrent relay requests (default: 6)
  --max-follows <number>       Direct follows per seed (default: 250)
  --max-authors <number>       Authors per seed graph (default: 500)
  --max-candidates <number>    Candidates probed per role (default: 20)
  --max-discovery-relays <n>   Outbox relays used in pass two (default: 30)
  --output-dir <path>          Output directory (default: ${DEFAULT_OUTPUT_DIR})
  --evidence-file <path>       Evidence JSON path
  --table-file <path>          Recommendation Markdown path
  --progress <text|ndjson|none> Progress format on stderr (default: text)
  --strict                     Exit non-zero when discovery is partial
  --write-audit-events <jsonl>  Opt in: replay signed 32222 and 30222 samples
  --write-account <alias>      Active nak-account alias for the write audit
  --write-relay <wss>          Restrict audit destinations (repeatable)
  --help                       Show this help

Read-only by default. The optional write audit publishes existing samples to
configured and shortlisted indexer/Git/widget relays, including community relays.
It never edits .env or application code. Signer-only relays are not write targets.
`

const unique = values => Array.from(new Set(values.filter(Boolean)))
const chunk = (values, size) => {
  const result = []
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size))
  }
  return result
}
const clampNumber = (value, fallback, min, max) => {
  const parsed = Number.parseInt(String(value ?? ""), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

export const normalizePubkey = value => {
  const trimmed = String(value || "").trim()
  if (/^[0-9a-f]{64}$/i.test(trimmed)) return trimmed.toLowerCase()
  if (!trimmed.startsWith("npub") && !trimmed.startsWith("nprofile")) return ""

  try {
    const decoded = nip19.decode(trimmed)
    if (decoded.type === "npub" && typeof decoded.data === "string") {
      return decoded.data.toLowerCase()
    }
    if (decoded.type === "nprofile" && typeof decoded.data?.pubkey === "string") {
      return decoded.data.pubkey.toLowerCase()
    }
  } catch {
    return ""
  }

  return ""
}

export const normalizeRelayUrl = value => {
  try {
    const url = new URL(String(value || "").trim())
    if (url.protocol !== "wss:" && url.protocol !== "ws:") return ""
    if (!url.hostname || url.username || url.password || url.hash) return ""
    url.hash = ""
    return url.toString()
  } catch {
    return ""
  }
}

export const normalizeBlossomUrl = value => {
  try {
    const url = new URL(String(value || "").trim())
    if (url.protocol !== "https:" && url.protocol !== "http:") return ""
    if (!url.hostname || url.username || url.password || url.hash) return ""
    url.hash = ""
    url.search = ""
    return url.toString().replace(/\/+$/, "")
  } catch {
    return ""
  }
}

const normalizeCommunityRelayUrl = value => {
  const relay = normalizeRelayUrl(value)
  if (
    !relay ||
    !String(value || "")
      .trim()
      .startsWith("wss://")
  )
    return ""
  return relay.endsWith("/") && new URL(relay).pathname === "/" ? relay.slice(0, -1) : relay
}

export const parseCommunityInput = value => {
  const trimmed = String(value || "").trim()
  if (!trimmed) return undefined

  try {
    const decoded = nip19.decode(trimmed.replace(/^nostr:/, ""))
    if (decoded.type !== "naddr" || decoded.data.kind !== COMMUNITY_DEFINITION_KIND) {
      return undefined
    }
    const ownerPubkey = String(decoded.data.pubkey || "")
    const communityId = String(decoded.data.identifier || "")
    if (!isLiftableXOnlyKey(ownerPubkey) || !isLiftableXOnlyKey(communityId)) return undefined
    return {
      input: trimmed,
      address: `${COMMUNITY_DEFINITION_KIND}:${ownerPubkey}:${communityId}`,
      ownerPubkey,
      communityId,
      relays: unique((decoded.data.relays || []).map(normalizeCommunityRelayUrl)).slice(0, 3),
      source: "naddr",
    }
  } catch {
    return undefined
  }
}

const isLiftableXOnlyKey = value => {
  if (!/^[0-9a-f]{64}$/.test(value)) return false
  try {
    schnorr.utils.lift_x(BigInt(`0x${value}`))
    return true
  } catch {
    return false
  }
}

const parseCsv = value =>
  unique(
    String(value || "")
      .split(/[,;]/)
      .map(item => item.trim()),
  )

const readEnv = async file => {
  try {
    return parseDotenv(await readFile(file))
  } catch (error) {
    if (error?.code === "ENOENT") return {}
    throw error
  }
}

export const parseCli = argv => {
  const normalizedArgs = argv[0] === "--" ? argv.slice(1) : argv
  const {values, positionals} = parseArgs({
    args: normalizedArgs,
    allowPositionals: true,
    options: {
      seed: {type: "string", multiple: true},
      "bootstrap-relay": {type: "string", multiple: true},
      "default-community": {type: "string"},
      "no-default-community": {type: "boolean"},
      "env-file": {type: "string", default: ".env"},
      role: {type: "string", multiple: true},
      "signer-relay": {type: "string", multiple: true},
      probe: {type: "string", default: "standard"},
      "timeout-ms": {type: "string"},
      concurrency: {type: "string"},
      "max-follows": {type: "string"},
      "max-authors": {type: "string"},
      "max-candidates": {type: "string"},
      "max-discovery-relays": {type: "string"},
      "output-dir": {type: "string", default: DEFAULT_OUTPUT_DIR},
      "evidence-file": {type: "string"},
      "table-file": {type: "string"},
      progress: {type: "string", default: "text"},
      strict: {type: "boolean"},
      "write-audit-events": {type: "string"},
      "write-account": {type: "string"},
      "write-relay": {type: "string", multiple: true},
      help: {type: "boolean", short: "h"},
    },
  })

  const seedPositionals = positionals.filter(value => value !== "--")
  const seeds = unique([...seedPositionals, ...(values.seed || [])].map(normalizePubkey))
  const rawSeedCount = (values.seed || []).length + seedPositionals.length
  if (rawSeedCount > 0 && seeds.length !== rawSeedCount) {
    throw new Error("Every seed must be a valid npub, nprofile, or 64-character hex pubkey")
  }

  const roles = unique(
    (values.role || ROLE_NAMES).flatMap(value =>
      String(value)
        .split(",")
        .map(item => item.trim()),
    ),
  )
  const invalidRole = roles.find(role => !ROLE_NAMES.includes(role))
  if (invalidRole) throw new Error(`Unknown role '${invalidRole}'`)
  if (!["none", "quick", "standard"].includes(values.probe)) {
    throw new Error("--probe must be none, quick, or standard")
  }
  if (!["text", "ndjson", "none"].includes(values.progress)) {
    throw new Error("--progress must be text, ndjson, or none")
  }

  const outputDir = path.resolve(values["output-dir"])
  if (Boolean(values["write-audit-events"]) !== Boolean(values["write-account"])) {
    throw new Error("--write-audit-events and --write-account must be supplied together")
  }
  if (values["write-account"] && !/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(values["write-account"])) {
    throw new Error("Invalid --write-account alias")
  }
  const writeRelays = (values["write-relay"] || []).map(normalizeRelayUrl)
  if (writeRelays.some(relay => !relay) || (writeRelays.length && !values["write-audit-events"])) {
    throw new Error("--write-relay requires valid relay URLs and --write-audit-events")
  }
  return {
    help: Boolean(values.help),
    seeds: seeds.length ? seeds : [normalizePubkey(DEFAULT_SEED)],
    bootstrapRelays: unique((values["bootstrap-relay"] || []).map(normalizeRelayUrl)),
    defaultCommunityInput: values["default-community"],
    noDefaultCommunity: Boolean(values["no-default-community"]),
    envFile: path.resolve(values["env-file"]),
    roles,
    signerRelays: unique((values["signer-relay"] || []).map(normalizeRelayUrl)),
    probe: values.probe,
    timeoutMs: clampNumber(values["timeout-ms"], 7_000, 500, 60_000),
    concurrency: clampNumber(values.concurrency, 6, 1, 32),
    maxFollows: clampNumber(values["max-follows"], 250, 0, 2_000),
    maxAuthors: clampNumber(values["max-authors"], 500, 1, 5_000),
    maxCandidates: clampNumber(values["max-candidates"], 20, 1, 100),
    maxDiscoveryRelays: clampNumber(values["max-discovery-relays"], 30, 1, 100),
    outputDir,
    evidenceFile: path.resolve(values["evidence-file"] || path.join(outputDir, "evidence.json")),
    tableFile: path.resolve(values["table-file"] || path.join(outputDir, "recommendations.md")),
    progress: values.progress,
    strict: Boolean(values.strict),
    writeAuditEvents: values["write-audit-events"]
      ? path.resolve(values["write-audit-events"])
      : undefined,
    writeAccount: values["write-account"],
    writeRelays: unique(writeRelays),
  }
}

export const makeProgressLogger = (mode, writer = message => process.stderr.write(message)) => {
  let sequence = 0
  return (phase, message, detail = {}) => {
    if (mode === "none") return
    sequence += 1
    const update = {sequence, at: new Date().toISOString(), phase, message, ...detail}
    if (mode === "ndjson") {
      writer(`${JSON.stringify(update)}\n`)
      return
    }
    const suffix = Object.keys(detail).length ? ` ${JSON.stringify(detail)}` : ""
    writer(`[relay-discovery] ${phase}: ${message}${suffix}\n`)
  }
}

const eventAddress = event => {
  const identifier = event.tags?.find(tag => tag[0] === "d")?.[1] || ""
  return identifier ? `${event.kind}:${event.pubkey}:${identifier}` : ""
}

const isPreferredEvent = (candidate, current) =>
  !current ||
  candidate.created_at > current.created_at ||
  (candidate.created_at === current.created_at && candidate.id < current.id)

export const selectLatestEvents = events => {
  const latest = new Map()
  const regular = new Map()
  for (const event of events) {
    let key = ""
    if (event.kind === 0 || event.kind === 3 || (event.kind >= 10000 && event.kind < 20000)) {
      key = `${event.kind}:${event.pubkey}`
    } else if (event.kind >= 30000 && event.kind < 40000) {
      key = eventAddress(event)
    }

    if (!key) {
      if (event.id) regular.set(event.id, event)
      continue
    }
    const current = latest.get(key)
    if (isPreferredEvent(event, current)) latest.set(key, event)
  }
  return [...latest.values(), ...regular.values()].sort(
    (a, b) => a.created_at - b.created_at || a.id.localeCompare(b.id),
  )
}

const verifyNostrEvent = event => {
  try {
    return Boolean(event?.id && verifyEvent(event))
  } catch {
    return false
  }
}

const mergeEvents = (...groups) => {
  const byId = new Map()
  for (const event of groups.flat()) {
    if (event?.id && verifyNostrEvent(event)) byId.set(event.id, event)
  }
  return Array.from(byId.values())
}

const randomSubscriptionId = () => `budabit-${crypto.randomUUID().slice(0, 18)}`

export const queryRelay = (url, filters, {timeoutMs = 7_000} = {}) =>
  new Promise(resolve => {
    const startedAt = Date.now()
    const subscriptionId = randomSubscriptionId()
    const events = []
    const notices = []
    let socket
    let openedAt
    let firstEventAt
    let authRequested = false
    let closedReason = ""
    let settled = false

    const finish = status => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try {
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify(["CLOSE", subscriptionId]))
        }
        if (socket && socket.readyState < WebSocket.CLOSING) socket.close()
      } catch {
        // Ignore close failures after recording the useful result.
      }
      resolve({
        url,
        status,
        events,
        notices,
        authRequested,
        closedReason,
        connectMs: openedAt ? openedAt - startedAt : null,
        firstEventMs: firstEventAt ? firstEventAt - startedAt : null,
        totalMs: Date.now() - startedAt,
      })
    }

    const timer = setTimeout(() => finish("timeout"), timeoutMs)
    try {
      socket = new WebSocket(url)
    } catch (error) {
      closedReason = error instanceof Error ? error.message : String(error)
      finish("error")
      return
    }

    socket.addEventListener("open", () => {
      if (settled) {
        socket.close()
        return
      }
      openedAt = Date.now()
      socket.send(JSON.stringify(["REQ", subscriptionId, ...filters]))
    })
    socket.addEventListener("message", messageEvent => {
      if (settled) return
      let message
      try {
        message = JSON.parse(String(messageEvent.data))
      } catch {
        return
      }
      if (!Array.isArray(message)) return
      if (message[0] === "EVENT" && message[1] === subscriptionId && verifyNostrEvent(message[2])) {
        if (!firstEventAt) firstEventAt = Date.now()
        events.push(message[2])
      } else if (message[0] === "EOSE" && message[1] === subscriptionId) {
        finish("eose")
      } else if (message[0] === "NOTICE") {
        notices.push(String(message[1] || ""))
      } else if (message[0] === "AUTH") {
        authRequested = true
      } else if (message[0] === "CLOSED" && message[1] === subscriptionId) {
        closedReason = String(message[2] || "")
        finish("closed")
      }
    })
    socket.addEventListener("error", () => {
      closedReason ||= "WebSocket error"
      finish("error")
    })
    socket.addEventListener("close", () => {
      if (!settled) finish(openedAt ? "disconnected" : "error")
    })
  })

const mapConcurrent = async (items, concurrency, worker) => {
  const results = new Array(items.length)
  let cursor = 0
  const runners = Array.from(
    {length: Math.min(concurrency, Math.max(items.length, 1))},
    async () => {
      while (cursor < items.length) {
        const index = cursor
        cursor += 1
        results[index] = await worker(items[index], index)
      }
    },
  )
  await Promise.all(runners)
  return results
}

const queryAcrossRelays = async ({relays, filters, timeoutMs, concurrency, progress, phase}) => {
  const filterChunks = chunk(filters, 10)
  const requests = relays.flatMap(relay => filterChunks.map(group => ({relay, filters: group})))
  let completed = 0
  const observations = await mapConcurrent(requests, concurrency, async request => {
    const result = await queryRelay(request.relay, request.filters, {timeoutMs})
    completed += 1
    if (completed === requests.length || completed % 10 === 0) {
      progress(phase, "relay queries completed", {completed, total: requests.length})
    }
    return result
  })
  return {
    events: mergeEvents(observations.flatMap(observation => observation.events)),
    observations,
  }
}

const parseProfile = event => {
  if (!event || event.kind !== 0) return {}
  try {
    return JSON.parse(event.content || "{}")
  } catch {
    return {}
  }
}

const parseProfileList = event => {
  if (!event || event.kind !== PROFILE_LIST_KIND) return {members: [], declined: false}
  const declined = event.tags?.some(tag => tag[0] === "status" && tag[1] === "declined")
  const identifier = event.tags?.find(tag => tag[0] === "d")?.[1] || ""
  const renunciation = identifier === "app/budabit/renounced-communities"
  return {
    members:
      declined || renunciation
        ? []
        : unique(
            event.tags?.filter(tag => tag[0] === "p").map(tag => normalizePubkey(tag[1])) || [],
          ),
    declined,
  }
}

export const parseCommunityDefinition = event => {
  if (!event || event.kind !== COMMUNITY_DEFINITION_KIND || event.content !== "") return undefined
  const ownerPubkey = String(event.pubkey || "")
  const dTags = (event.tags || []).filter(tag => tag[0] === "d")
  const nameTags = (event.tags || []).filter(tag => tag[0] === "name")
  if (
    !isLiftableXOnlyKey(ownerPubkey) ||
    dTags.length !== 1 ||
    dTags[0].length !== 2 ||
    !isLiftableXOnlyKey(dTags[0][1]) ||
    nameTags.length !== 1 ||
    nameTags[0].length !== 2 ||
    !String(nameTags[0][1] || "").trim()
  ) {
    return undefined
  }
  const communityId = dTags[0][1]
  const tags = event.tags || []
  const singletonTags = [
    "name",
    "description",
    "picture",
    "banner",
    "website",
    "location",
    "g",
    "tos",
  ]
  if (singletonTags.some(name => tags.filter(tag => tag[0] === name).length > 1)) return undefined
  if (tags.filter(tag => tag[0] === "r").length > 20) return undefined
  if (tags.filter(tag => tag[0] === "blossom").length > 20) return undefined
  if (tags.filter(tag => tag[0] === "grasp").length > 20) return undefined
  if (tags.filter(tag => tag[0] === "mint").length > 20) return undefined
  if (tags.filter(tag => tag[0] === "service").length > 50) return undefined

  for (const tag of tags) {
    if (
      ["d", "name", "description", "picture", "banner", "website", "location", "g"].includes(
        tag[0],
      ) &&
      tag.length !== 2
    )
      return undefined
    if (
      ["r", "grasp"].includes(tag[0]) &&
      (tag.length !== 2 || !String(tag[1] || "").startsWith("wss://") || !normalizeRelayUrl(tag[1]))
    )
      return undefined
    if (
      tag[0] === "blossom" &&
      (tag.length !== 2 ||
        !String(tag[1] || "").startsWith("https://") ||
        !normalizeBlossomUrl(tag[1]))
    )
      return undefined
    if (
      ["picture", "banner"].includes(tag[0]) &&
      (!String(tag[1] || "").startsWith("https://") || !normalizeBlossomUrl(tag[1]))
    )
      return undefined
    if (tag[0] === "website" && !normalizeBlossomUrl(tag[1])) return undefined
    if (tag[0] === "g" && !/^[0123456789bcdefghjkmnpqrstuvwxyz]{1,12}$/.test(tag[1] || ""))
      return undefined
    if (
      tag[0] === "mint" &&
      (![2, 3].includes(tag.length) ||
        !String(tag[1] || "").startsWith("https://") ||
        !normalizeBlossomUrl(tag[1]))
    )
      return undefined
    if (tag[0] === "tos") {
      const reference = String(tag[1] || "")
      const [referenceKind, referencePubkey, ...referenceIdentifier] = reference.split(":")
      const validAddress =
        /^(3[0-9]{4})$/.test(referenceKind) &&
        isLiftableXOnlyKey(referencePubkey || "") &&
        Boolean(referenceIdentifier.join(":"))
      if (
        ![2, 3].includes(tag.length) ||
        (!/^[0-9a-f]{64}$/.test(reference) && !validAddress) ||
        (tag[2] && (!String(tag[2]).startsWith("wss://") || !normalizeRelayUrl(tag[2])))
      )
        return undefined
    }
    if (tag[0] === "service") {
      const [name, pubkey, requestRelay, handlerAddress, handlerRelay] = tag.slice(1)
      const [handlerKind, handlerPubkey, ...handlerIdentifier] = String(handlerAddress || "").split(
        ":",
      )
      if (
        tag.length !== 6 ||
        !/^[a-z0-9][a-z0-9-]{0,31}$/.test(name || "") ||
        !isLiftableXOnlyKey(pubkey || "") ||
        !String(requestRelay || "").startsWith("wss://") ||
        !normalizeRelayUrl(requestRelay) ||
        !/^(3[0-9]{4})$/.test(handlerKind || "") ||
        !isLiftableXOnlyKey(handlerPubkey || "") ||
        !handlerIdentifier.join(":") ||
        !String(handlerRelay || "").startsWith("wss://") ||
        !normalizeRelayUrl(handlerRelay)
      )
        return undefined
    }
  }
  const definition = {
    event,
    address: `${COMMUNITY_DEFINITION_KIND}:${ownerPubkey}:${communityId}`,
    ownerPubkey,
    communityId,
    name: nameTags[0][1],
    relays: [],
    blossomServers: [],
    graspServers: [],
    mints: [],
    sections: [],
  }
  let currentSection
  const topLevelTags = new Set([
    "d",
    "name",
    "description",
    "picture",
    "banner",
    "website",
    "r",
    "blossom",
    "grasp",
    "mint",
    "location",
    "g",
    "tos",
    "service",
  ])
  const sectionNames = new Set()
  const sectionKinds = new Set()
  for (const tag of tags) {
    if (currentSection && topLevelTags.has(tag[0])) return undefined
    if (tag[0] === "content" && tag.length === 2 && tag[1]?.trim()) {
      const sectionName = tag[1].trim()
      const sectionKey = sectionName.replace(/[A-Z]/g, value => value.toLowerCase())
      if (sectionNames.has(sectionKey)) return undefined
      sectionNames.add(sectionKey)
      currentSection = {name: sectionName, kinds: [], profileLists: []}
      definition.sections.push(currentSection)
    } else if (tag[0] === "k" && currentSection) {
      if (![2, 3].includes(tag.length) || !/^(0|[1-9][0-9]*)$/.test(tag[1] || "")) return undefined
      const kind = Number(tag[1])
      const subtype = tag.length === 3 ? String(tag[2] || "") : ""
      if (kind > 65535 || (tag.length === 3 && (!subtype || Buffer.byteLength(subtype) > 64)))
        return undefined
      const kindKey = `${kind}:${subtype}`
      if (sectionKinds.has(kindKey)) return undefined
      sectionKinds.add(kindKey)
      currentSection.kinds.push(kind)
    } else if (tag[0] === "a" && currentSection) {
      if (![2, 3].includes(tag.length)) return undefined
      const [kind, owner, ...identifierParts] = String(tag[1] || "").split(":")
      const normalizedOwner = normalizePubkey(owner)
      const identifier = identifierParts.join(":")
      if (kind !== String(PROFILE_LIST_KIND) || !normalizedOwner || !identifier) return undefined
      currentSection.profileLists.push({
        address: `${PROFILE_LIST_KIND}:${normalizedOwner}:${identifier}`,
        pubkey: normalizedOwner,
        identifier,
        relay: tag[2] ? normalizeRelayUrl(tag[2]) : "",
      })
      if (tag[2] && (!String(tag[2]).startsWith("wss://") || !normalizeRelayUrl(tag[2])))
        return undefined
    } else if (tag[0] === "badge" && currentSection) {
      if (![2, 3].includes(tag.length)) return undefined
      const [kind, owner, ...identifierParts] = String(tag[1] || "").split(":")
      if (
        kind !== "30009" ||
        !isLiftableXOnlyKey(owner || "") ||
        !identifierParts.join(":") ||
        (tag[2] && (!String(tag[2]).startsWith("wss://") || !normalizeRelayUrl(tag[2])))
      )
        return undefined
    } else if (tag[0] === "retention" && currentSection) {
      if (
        tag.length !== 4 ||
        !/^(0|[1-9][0-9]*)$/.test(tag[1] || "") ||
        Number(tag[1]) > 65535 ||
        !/^[1-9][0-9]*$/.test(tag[2] || "") ||
        !["time", "count"].includes(tag[3])
      )
        return undefined
    } else if (tag[0] === "r") {
      definition.relays.push(normalizeRelayUrl(tag[1]))
    } else if (tag[0] === "blossom") {
      definition.blossomServers.push(normalizeBlossomUrl(tag[1]))
    } else if (tag[0] === "grasp") {
      definition.graspServers.push(normalizeRelayUrl(tag[1]))
    } else if (tag[0] === "mint" && tag[1]) {
      definition.mints.push({url: normalizeBlossomUrl(tag[1]), type: tag[2] || undefined})
    }
  }
  definition.relays = unique(definition.relays)
  definition.blossomServers = unique(definition.blossomServers)
  definition.graspServers = unique(definition.graspServers)
  if (
    definition.relays.length === 0 ||
    definition.sections.length === 0 ||
    definition.sections.some(section => section.kinds.length === 0)
  ) {
    return undefined
  }
  return definition
}

export const selectCurrentCommunityDefinitions = events => {
  const definitions = events.map(parseCommunityDefinition).filter(Boolean)
  const byAddress = new Map()

  for (const definition of definitions) {
    const address = definition.address
    const addressDeletion = events
      .filter(event => {
        if (event.kind !== 5 || event.pubkey !== definition.ownerPubkey) return false
        const addresses = (event.tags || []).filter(tag => tag[0] === "a")
        return addresses.length === 1 && addresses[0].length === 2 && addresses[0][1] === address
      })
      .sort(
        (first, second) =>
          second.created_at - first.created_at || first.id.localeCompare(second.id),
      )[0]
    if (addressDeletion && definition.event.created_at <= addressDeletion.created_at) continue
    const eventDeleted = events.some(
      deletion =>
        deletion.kind === 5 &&
        deletion.pubkey === definition.ownerPubkey &&
        deletion.created_at >= definition.event.created_at &&
        (deletion.tags || []).some(
          tag => tag.length === 2 && tag[0] === "e" && tag[1] === definition.event.id,
        ),
    )
    if (eventDeleted) continue

    const current = byAddress.get(address)
    if (!current || isPreferredEvent(definition.event, current.event)) {
      byAddress.set(address, definition)
    }
  }

  return Array.from(byAddress.values()).sort((first, second) =>
    first.address.localeCompare(second.address),
  )
}

const latestByKindAndAuthor = (events, kind) => {
  const byAuthor = new Map()
  for (const event of events) {
    if (event.kind !== kind) continue
    const current = byAuthor.get(event.pubkey)
    if (isPreferredEvent(event, current)) byAuthor.set(event.pubkey, event)
  }
  return byAuthor
}

const latestByAddress = (events, kind) => {
  const byAddress = new Map()
  for (const event of events) {
    if (event.kind !== kind) continue
    const address = eventAddress(event)
    if (!address) continue
    const current = byAddress.get(address)
    if (isPreferredEvent(event, current)) byAddress.set(address, event)
  }
  return byAddress
}

const makeSeedFilters = seeds => [
  {
    kinds: [0, 3, 5, 10000, 10002, 10007, 10019, 10050, 10063, 10317, 30000, 32222],
    authors: seeds,
    limit: 1000,
  },
  ...seeds.map(seed => ({kinds: [PROFILE_LIST_KIND], "#p": [seed], limit: 200})),
]

const getDefinitionRefsFromProfileLists = events =>
  unique(
    events.flatMap(event =>
      (event.tags || [])
        .filter(
          tag => tag[0] === "a" && String(tag[1] || "").startsWith(`${COMMUNITY_DEFINITION_KIND}:`),
        )
        .map(tag => tag[1]),
    ),
  )

const getProfileListAddresses = events =>
  unique(events.filter(event => event.kind === PROFILE_LIST_KIND).map(eventAddress))

const getDefinitionProfileListRefs = definitions =>
  definitions.flatMap(definition => definition.sections.flatMap(section => section.profileLists))

const addRole = (roleMap, author, seed, role, communityAddress) => {
  if (!author) return
  const entry = roleMap.get(author) || {
    pubkey: author,
    seeds: new Map(),
    communities: new Map(),
    communitySeeds: new Map(),
  }
  const seedRoles = entry.seeds.get(seed) || new Set()
  seedRoles.add(role)
  entry.seeds.set(seed, seedRoles)
  if (communityAddress) {
    const communityRoles = entry.communities.get(communityAddress) || new Set()
    communityRoles.add(role)
    entry.communities.set(communityAddress, communityRoles)
    const communitySeedKey = `${communityAddress}:${seed}`
    const communitySeedRoles = entry.communitySeeds.get(communitySeedKey) || new Set()
    communitySeedRoles.add(role)
    entry.communitySeeds.set(communitySeedKey, communitySeedRoles)
  }
  roleMap.set(author, entry)
}

export const buildCommunityGraph = ({
  seeds,
  events,
  definitions,
  defaultCommunityAddress,
  maxFollows = 250,
  maxAuthors = 500,
}) => {
  const followLists = latestByKindAndAuthor(events, 3)
  const muteLists = latestByKindAndAuthor(events, 10000)
  const profileLists = latestByAddress(events, PROFILE_LIST_KIND)
  const relationships = new Map()
  const seedStates = []
  const defaultCommunityAuthors = []
  const activeDefinitionAddresses = new Set(
    defaultCommunityAddress ? [defaultCommunityAddress] : [],
  )

  for (const seed of seeds) {
    addRole(relationships, seed, seed, "seed")
    const follows = unique(
      (followLists.get(seed)?.tags || [])
        .filter(tag => tag[0] === "p")
        .map(tag => normalizePubkey(tag[1])),
    ).slice(0, maxFollows)
    const publicMutes = new Set(
      unique(
        (muteLists.get(seed)?.tags || [])
          .filter(tag => tag[0] === "p")
          .map(tag => normalizePubkey(tag[1])),
      ),
    )
    const activeCommunities = []
    const seedCommunityAddresses = new Set()

    for (const definition of definitions) {
      const roles = new Set()
      if (definition.ownerPubkey === seed) roles.add("admin")
      for (const section of definition.sections) {
        for (const ref of section.profileLists) {
          const listEvent = profileLists.get(ref.address)
          const list = parseProfileList(listEvent)
          if (ref.pubkey === seed) roles.add(listEvent && !list.declined ? "moderator" : "member")
          if (list.members.includes(seed)) roles.add("member")
        }
      }
      if (roles.size > 0) {
        activeDefinitionAddresses.add(definition.address)
        seedCommunityAddresses.add(definition.address)
        activeCommunities.push({
          communityAddress: definition.address,
          roles: Array.from(roles).sort(),
        })
      }
    }

    let authorOrder = [seed]
    for (const definition of definitions.filter(item => seedCommunityAddresses.has(item.address))) {
      authorOrder.push(definition.ownerPubkey)
      addRole(relationships, definition.ownerPubkey, seed, "community", definition.address)
      for (const section of definition.sections) {
        for (const ref of section.profileLists) {
          const listEvent = profileLists.get(ref.address)
          const list = parseProfileList(listEvent)
          if (listEvent && !list.declined) {
            authorOrder.push(ref.pubkey)
            addRole(relationships, ref.pubkey, seed, "moderator", definition.address)
          }
          for (const member of list.members) {
            authorOrder.push(member)
            addRole(relationships, member, seed, "member", definition.address)
          }
        }
      }
    }
    for (const followed of follows) {
      if (publicMutes.has(followed)) continue
      authorOrder.push(followed)
      addRole(relationships, followed, seed, "follow")
    }
    authorOrder = unique(authorOrder).slice(0, maxAuthors)
    seedStates.push({
      pubkey: seed,
      directFollows: follows,
      publicMutes: Array.from(publicMutes),
      activeCommunities,
      selectedAuthors: authorOrder,
    })
  }

  if (defaultCommunityAddress) {
    const definition = definitions.find(item => item.address === defaultCommunityAddress)
    if (definition) {
      defaultCommunityAuthors.push(definition.ownerPubkey)
      addRole(
        relationships,
        definition.ownerPubkey,
        "vite_default_community",
        "community",
        definition.address,
      )
      for (const section of definition.sections) {
        for (const ref of section.profileLists) {
          const listEvent = profileLists.get(ref.address)
          const list = parseProfileList(listEvent)
          if (listEvent && !list.declined) {
            defaultCommunityAuthors.push(ref.pubkey)
            addRole(
              relationships,
              ref.pubkey,
              "vite_default_community",
              "moderator",
              definition.address,
            )
          }
          for (const member of list.members) {
            defaultCommunityAuthors.push(member)
            addRole(relationships, member, "vite_default_community", "member", definition.address)
          }
        }
      }
    }
  }

  return {
    seedStates,
    activeDefinitionAddresses,
    relationships,
    authors: unique([
      ...seedStates.flatMap(state => state.selectedAuthors),
      ...unique(defaultCommunityAuthors).slice(0, maxAuthors),
    ]),
  }
}

const sourceForRelationship = (relationship, seed) => {
  const roles = relationship?.seeds.get(seed) || new Set()
  if (roles.has("seed")) return "seed_own"
  if (roles.has("community")) return "community_owner"
  if (roles.has("moderator")) return "moderator"
  if (roles.has("member")) return "member"
  if (roles.has("follow")) return "direct_follow"
  return ""
}

const makeCandidateStore = () => new Map()
const candidateKey = (role, url) => `${role}:${url}`

const addCandidateEvidence = (
  store,
  {role, url, source, seed, author, communityAddress, eventId, detail},
) => {
  const normalizedUrl = role === "blossom" ? normalizeBlossomUrl(url) : normalizeRelayUrl(url)
  const policy = SOURCE_POLICY[source]
  if (!normalizedUrl || !policy) return
  const key = candidateKey(role, normalizedUrl)
  const candidate = store.get(key) || {
    role,
    url: normalizedUrl,
    priority: 0,
    trustScore: 0,
    seeds: new Set(),
    communities: new Set(),
    authors: new Set(),
    evidence: [],
    configured: false,
  }
  const evidenceKey = [
    source,
    seed || "",
    author || "",
    communityAddress || "",
    eventId || "",
    detail || "",
  ].join(":")
  if (candidate.evidence.some(item => item.key === evidenceKey)) return
  candidate.priority = Math.max(candidate.priority, policy.priority)
  candidate.trustScore += policy.score
  if (seed && seed !== "vite_default_community") candidate.seeds.add(seed)
  if (communityAddress) candidate.communities.add(communityAddress)
  if (author) candidate.authors.add(author)
  candidate.configured ||= source === "configured"
  candidate.evidence.push({
    key: evidenceKey,
    source,
    label: policy.label,
    score: policy.score,
    priority: policy.priority,
    seed,
    author,
    communityAddress,
    eventId,
    detail,
  })
  store.set(key, candidate)
}

const getTagUrls = (event, tagNames, normalizer) =>
  unique((event.tags || []).filter(tag => tagNames.includes(tag[0])).map(tag => normalizer(tag[1])))

const addAuthorListEvidence = ({store, events, graph, seeds}) => {
  const latest = selectLatestEvents(events)
  for (const event of latest) {
    const relationship = graph.relationships.get(event.pubkey)
    if (!relationship) continue
    for (const seed of [...seeds, "vite_default_community"]) {
      const source = sourceForRelationship(relationship, seed)
      if (!source) continue
      const communityAddresses = ["community_owner", "moderator", "member"].includes(source)
        ? Array.from(relationship.communitySeeds.keys())
            .filter(key => key.endsWith(`:${seed}`))
            .map(key => key.slice(0, -(seed.length + 1)))
        : [undefined]
      const evidenceContexts = communityAddresses.length ? communityAddresses : [undefined]
      for (const communityAddress of evidenceContexts) {
        const common = {source, seed, author: event.pubkey, communityAddress, eventId: event.id}
        if (event.kind === 10002) {
          for (const url of getTagUrls(event, ["r"], normalizeRelayUrl)) {
            addCandidateEvidence(store, {role: "indexer", url, ...common})
            addCandidateEvidence(store, {role: "widget", url, ...common})
          }
        } else if (event.kind === 10007) {
          for (const url of getTagUrls(event, ["relay", "r"], normalizeRelayUrl)) {
            addCandidateEvidence(store, {role: "search", url, ...common})
          }
        } else if (event.kind === 10317) {
          for (const url of getTagUrls(event, ["g"], normalizeRelayUrl)) {
            addCandidateEvidence(store, {role: "git", url, ...common})
          }
        } else if (event.kind === 10063) {
          for (const url of getTagUrls(event, ["server"], normalizeBlossomUrl)) {
            addCandidateEvidence(store, {role: "blossom", url, ...common})
          }
        }
      }
    }
  }
}

const addDefinitionEvidence = ({store, definitions, defaultCommunity}) => {
  for (const definition of definitions) {
    const seed =
      definition.address === defaultCommunity?.address ? "vite_default_community" : undefined
    const common = {
      source: "community_definition",
      seed,
      author: definition.ownerPubkey,
      communityAddress: definition.address,
      eventId: definition.event.id,
    }
    for (const url of definition.relays) {
      addCandidateEvidence(store, {role: "indexer", url, ...common})
      addCandidateEvidence(store, {role: "widget", url, ...common})
    }
    for (const url of definition.graspServers) {
      addCandidateEvidence(store, {role: "git", url, ...common})
    }
    for (const url of definition.blossomServers) {
      addCandidateEvidence(store, {role: "blossom", url, ...common})
    }
  }
  if (
    defaultCommunity &&
    !definitions.some(definition => definition.address === defaultCommunity.address)
  ) {
    for (const url of defaultCommunity.relays) {
      addCandidateEvidence(store, {
        role: "indexer",
        url,
        source: "default_community_fallback",
        seed: "vite_default_community",
        communityAddress: defaultCommunity.address,
        detail: "unresolved definition naddr relay hint",
      })
    }
  }
}

const addConfiguredEvidence = ({store, env, cli}) => {
  const configured = {
    indexer: parseCsv(env.VITE_INDEXER_RELAYS).map(normalizeRelayUrl),
    git: parseCsv(env.VITE_GIT_RELAYS).map(normalizeRelayUrl),
    widget: parseCsv(env.VITE_SMART_WIDGET_RELAYS).map(normalizeRelayUrl),
    signer: unique(
      [...parseCsv(env.VITE_SIGNER_RELAYS), ...cli.signerRelays].map(normalizeRelayUrl),
    ),
    blossom: parseCsv(env.VITE_DEFAULT_BLOSSOM_SERVERS).map(normalizeBlossomUrl),
  }
  for (const [role, urls] of Object.entries(configured)) {
    for (const url of urls)
      addCandidateEvidence(store, {role, url, source: "configured", detail: cli.envFile})
  }
  return configured
}

const serializeCandidate = candidate => ({
  ...candidate,
  seeds: Array.from(candidate.seeds).sort(),
  communities: Array.from(candidate.communities).sort(),
  authors: Array.from(candidate.authors).sort(),
  evidence: candidate.evidence
    .map(({key: _key, ...item}) => item)
    .sort(
      (a, b) =>
        b.priority - a.priority ||
        b.score - a.score ||
        String(a.source).localeCompare(String(b.source)),
    ),
})

export const rankCandidates = candidates =>
  [...candidates].sort(
    (a, b) =>
      Number(Boolean(b.eligible)) - Number(Boolean(a.eligible)) ||
      b.priority - a.priority ||
      b.seeds.length - a.seeds.length ||
      b.communities.length - a.communities.length ||
      b.trustScore - a.trustScore ||
      (b.probe?.fitnessScore || 0) - (a.probe?.fitnessScore || 0) ||
      a.url.localeCompare(b.url),
  )

const nip11Url = relay => {
  const url = new URL(relay)
  url.protocol = url.protocol === "wss:" ? "https:" : "http:"
  return url.toString()
}

export const fetchNip11 = async (relay, timeoutMs) => {
  const startedAt = Date.now()
  try {
    const response = await fetch(nip11Url(relay), {
      headers: {Accept: "application/nostr+json"},
      signal: AbortSignal.timeout(timeoutMs),
    })
    const text = await response.text()
    let info
    try {
      info = JSON.parse(text)
    } catch {
      return {
        ok: false,
        status: response.status,
        latencyMs: Date.now() - startedAt,
        error: "invalid JSON",
      }
    }
    return {ok: response.ok, status: response.status, latencyMs: Date.now() - startedAt, info}
  } catch (error) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const sampleReferenceIds = (events, kinds, limit = 100) =>
  selectLatestEvents(events)
    .filter(event => kinds.has(event.kind))
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map(event => event.id)

const makeRelayProbe = ({relayResult, nip11, referenceIds}) => {
  const returnedIds = new Set(relayResult.events.map(event => event.id))
  const matched = referenceIds.filter(id => returnedIds.has(id)).length
  const reachable = ["eose", "closed", "disconnected"].includes(relayResult.status)
  const limitation = nip11.info?.limitation || {}
  const paymentRequired = limitation.payment_required === true
  const restrictedWrites = limitation.restricted_writes === true
  const authRequired = limitation.auth_required === true || relayResult.authRequested
  const coverage = referenceIds.length ? matched / referenceIds.length : 0
  const fitnessScore = Math.round(
    (reachable ? 40 : 0) +
      (nip11.ok ? 10 : 0) +
      coverage * 40 +
      (relayResult.totalMs < 1_000
        ? 10
        : relayResult.totalMs < 3_000
          ? 6
          : relayResult.totalMs < 7_000
            ? 2
            : 0) -
      (paymentRequired ? 50 : 0) -
      (restrictedWrites ? 10 : 0),
  )
  return {
    reachable,
    status: relayResult.status,
    connectMs: relayResult.connectMs,
    firstEventMs: relayResult.firstEventMs,
    totalMs: relayResult.totalMs,
    authRequired,
    paymentRequired,
    restrictedWrites,
    nip11,
    returnedEvents: relayResult.events.length,
    returnedKinds: unique(relayResult.events.map(event => event.kind)).sort((a, b) => a - b),
    referenceEvents: referenceIds.length,
    matchedReferenceEvents: matched,
    referenceCoverage: coverage,
    fitnessScore,
    writeStatus: paymentRequired
      ? "payment-required"
      : restrictedWrites
        ? "restricted-advertised"
        : "unverified",
    notices: relayResult.notices,
    closedReason: relayResult.closedReason,
  }
}

const probeRelayRole = async ({candidate, corpus, seedProfiles, timeoutMs, probeMode, nip11}) => {
  if (probeMode === "none") return {reachable: null, fitnessScore: 0, writeStatus: "unverified"}
  let filter
  let referenceKinds
  if (candidate.role === "indexer") referenceKinds = INDEXER_REFERENCE_KINDS
  else if (candidate.role === "git") referenceKinds = GIT_REFERENCE_KINDS
  else if (candidate.role === "widget") referenceKinds = WIDGET_REFERENCE_KINDS

  if (candidate.role === "search") {
    const profileName = Object.values(seedProfiles).find(
      profile => profile?.name || profile?.display_name,
    )
    const search = String(profileName?.name || profileName?.display_name || "budabit").trim()
    const result = await queryRelay(candidate.url, [{kinds: [0], search, limit: 20}], {timeoutMs})
    const probe = makeRelayProbe({relayResult: result, nip11, referenceIds: []})
    const advertisedNips = (nip11.info?.supported_nips || []).map(String)
    probe.search = search
    probe.advertisesNip50 = advertisedNips.includes("50")
    probe.searchResults = result.events.length
    probe.fitnessScore += result.events.length > 0 ? 30 : -20
    return probe
  }

  if (candidate.role === "signer") {
    const randomRecipient = crypto.randomUUID().replaceAll("-", "").padEnd(64, "0").slice(0, 64)
    const result = await queryRelay(
      candidate.url,
      [{kinds: [24133], "#p": [randomRecipient], limit: 1}],
      {timeoutMs},
    )
    return makeRelayProbe({relayResult: result, nip11, referenceIds: []})
  }

  const referenceIds = sampleReferenceIds(
    corpus,
    referenceKinds || new Set(),
    probeMode === "quick" ? 25 : 100,
  )
  filter = referenceIds.length
    ? {ids: referenceIds, limit: referenceIds.length}
    : {kinds: Array.from(referenceKinds || []), limit: probeMode === "quick" ? 25 : 100}
  const result = await queryRelay(candidate.url, [filter], {timeoutMs})
  return makeRelayProbe({relayResult: result, nip11, referenceIds})
}

export const probeBlossomServer = async (url, timeoutMs) => {
  const startedAt = Date.now()
  try {
    let response = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (response.status === 405) {
      response = await fetch(url, {
        method: "GET",
        redirect: "follow",
        signal: AbortSignal.timeout(timeoutMs),
      })
      await response.body?.cancel()
    }
    let options
    try {
      options = await fetch(`${url}/upload`, {
        method: "OPTIONS",
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch {
      options = undefined
    }
    const reachable = response.status < 500
    return {
      reachable,
      status: response.status,
      latencyMs: Date.now() - startedAt,
      corsOrigin:
        response.headers.get("access-control-allow-origin") ||
        options?.headers.get("access-control-allow-origin") ||
        "",
      uploadMethods: options?.headers.get("access-control-allow-methods") || "",
      fitnessScore:
        (reachable ? 60 : 0) + (options?.ok ? 20 : 0) + (Date.now() - startedAt < 2_000 ? 20 : 0),
      writeStatus: "unverified",
    }
  } catch (error) {
    return {
      reachable: false,
      latencyMs: Date.now() - startedAt,
      fitnessScore: 0,
      writeStatus: "unverified",
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

const candidateEligibility = candidate => {
  const probe = candidate.probe
  if (!probe || probe.reachable === null) return true
  if (candidate.role === "search") return probe.searchResults > 0
  if (!probe.reachable || probe.paymentRequired) return false
  return true
}

const recommendationStatus = candidate => {
  if (!candidate.eligible) return "rejected"
  if (
    candidate.probe?.writeStatus === "unverified" &&
    ["indexer", "git", "widget", "signer"].includes(candidate.role)
  ) {
    return "provisional"
  }
  return "eligible"
}

const selectRoleResults = (candidates, maxCandidates) => {
  const byRole = {}
  for (const role of ROLE_NAMES) {
    const ranked = rankCandidates(candidates.filter(candidate => candidate.role === role)).slice(
      0,
      maxCandidates,
    )
    byRole[role] = {
      recommended: ranked
        .filter(candidate => candidate.eligible)
        .slice(0, role === "signer" ? 3 : 5),
      alternates: ranked.filter(candidate => candidate.eligible).slice(role === "signer" ? 3 : 5),
      rejected: ranked.filter(candidate => !candidate.eligible),
    }
  }
  return byRole
}

const candidateSummary = candidate => ({
  rank: candidate.rank,
  url: candidate.url,
  status: recommendationStatus(candidate),
  sourcePriority: candidate.priority,
  trustScore: candidate.trustScore,
  seedCount: candidate.seeds.length,
  communityCount: candidate.communities.length,
  fitnessScore: candidate.probe?.fitnessScore ?? null,
  reachable: candidate.probe?.reachable ?? null,
  latencyMs: candidate.probe?.totalMs ?? candidate.probe?.latencyMs ?? null,
  coverage: candidate.probe?.referenceCoverage ?? null,
  writeStatus: candidate.probe?.writeStatus || "unverified",
  evidence: unique(candidate.evidence.map(item => item.label)),
})

const escapeTable = value =>
  String(value ?? "")
    .replaceAll("|", "\\|")
    .replaceAll("\n", " ")

export const renderRecommendationTable = evidence => {
  const lines = [
    "# Budabit Relay Default Recommendations",
    "",
    `Generated: ${evidence.generatedAt}`,
    "",
    `Seeds: ${evidence.inputs.seeds.map(seed => `\`${seed}\``).join(", ")}`,
    "",
  ]
  if (evidence.defaultCommunity?.pubkey) {
    lines.push(
      `Default community: \`${evidence.defaultCommunity.address}\` (${evidence.defaultCommunity.definitionResolved ? "resolved" : "unresolved"})`,
      "",
    )
  }
  lines.push(
    "> Discovery rankings describe relay roles. Write acceptance is provisional except for explicitly verified audit samples.",
    "",
  )

  for (const role of evidence.inputs.roles) {
    lines.push(`## ${role[0].toUpperCase()}${role.slice(1)}`, "")
    const candidates = [
      ...(evidence.roles[role]?.recommended || []),
      ...(evidence.roles[role]?.alternates || []),
      ...(evidence.roles[role]?.rejected || []),
    ]
    if (!candidates.length) {
      lines.push("No candidates discovered.", "")
      continue
    }
    lines.push(
      "| Rank | Candidate | Status | Priority | Trust | Seeds | Communities | Fitness | Latency | Coverage | Evidence |",
      "|---:|---|---|---:|---:|---:|---:|---:|---:|---:|---|",
    )
    for (const candidate of candidates) {
      const item = candidateSummary(candidate)
      lines.push(
        `| ${item.rank} | \`${escapeTable(item.url)}\` | ${item.status} | ${item.sourcePriority} | ${item.trustScore} | ${item.seedCount} | ${item.communityCount} | ${item.fitnessScore ?? "n/a"} | ${item.latencyMs ?? "n/a"} | ${item.coverage === null ? "n/a" : `${Math.round(item.coverage * 100)}%`} | ${escapeTable(item.evidence.join(", "))} |`,
      )
    }
    lines.push("")
  }

  if (evidence.writeAudit) {
    lines.push(
      "## Community write audit",
      "",
      `Checked: ${evidence.writeAudit.checkedAt}`,
      "",
      "Existing signed samples were replayed. Acceptance applies to these authors and payloads, not every event of the same kind.",
      "",
      "| Relay | Sources | Kind | ACK | Current readback | Detail |",
      "|---|---|---:|---|---|---|",
    )
    for (const row of evidence.writeAudit.rows) {
      const readback =
        row.readback.status === "eose"
          ? row.readback.currentEventId === row.eventId
            ? "exact current event"
            : row.readback.currentEventId
              ? "different current event"
              : "not found"
          : row.readback.status
      lines.push(
        `| \`${escapeTable(row.relay)}\` | ${escapeTable(row.sources.join(", "))} | ${row.kind} | ${row.ack} | ${escapeTable(readback)} | ${escapeTable(row.detail)} |`,
      )
    }
    lines.push("", "### Verified publication destinations by kind", "")
    for (const [kind, relays] of Object.entries(evidence.writeAudit.verifiedRelaysByKind)) {
      lines.push(
        `- Kind ${kind}: ${relays.length ? relays.map(relay => `\`${relay}\``).join(", ") : "none verified"}`,
      )
    }
    lines.push("")
  }
  lines.push("## Suggested Environment", "", "```env")
  for (const [name, value] of Object.entries(evidence.suggestedEnv)) lines.push(`${name}=${value}`)
  lines.push(
    "```",
    "",
    "Search candidates are advisory because Budabit currently has no VITE_SEARCH_RELAYS setting.",
    "",
  )
  if (evidence.warnings.length) {
    lines.push("## Warnings", "")
    for (const warning of evidence.warnings) lines.push(`- ${warning}`)
    lines.push("")
  }
  return `${lines.join("\n")}\n`
}

const serializeRelationship = relationship => ({
  pubkey: relationship.pubkey,
  seeds: Object.fromEntries(
    Array.from(relationship.seeds, ([seed, roles]) => [seed, Array.from(roles).sort()]),
  ),
  communities: Object.fromEntries(
    Array.from(relationship.communities, ([community, roles]) => [
      community,
      Array.from(roles).sort(),
    ]),
  ),
  communitySeeds: Object.fromEntries(
    Array.from(relationship.communitySeeds, ([key, roles]) => [key, Array.from(roles).sort()]),
  ),
})

const getSuggestedEnv = roles => {
  const top = role =>
    (roles[role]?.recommended || [])
      .filter(candidate => candidate.eligible)
      .slice(0, role === "git" ? 4 : 2)
      .map(candidate => candidate.url)
      .join(",")
  return Object.fromEntries(
    [
      ["VITE_INDEXER_RELAYS", top("indexer")],
      ["VITE_SIGNER_RELAYS", top("signer")],
      ["VITE_SMART_WIDGET_RELAYS", top("widget")],
      ["VITE_GIT_RELAYS", top("git")],
      ["VITE_DEFAULT_BLOSSOM_SERVERS", top("blossom")],
    ].filter(([, value]) => value),
  )
}

const assignRanks = roles => {
  for (const group of Object.values(roles)) {
    const all = [...group.recommended, ...group.alternates, ...group.rejected]
    all.forEach((candidate, index) => {
      candidate.rank = index + 1
    })
  }
}

export const discoverRelayDefaults = async (cli, dependencies = {}) => {
  const progress = dependencies.progress || makeProgressLogger(cli.progress)
  const env = dependencies.env || (await readEnv(cli.envFile))
  // Validate samples before discovery; malformed input must never reach a signer.
  const writeEvents = cli.writeAuditEvents
    ? parseWriteAuditEvents(await readFile(cli.writeAuditEvents, "utf8"))
    : undefined
  const warnings = [
    "Encrypted mute entries and private renounced-community lists were not evaluated.",
    "Community stars and effective community moderation reports were not used as ranking evidence.",
    ...(writeEvents
      ? []
      : [
          "Relay write acceptance was not tested; write-capable recommendations remain provisional.",
        ]),
  ]
  const defaultCommunity = cli.noDefaultCommunity
    ? undefined
    : parseCommunityInput(cli.defaultCommunityInput ?? env.VITE_DEFAULT_COMMUNITY)
  if ((cli.defaultCommunityInput ?? env.VITE_DEFAULT_COMMUNITY) && !defaultCommunity) {
    warnings.push("VITE_DEFAULT_COMMUNITY could not be parsed and was ignored.")
  }
  const bootstrapRelays = unique([
    ...cli.bootstrapRelays,
    ...parseCsv(env.VITE_INDEXER_RELAYS).map(normalizeRelayUrl),
    ...DEFAULT_BOOTSTRAP_RELAYS,
    ...(defaultCommunity?.relays || []),
  ])
  if (!bootstrapRelays.length) throw new Error("No usable bootstrap relays")

  progress("bootstrap", "loading seed lists and community references", {
    seeds: cli.seeds.length,
    relays: bootstrapRelays.length,
  })
  const seedLoad = await queryAcrossRelays({
    relays: bootstrapRelays,
    filters: makeSeedFilters(cli.seeds),
    timeoutMs: cli.timeoutMs,
    concurrency: cli.concurrency,
    progress,
    phase: "bootstrap",
  })
  let corpus = seedLoad.events

  if (defaultCommunity) {
    progress("default-community", "resolving VITE_DEFAULT_COMMUNITY", {
      address: defaultCommunity.address,
    })
    const defaultLoad = await queryAcrossRelays({
      relays: unique([...defaultCommunity.relays, ...bootstrapRelays]),
      filters: [
        {
          kinds: [COMMUNITY_DEFINITION_KIND],
          authors: [defaultCommunity.ownerPubkey],
          "#d": [defaultCommunity.communityId],
        },
        {kinds: [5], authors: [defaultCommunity.ownerPubkey]},
        {kinds: [10002], authors: [defaultCommunity.ownerPubkey], limit: 1},
      ],
      timeoutMs: cli.timeoutMs,
      concurrency: cli.concurrency,
      progress,
      phase: "default-community",
    })
    corpus = mergeEvents(corpus, defaultLoad.events)
  }

  const initialProfileLists = corpus.filter(event => event.kind === PROFILE_LIST_KIND)
  const profileListAddresses = getProfileListAddresses(initialProfileLists)
  const definitionRefs = getDefinitionRefsFromProfileLists(initialProfileLists)
  const reverseDefinitionFilters = [
    ...chunk(profileListAddresses, 80).map(addresses => ({
      kinds: [COMMUNITY_DEFINITION_KIND],
      "#a": addresses,
      limit: 200,
    })),
    ...definitionRefs.map(address => {
      const [, pubkey, ...identifierParts] = address.split(":")
      return {
        kinds: [COMMUNITY_DEFINITION_KIND],
        authors: [pubkey],
        "#d": [identifierParts.join(":")],
      }
    }),
    ...definitionRefs.map(address => {
      const [, pubkey] = address.split(":")
      return {kinds: [5], authors: [pubkey]}
    }),
  ]
  progress("communities", "resolving community definitions", {
    profileListAddresses: profileListAddresses.length,
  })
  const definitionLoad = await queryAcrossRelays({
    relays: bootstrapRelays,
    filters: reverseDefinitionFilters,
    timeoutMs: cli.timeoutMs,
    concurrency: cli.concurrency,
    progress,
    phase: "communities",
  })
  corpus = mergeEvents(corpus, definitionLoad.events)
  const provisionalDefinitions = corpus.map(parseCommunityDefinition).filter(Boolean)
  const definitionControllers = unique(
    provisionalDefinitions.map(definition => definition.ownerPubkey),
  )
  let definitionDeleteObservations = []
  if (definitionControllers.length > 0) {
    const deletionLoad = await queryAcrossRelays({
      relays: bootstrapRelays,
      filters: chunk(definitionControllers, 80).map(authors => ({kinds: [5], authors})),
      timeoutMs: cli.timeoutMs,
      concurrency: cli.concurrency,
      progress,
      phase: "community-deletions",
    })
    corpus = mergeEvents(corpus, deletionLoad.events)
    definitionDeleteObservations = deletionLoad.observations
  }
  let definitions = selectCurrentCommunityDefinitions(corpus)

  const profileListRefs = getDefinitionProfileListRefs(definitions)
  if (profileListRefs.length > 0) {
    const filtersByRelay = new Map()
    for (const definition of definitions) {
      for (const ref of getDefinitionProfileListRefs([definition])) {
        const relays = unique([...definition.relays, ref.relay])
        for (const relay of relays.length ? relays : bootstrapRelays) {
          const filters = filtersByRelay.get(relay) || new Map()
          filters.set(ref.address, {
            kinds: [PROFILE_LIST_KIND],
            authors: [ref.pubkey],
            "#d": [ref.identifier],
            limit: 5,
          })
          filtersByRelay.set(relay, filters)
        }
      }
    }
    const listRequests = Array.from(filtersByRelay, ([relay, filters]) =>
      chunk(Array.from(filters.values()), 10).map(filtersChunk => ({relay, filters: filtersChunk})),
    ).flat()
    progress("communities", "hydrating referenced profile lists", {
      lists: profileListRefs.length,
      relays: filtersByRelay.size,
      requests: listRequests.length,
    })
    let completed = 0
    const listObservations = await mapConcurrent(listRequests, cli.concurrency, async request => {
      const result = await queryRelay(request.relay, request.filters, {timeoutMs: cli.timeoutMs})
      completed += 1
      if (completed === listRequests.length || completed % 10 === 0) {
        progress("communities", "profile-list queries completed", {
          completed,
          total: listRequests.length,
        })
      }
      return result
    })
    corpus = mergeEvents(
      corpus,
      listObservations.flatMap(observation => observation.events),
    )
  }

  definitions = selectCurrentCommunityDefinitions(corpus)
  const graph = buildCommunityGraph({
    seeds: cli.seeds,
    events: corpus,
    definitions,
    defaultCommunityAddress: defaultCommunity?.address,
    maxFollows: cli.maxFollows,
    maxAuthors: cli.maxAuthors,
  })
  progress("graph", "community-first graph built", {
    authors: graph.authors.length,
    activeCommunities: graph.activeDefinitionAddresses.size,
    directFollows: graph.seedStates.reduce((sum, seed) => sum + seed.directFollows.length, 0),
  })

  const activeDefinitions = definitions.filter(
    definition =>
      graph.activeDefinitionAddresses.has(definition.address) ||
      definition.address === defaultCommunity?.address,
  )
  const discoveryRelays = unique([
    ...bootstrapRelays,
    ...activeDefinitions.flatMap(definition => definition.relays),
  ])
  const authorFilters = chunk(graph.authors, 80).map(authors => ({
    kinds: AUTHOR_LIST_KINDS,
    authors,
    limit: 1000,
  }))
  progress("authors", "loading network relay and server lists", {
    authors: graph.authors.length,
    relays: discoveryRelays.length,
  })
  const authorLoad = await queryAcrossRelays({
    relays: discoveryRelays,
    filters: authorFilters,
    timeoutMs: cli.timeoutMs,
    concurrency: cli.concurrency,
    progress,
    phase: "authors",
  })
  corpus = mergeEvents(corpus, authorLoad.events)

  const relayLists = latestByKindAndAuthor(corpus, 10002)
  const outboxGroups = new Map()
  for (const [author, event] of relayLists) {
    for (const relay of getTagUrls(event, ["r"], normalizeRelayUrl)) {
      const authors = outboxGroups.get(relay) || []
      authors.push(author)
      outboxGroups.set(relay, unique(authors))
    }
  }
  const secondPassGroups = Array.from(outboxGroups, ([relay, authors]) => ({relay, authors}))
    .sort((a, b) => b.authors.length - a.authors.length || a.relay.localeCompare(b.relay))
    .slice(0, cli.maxDiscoveryRelays)
  if (secondPassGroups.length > 0) {
    progress("outboxes", "hydrating person lists from declared outboxes", {
      relays: secondPassGroups.length,
    })
    let completed = 0
    const secondPass = await mapConcurrent(secondPassGroups, cli.concurrency, async group => {
      const filters = chunk(group.authors, 80).map(authors => ({
        kinds: AUTHOR_LIST_KINDS,
        authors,
        limit: 1000,
      }))
      const observations = []
      const events = []
      for (const filtersChunk of chunk(filters, 10)) {
        const result = await queryRelay(group.relay, filtersChunk, {timeoutMs: cli.timeoutMs})
        observations.push(result)
        events.push(...result.events)
      }
      completed += 1
      if (completed === secondPassGroups.length || completed % 5 === 0) {
        progress("outboxes", "outbox relays completed", {completed, total: secondPassGroups.length})
      }
      return {events, observations}
    })
    corpus = mergeEvents(
      corpus,
      secondPass.flatMap(result => result.events),
    )
  }

  const store = makeCandidateStore()
  addDefinitionEvidence({store, definitions: activeDefinitions, defaultCommunity})
  addAuthorListEvidence({store, events: corpus, graph, seeds: cli.seeds})
  const configured = addConfiguredEvidence({store, env, cli})

  for (const observation of [
    ...seedLoad.observations,
    ...definitionLoad.observations,
    ...definitionDeleteObservations,
    ...authorLoad.observations,
  ]) {
    if (observation.events.length === 0) continue
    addCandidateEvidence(store, {
      role: "indexer",
      url: observation.url,
      source: "observed",
      detail: `${observation.events.length} verified events`,
    })
  }

  let candidates = Array.from(store.values()).map(serializeCandidate)
  candidates = candidates.filter(candidate => cli.roles.includes(candidate.role))
  candidates = ROLE_NAMES.flatMap(role =>
    rankCandidates(candidates.filter(candidate => candidate.role === role)).slice(
      0,
      cli.maxCandidates,
    ),
  )
  const seedProfiles = Object.fromEntries(
    cli.seeds.map(seed => [
      seed,
      parseProfile(
        selectLatestEvents(corpus).find(event => event.kind === 0 && event.pubkey === seed),
      ),
    ]),
  )

  if (cli.probe !== "none") {
    progress("probe", "probing role-specific candidates", {candidates: candidates.length})
    const nip11Cache = new Map()
    let completed = 0
    candidates = await mapConcurrent(candidates, cli.concurrency, async candidate => {
      let probe
      if (candidate.role === "blossom") {
        probe = await probeBlossomServer(candidate.url, cli.timeoutMs)
      } else {
        let nip11 = nip11Cache.get(candidate.url)
        if (!nip11) {
          nip11 = fetchNip11(candidate.url, cli.timeoutMs)
          nip11Cache.set(candidate.url, nip11)
        }
        probe = await probeRelayRole({
          candidate,
          corpus,
          seedProfiles,
          timeoutMs: cli.timeoutMs,
          probeMode: cli.probe,
          nip11: await nip11,
        })
      }
      completed += 1
      if (completed === candidates.length || completed % 5 === 0) {
        progress("probe", "candidate probes completed", {completed, total: candidates.length})
      }
      return {...candidate, probe, eligible: candidateEligibility({...candidate, probe})}
    })
  } else {
    candidates = candidates.map(candidate => ({
      ...candidate,
      eligible: true,
      probe: {reachable: null, fitnessScore: 0},
    }))
  }

  const roles = selectRoleResults(candidates, cli.maxCandidates)
  let writeAudit
  if (writeEvents) {
    const destinations = new Map()
    const add = (relay, source) => {
      const normalized = normalizeRelayUrl(relay)
      if (!normalized) return
      const sources = destinations.get(normalized) || new Set()
      sources.add(source)
      destinations.set(normalized, sources)
    }
    if (cli.writeRelays?.length) {
      for (const relay of cli.writeRelays) add(relay, "explicit audit destination")
    } else {
      for (const candidate of candidates.filter(candidate =>
        ["indexer", "git", "widget"].includes(candidate.role),
      )) {
        add(candidate.url, `candidate:${candidate.role}`)
      }
      for (const role of ["indexer", "git", "widget"]) {
        for (const relay of configured[role] || []) add(relay, `configured:${role}`)
      }
      for (const definition of activeDefinitions) {
        for (const relay of definition.relays) add(relay, "community definition")
      }
      const writeLists = latestByKindAndAuthor(corpus, 10002)
      for (const event of writeEvents) {
        if (event.kind === COMMUNITY_DEFINITION_KIND) {
          for (const tag of event.tags.filter(tag => tag[0] === "r"))
            add(tag[1], "sample definition")
        }
        for (const tag of writeLists.get(event.pubkey)?.tags || []) {
          if (tag[0] === "r" && (!tag[2] || tag[2] === "write")) add(tag[1], "sample author outbox")
        }
      }
      if (!parseCsv(env.VITE_SMART_WIDGET_RELAYS).length) {
        for (const relay of ["wss://relay.budabit.club", "wss://nos.lol"])
          add(relay, "built-in widget default")
      }
    }
    progress("write-audit", "replaying existing signed samples", {
      relays: destinations.size,
      kinds: writeEvents.map(event => event.kind),
    })
    writeAudit = await auditRelayWrites({
      account: cli.writeAccount,
      events: writeEvents,
      destinations: Array.from(destinations, ([relay, sources]) => ({
        relay,
        sources: [...sources],
      })),
      timeoutMs: cli.timeoutMs,
      concurrency: cli.concurrency,
      queryRelay,
      ...(dependencies.replayWriteEvents ? {replay: dependencies.replayWriteEvents} : {}),
    })
  }
  assignRanks(roles)
  const generatedAt = new Date().toISOString()
  const defaultDefinition = activeDefinitions.find(
    definition => definition.address === defaultCommunity?.address,
  )
  const evidence = {
    schemaVersion: 1,
    generatedAt,
    inputs: {
      seeds: cli.seeds,
      roles: cli.roles,
      envFile: cli.envFile,
      bootstrapRelays,
      probe: cli.probe,
      limits: {
        maxFollows: cli.maxFollows,
        maxAuthors: cli.maxAuthors,
        maxCandidates: cli.maxCandidates,
        maxDiscoveryRelays: cli.maxDiscoveryRelays,
      },
    },
    defaultCommunity: defaultCommunity
      ? {
          ...defaultCommunity,
          definitionResolved: Boolean(defaultDefinition),
          definitionId: defaultDefinition?.event.id,
          infrastructure: {
            relays: defaultDefinition?.relays || defaultCommunity.relays,
            blossomServers: defaultDefinition?.blossomServers || [],
            graspServers: defaultDefinition?.graspServers || [],
            mints: defaultDefinition?.mints || [],
          },
        }
      : null,
    graph: {
      seedStates: graph.seedStates,
      authorCount: graph.authors.length,
      activeCommunityAddresses: Array.from(graph.activeDefinitionAddresses).sort(),
      relationships: Array.from(graph.relationships.values()).map(serializeRelationship),
    },
    configured,
    ...(writeAudit ? {writeAudit} : {}),
    eventCorpus: {
      count: corpus.length,
      kinds: Object.fromEntries(
        Array.from(
          corpus.reduce(
            (counts, event) => counts.set(event.kind, (counts.get(event.kind) || 0) + 1),
            new Map(),
          ),
        ).sort(([a], [b]) => a - b),
      ),
      events: selectLatestEvents(corpus),
    },
    roles,
    suggestedEnv: getSuggestedEnv(roles),
    warnings,
    completeness: {
      bootstrapRelaysQueried: bootstrapRelays.length,
      bootstrapFailures: seedLoad.observations.filter(
        item => !["eose", "closed"].includes(item.status),
      ).length,
      communityDefinitions: activeDefinitions.length,
      profileLists: latestByAddress(corpus, PROFILE_LIST_KIND).size,
      privateStateEvaluated: false,
      writeProbesPerformed: Boolean(writeAudit),
    },
  }
  return evidence
}

export const main = async argv => {
  const cli = parseCli(argv)
  if (cli.help) {
    process.stdout.write(HELP)
    return 0
  }
  const progress = makeProgressLogger(cli.progress)
  const evidence = await discoverRelayDefaults(cli, {progress})
  const table = renderRecommendationTable(evidence)
  await mkdir(path.dirname(cli.evidenceFile), {recursive: true})
  await mkdir(path.dirname(cli.tableFile), {recursive: true})
  await writeFile(cli.evidenceFile, `${JSON.stringify(evidence, null, 2)}\n`)
  await writeFile(cli.tableFile, table)
  progress("output", "evidence and recommendation files written", {
    evidenceFile: cli.evidenceFile,
    tableFile: cli.tableFile,
  })
  process.stdout.write(
    `${JSON.stringify(
      {
        evidenceFile: cli.evidenceFile,
        recommendationTable: cli.tableFile,
        seeds: evidence.inputs.seeds.length,
        communities: evidence.completeness.communityDefinitions,
        warnings: evidence.warnings.length,
      },
      null,
      2,
    )}\n`,
  )
  const partial = evidence.completeness.bootstrapFailures > 0
  return cli.strict && partial ? 2 : 0
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2))
    .then(code => {
      process.exitCode = code
    })
    .catch(error => {
      process.stderr.write(
        `[relay-discovery] fatal: ${error instanceof Error ? error.stack || error.message : String(error)}\n`,
      )
      process.exitCode = 1
    })
}
