#!/usr/bin/env node
// Fetch every path of a signed NIP-5A manifest through one gateway and compare bytes
// with the manifest's SHA-256 values. Read-only HTTP checks; no signing or publishing.
// Usage: check-nsite-gateway.mjs <signed-manifest.json> <gateway-host> [--sample N] [--out FILE]

import crypto from "node:crypto"
import fs from "node:fs"

const [manifestFile, gateway, ...rest] = process.argv.slice(2)
if (!manifestFile || !gateway) {
  console.error(
    "usage: check-nsite-gateway.mjs <signed-manifest.json> <gateway-host> [--sample N] [--out FILE]",
  )
  process.exit(2)
}
const opt = name => {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}
const sample = Number(opt("--sample") || 0)
const outFile = opt("--out")

const event = JSON.parse(fs.readFileSync(manifestFile, "utf8"))
const d = event.tags.find(t => t[0] === "d")?.[1]
const label =
  event.kind === 5128
    ? `v${BigInt(`0x${event.id}`).toString(36).padStart(50, "0")}`
    : `${BigInt(`0x${event.pubkey}`).toString(36).padStart(50, "0")}${d}`
const origin = `https://${label}.${gateway}`
let paths = event.tags.filter(t => t[0] === "path").map(([, p, h]) => ({path: p, hash: h}))
if (sample > 0) {
  const pick = new Set([
    "/index.html",
    "/404.html",
    "/_app/version.json",
    "/service-worker.js",
    "/manifest.webmanifest",
    "/fonts/Satoshi Symbol.ttf",
  ])
  const rest = paths.filter(p => !pick.has(p.path))
  const step = Math.max(1, Math.floor(rest.length / sample))
  paths = [
    ...paths.filter(p => pick.has(p.path)),
    ...rest.filter((_, i) => i % step === 0).slice(0, sample),
  ]
}
const indexHash = event.tags.find(t => t[0] === "path" && t[1] === "/index.html")?.[2]

const encodePath = p => p.split("/").map(encodeURIComponent).join("/")
const sha256 = buf => crypto.createHash("sha256").update(buf).digest("hex")

const fetchOnce = async url => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 60_000)
  try {
    const res = await fetch(url, {
      redirect: "manual",
      signal: controller.signal,
      headers: {"cache-control": "no-cache"},
    })
    const buf = Buffer.from(await res.arrayBuffer())
    return {
      status: res.status,
      type: res.headers.get("content-type") || "",
      hash: sha256(buf),
      size: buf.length,
    }
  } finally {
    clearTimeout(timer)
  }
}

const fetchWithRetry = async url => {
  let last
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetchOnce(url)
      if (r.status < 500) return r
      last = r
    } catch (error) {
      last = {status: 0, type: "", hash: "", size: 0, error: String(error?.message || error)}
    }
    await new Promise(resolve => setTimeout(resolve, 1500 * (attempt + 1)))
  }
  return last
}

const results = []
const queue = [...paths]
const worker = async () => {
  while (queue.length) {
    const item = queue.shift()
    const r = await fetchWithRetry(`${origin}${encodePath(item.path)}`)
    results.push({...item, ...r, ok: r.status === 200 && r.hash === item.hash})
  }
}
await Promise.all(Array.from({length: 6}, worker))

const deepLinks = ["/spaces", "/settings/about", "/c/does-not-exist/route", "/git"]
const deep = []
for (const p of deepLinks) {
  const r = await fetchWithRetry(`${origin}${p}`)
  deep.push({path: p, status: r.status, type: r.type, servesShell: r.hash === indexHash})
}

const failures = results.filter(r => !r.ok)
const typesByExt = {}
for (const r of results) {
  const ext = (r.path.match(/\.[^./]+$/) || ["<none>"])[0]
  typesByExt[ext] ??= new Set()
  typesByExt[ext].add(`${r.status} ${r.type}`)
}
const summary = {
  gateway,
  origin,
  manifestId: event.id,
  kind: event.kind,
  checked: results.length,
  ok: results.length - failures.length,
  failed: failures.length,
  failures: failures
    .slice(0, 20)
    .map(({path, status, type, hash, size, error}) => ({
      path,
      status,
      type,
      got: hash.slice(0, 12),
      size,
      error,
    })),
  typesByExt: Object.fromEntries(Object.entries(typesByExt).map(([k, v]) => [k, [...v]])),
  deepLinks: deep,
  checkedAt: new Date().toISOString(),
}
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify({summary, results}, null, 2)}\n`)
console.log(JSON.stringify(summary, null, 2))
process.exit(failures.length ? 1 : 0)
