import {spawn} from "node:child_process"
import {mkdtemp, open, readFile, rm} from "node:fs/promises"
import {tmpdir} from "node:os"
import path from "node:path"
import {verifyEvent} from "nostr-tools"

export const WRITE_AUDIT_KINDS = [32222, 30222]

export const parseWriteAuditEvents = text => {
  const events = text
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map(line => JSON.parse(line))
  if (
    events.length !== 2 ||
    !WRITE_AUDIT_KINDS.every(kind => events.some(event => event.kind === kind))
  ) {
    throw new Error(
      "Write audit requires exactly one existing signed event each of kind 32222 and 30222",
    )
  }
  for (const event of events) {
    if (
      !verifyEvent(event) ||
      !event.created_at ||
      event.tags.filter(tag => tag[0] === "d" && tag[1]).length !== 1
    ) {
      throw new Error(
        "Write audit samples must have valid signatures, timestamps, and a single nonempty d tag",
      )
    }
  }
  return events
}

const redact = value =>
  String(value)
    .replace(/(?:bunker|nostrconnect):\/\/\S+/g, "[redacted signer URI]")
    .replace(/secret=[^\s&]+/g, "secret=[redacted]")
    .replace(/Authorization:\s*Nostr\s+\S+/gi, "Authorization: [redacted]")

/** Both streams share one descriptor so each printed event unambiguously bounds
 * its following ACK log lines, even if a relay connects for only one sample.
 */
const runNakAccount = async (args, input, timeoutMs) => {
  const directory = await mkdtemp(path.join(tmpdir(), "budabit-relay-audit-"))
  const filename = path.join(directory, "output")
  const file = await open(filename, "w", 0o600)
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn("nak-account", args, {
        stdio: ["pipe", file.fd, file.fd],
        env: {...process.env, NO_COLOR: "1"},
      })
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        child.kill("SIGTERM")
      }, timeoutMs)
      child.on("error", error => {
        clearTimeout(timer)
        reject(error)
      })
      child.on("close", code => {
        clearTimeout(timer)
        resolve({code, timedOut})
      })
      child.stdin.on("error", () => {})
      child.stdin.end(input)
    })
    // Keep signed event JSON intact for verification. Only expose redacted
    // diagnostic details; this merged stream is never logged or saved as evidence.
    return {...result, output: await readFile(filename, "utf8")}
  } finally {
    await file.close()
    await rm(directory, {recursive: true, force: true})
  }
}

export const parseWriteAuditLog = (output, events, relays) => {
  const rows = events.flatMap(event =>
    relays.map(relay => ({
      relay,
      kind: event.kind,
      eventId: event.id,
      author: event.pubkey,
      ack: "unknown",
      detail: "No acceptance ACK observed.",
    })),
  )
  let current
  const emittedIds = new Set()
  const connectionFailures = new Map()
  const findRelay = name =>
    relays.find(url => url.replace(/^wss:\/\//, "").replace(/\/$/, "") === name.replace(/\/$/, ""))
  for (const line of output.split(/\r?\n/)) {
    const connection = line.match(/^connecting to (\S+)\.\.\. (.+)$/)
    if (connection) {
      const relay = findRelay(connection[1])
      if (relay && connection[2] !== "ok.") connectionFailures.set(relay, redact(connection[2]))
      continue
    }
    if (line.startsWith("{")) {
      let emitted
      try {
        emitted = JSON.parse(line)
      } catch {
        continue
      }
      const expected = events.find(event => event.id === emitted.id)
      if (!expected || expected.sig !== emitted.sig || !verifyEvent(emitted)) {
        throw new Error("nak changed a write-audit sample or emitted an unexpected event")
      }
      current = expected
      emittedIds.add(expected.id)
      for (const row of rows.filter(row => row.eventId === expected.id)) {
        if (connectionFailures.has(row.relay))
          row.detail = `Connection failed: ${connectionFailures.get(row.relay)}`
      }
      connectionFailures.clear()
      continue
    }
    if (!current) continue
    // Auth can print another publishing marker on the same line; use its final result.
    const markers = [...line.matchAll(/publishing to (\S+)\.\.\. /g)]
    const marker = markers.at(-1)
    if (!marker) continue
    const relay = findRelay(marker[1])
    const row = rows.find(row => row.relay === relay && row.eventId === current.id)
    if (!row) continue
    const outcome = line.slice(marker.index + marker[0].length).trim()
    if (outcome === "success.") {
      row.ack = "accepted"
      row.detail = "Relay returned OK true (including duplicate acceptance)."
    } else if (outcome.startsWith("failed: msg: ")) {
      row.ack = "rejected"
      row.detail = redact(outcome.slice("failed: msg: ".length))
    } else {
      row.detail = redact(outcome || row.detail)
    }
  }
  // nak exits before printing a sample if none of its destinations connected.
  const unattempted = events.find(event => !emittedIds.has(event.id))
  for (const row of rows.filter(row => row.eventId === unattempted?.id)) {
    if (connectionFailures.has(row.relay))
      row.detail = `Connection failed: ${connectionFailures.get(row.relay)}`
  }
  return rows
}

export const replayWriteAuditEvents = async ({account, events, relays}) => {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(account || ""))
    throw new Error("Invalid write-audit account alias")
  parseWriteAuditEvents(events.map(event => JSON.stringify(event)).join("\n"))
  if (!relays.length) throw new Error("No relay destinations selected for the write audit")
  const status = await runNakAccount(["status", account], "", 15_000)
  if (
    status.code !== 0 ||
    !status.output.split("\n").some(line => line.startsWith(`${account} active `))
  ) {
    throw new Error(
      `Start the signer with 'nak-account start ${account}' in a normal terminal before the write audit`,
    )
  }
  // One account-backed process replays both unmodified samples. No event-field
  // flags or force-sign: signatures, authors and replacement coordinates stay intact.
  const result = await runNakAccount(
    ["run", "--as", account, "--", "event", "--auth", ...relays],
    events.map(event => JSON.stringify(event)).join("\n") + "\n",
    30_000 + events.length * relays.length * 15_000,
  )
  return {
    code: result.code,
    timedOut: result.timedOut,
    rows: parseWriteAuditLog(result.output, events, relays),
  }
}

export const auditRelayWrites = async ({
  account,
  events,
  destinations,
  timeoutMs,
  queryRelay,
  concurrency = 6,
  replay = replayWriteAuditEvents,
}) => {
  const relays = [...new Set(destinations.map(destination => destination.relay))]
  if (!relays.length) throw new Error("No relay destinations selected for the write audit")
  const publication = await replay({account, events, relays})
  const rows = publication.rows.map(row => ({
    ...row,
    sources: destinations
      .filter(destination => destination.relay === row.relay)
      .flatMap(destination => destination.sources),
  }))
  let cursor = 0
  await Promise.all(
    Array.from({length: Math.min(concurrency, rows.length)}, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++]
        const event = events.find(event => event.id === row.eventId)
        const identifier = event.tags.find(tag => tag[0] === "d")[1]
        // Address queries also work on relays that reject ID-only REQs. Verify the
        // exact signed ID and current replacement, not merely any event of this kind.
        const readback = await queryRelay(
          row.relay,
          [
            {
              kinds: [event.kind],
              authors: [event.pubkey],
              "#d": [identifier],
              limit: 5,
            },
          ],
          {timeoutMs},
        )
        const matches = readback.events
          .filter(
            candidate =>
              candidate.kind === event.kind &&
              candidate.pubkey === event.pubkey &&
              candidate.tags.some(tag => tag[0] === "d" && tag[1] === identifier) &&
              verifyEvent(candidate),
          )
          .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
        row.readback = {
          status: readback.status,
          exactMatch: matches.some(candidate => candidate.id === event.id),
          currentEventId: matches[0]?.id,
          detail: redact(readback.closedReason || ""),
        }
        row.verified =
          row.ack === "accepted" && readback.status === "eose" && matches[0]?.id === event.id
      }
    }),
  )
  return {
    checkedAt: new Date().toISOString(),
    account,
    exitCode: publication.code,
    timedOut: publication.timedOut,
    rows,
    verifiedRelaysByKind: Object.fromEntries(
      WRITE_AUDIT_KINDS.map(kind => [
        kind,
        rows.filter(row => row.kind === kind && row.verified).map(row => row.relay),
      ]),
    ),
  }
}
