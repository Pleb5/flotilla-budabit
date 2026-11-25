#!/usr/bin/env node
// Build unsigned NIP-5A templates for a static SvelteKit SPA build:
//   - kind 35128 named-site manifest (one signed event maps every path to a blob hash)
//   - optional kind 5128 manifest snapshot (immutable, addressable by event id)
//
// Packaging rules:
//   - publish every build file except source maps and hidden path segments
//     (.htaccess, .well-known/*), matching the app service worker's precache filter;
//   - map /404.html to the SPA shell so first-visit deep links work on NIP-5A gateways;
//   - optionally retain the previous manifest's /_app/immutable/* paths so tabs still
//     running the previous release can lazy-load their content-hashed chunks.
//
// The script reads only the build directory (and an optional previous manifest) and
// writes templates/upload lists to --out. It never signs or publishes anything.

import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"

const usage = `Usage: nsite-manifest.mjs --build DIR --pubkey HEX --d TAG --out DIR
  [--title TEXT] [--description TEXT] [--source URL] [--server URL]...
  [--previous SIGNED_MANIFEST_JSON] [--snapshot [--snapshot-title TEXT]] [--gateway HOST]...`

const die = message => {
  console.error(`nsite-manifest: ${message}`)
  process.exit(1)
}

const args = {server: [], gateway: [], snapshot: false}
for (let i = 2; i < process.argv.length; i++) {
  const flag = process.argv[i]
  const next = () => {
    const value = process.argv[++i]
    if (value === undefined) die(`${flag} requires a value`)
    return value
  }
  switch (flag) {
    case "--build":
      args.build = next()
      break
    case "--pubkey":
      args.pubkey = next()
      break
    case "--d":
      args.d = next()
      break
    case "--out":
      args.out = next()
      break
    case "--title":
      args.title = next()
      break
    case "--description":
      args.description = next()
      break
    case "--source":
      args.source = next()
      break
    case "--server":
      args.server.push(next())
      break
    case "--gateway":
      args.gateway.push(next())
      break
    case "--previous":
      args.previous = next()
      break
    case "--snapshot":
      args.snapshot = true
      break
    case "--snapshot-title":
      args.snapshotTitle = next()
      break
    case "-h":
    case "--help":
      console.log(usage)
      process.exit(0)
    default:
      die(`unknown argument ${flag}\n${usage}`)
  }
}

for (const key of ["build", "pubkey", "d", "out"])
  if (!args[key]) die(`--${key} is required\n${usage}`)
if (!/^[0-9a-f]{64}$/.test(args.pubkey)) die("--pubkey must be 64 lowercase hex characters")
if (!/^[a-z0-9-]{1,13}$/.test(args.d) || args.d.endsWith("-")) {
  die("--d must match ^[a-z0-9-]{1,13}$ and must not end with '-' (NIP-5A canonical named site)")
}
for (const server of args.server)
  if (!/^https:\/\/[^/\s]+\/?$/.test(server)) die(`bad server URL ${server}`)
if (args.source && !/^(https:\/\/|nostr:\/\/)\S+$/.test(args.source))
  die("--source must be https:// or nostr://")

const buildDir = path.resolve(args.build)
const outDir = path.resolve(args.out)
if (!fs.existsSync(path.join(buildDir, "index.html"))) die(`missing ${buildDir}/index.html`)

const sha256 = bytes => crypto.createHash("sha256").update(bytes).digest("hex")
const isHiddenSegmentPath = rel => rel.split("/").some(segment => segment.startsWith("."))
const isExcluded = rel => rel.endsWith(".map") || isHiddenSegmentPath(rel)

const walk = dir => {
  const entries = fs.readdirSync(dir, {withFileTypes: true})
  return entries.flatMap(entry => {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) return walk(full)
    if (entry.isFile()) return [full]
    die(`unsupported non-regular file ${full}`)
  })
}

const files = []
const excluded = []
for (const full of walk(buildDir)) {
  const rel = path.relative(buildDir, full).split(path.sep).join("/")
  if (isExcluded(rel)) {
    excluded.push(rel)
    continue
  }
  const bytes = fs.readFileSync(full)
  files.push({path: `/${rel}`, file: full, size: bytes.length, hash: sha256(bytes)})
}

const byPath = new Map(files.map(entry => [entry.path, entry]))
const index = byPath.get("/index.html")
const aliases = []
if (!byPath.has("/404.html")) {
  aliases.push({path: "/404.html", hash: index.hash, aliasOf: "/index.html"})
}

const retained = []
let previous = null
if (args.previous) {
  previous = JSON.parse(fs.readFileSync(args.previous, "utf8"))
  const previousD = previous.tags?.find(tag => tag[0] === "d")?.[1]
  if (previous.kind !== 35128 || previous.pubkey !== args.pubkey || previousD !== args.d) {
    die("--previous must be the signed kind 35128 manifest for the same pubkey and d tag")
  }
  for (const tag of previous.tags) {
    if (tag[0] !== "path" || !tag[1].startsWith("/_app/immutable/")) continue
    if (byPath.has(tag[1])) continue
    if (!/^[0-9a-f]{64}$/.test(tag[2])) die(`bad previous hash for ${tag[1]}`)
    retained.push({path: tag[1], hash: tag[2]})
  }
}

const pathEntries = [
  ...files.map(({path: p, hash}) => [p, hash]),
  ...aliases.map(({path: p, hash}) => [p, hash]),
  ...retained.map(({path: p, hash}) => [p, hash]),
].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))

for (const [p] of pathEntries) {
  if (!p.startsWith("/") || p.endsWith("/") || !/\.[^/]+$/.test(p))
    die(`path must end with a filename and extension: ${p}`)
}

// NIP-5A aggregate: sorted "<sha256> <absolute-path>\n" lines over path tags only.
const aggregate = sha256(
  Buffer.from(
    pathEntries
      .map(([p, hash]) => `${hash} ${p}\n`)
      .sort()
      .join(""),
    "utf8",
  ),
)

const descriptiveTags = [
  ...args.server.map(server => ["server", server.replace(/\/$/, "")]),
  ...(args.title ? [["title", args.title]] : []),
  ...(args.description ? [["description", args.description]] : []),
  ...(args.source ? [["source", args.source]] : []),
]
const pathTags = pathEntries.map(([p, hash]) => ["path", p, hash])
const manifest = {
  kind: 35128,
  content: "",
  tags: [["d", args.d], ...pathTags, ["x", aggregate, "aggregate"], ...descriptiveTags],
}
const siteAddress = `35128:${args.pubkey}:${args.d}`
const snapshotDescriptiveTags = args.snapshotTitle
  ? descriptiveTags.map(tag => (tag[0] === "title" ? ["title", args.snapshotTitle] : tag))
  : descriptiveTags
const snapshot = {
  kind: 5128,
  content: "",
  tags: [
    ["a", siteAddress],
    ...pathTags,
    ["x", aggregate, "aggregate"],
    ...snapshotDescriptiveTags,
  ],
}

// Signed envelope adds id/pubkey/sig/created_at (~300 bytes) plus the ["EVENT",...] frame.
const signedSizeEstimate = event => Buffer.byteLength(JSON.stringify(event)) + 400
const manifestBytes = signedSizeEstimate(manifest)
if (manifestBytes > 120_000)
  die(`manifest too large for 128 KiB relay frames: ~${manifestBytes} bytes`)

// One upload per unique hash. Blossom stores the MIME type sent at upload time and
// gateways forward it; nak derives it from the file extension, so stage extensions
// that Go's mime table leaves empty under an equivalent, typed extension.
const STAGE_EXTENSIONS = {".webmanifest": ".json"}
const stageDir = path.join(outDir, "stage")
fs.rmSync(stageDir, {recursive: true, force: true})
const uploads = new Map()
for (const entry of files) {
  if (uploads.has(entry.hash)) continue
  const ext = path.extname(entry.file)
  let uploadFile = entry.file
  if (STAGE_EXTENSIONS[ext]) {
    fs.mkdirSync(stageDir, {recursive: true})
    uploadFile = path.join(stageDir, `${path.basename(entry.file)}${STAGE_EXTENSIONS[ext]}`)
    fs.copyFileSync(entry.file, uploadFile)
    if (sha256(fs.readFileSync(uploadFile)) !== entry.hash) die(`staging changed ${entry.path}`)
  }
  uploads.set(entry.hash, {hash: entry.hash, size: entry.size, path: entry.path, uploadFile})
}

const pubkeyB36 = BigInt(`0x${args.pubkey}`).toString(36).padStart(50, "0")
const gateways = args.gateway.length ? args.gateway : ["nsite.run"]
const versionFile = path.join(buildDir, "_app", "version.json")
const summary = {
  site: siteAddress,
  d: args.d,
  pubkey: args.pubkey,
  aggregate,
  buildVersion: fs.existsSync(versionFile)
    ? JSON.parse(fs.readFileSync(versionFile, "utf8")).version
    : null,
  counts: {
    pathTags: pathTags.length,
    buildFiles: files.length,
    uniqueBlobs: uploads.size,
    aliases: aliases.length,
    retainedPreviousImmutable: retained.length,
    excluded: excluded.length,
  },
  bytes: {
    uniqueBlobs: [...uploads.values()].reduce((sum, upload) => sum + upload.size, 0),
    manifestSignedEstimate: manifestBytes,
    snapshotSignedEstimate: signedSizeEstimate(snapshot),
  },
  index: {path: "/index.html", hash: index.hash},
  aliases,
  excludedSample: excluded.filter(rel => !rel.endsWith(".map")),
  excludedSourceMaps: excluded.filter(rel => rel.endsWith(".map")).length,
  previousManifest: previous ? {id: previous.id, created_at: previous.created_at} : null,
  urls: Object.fromEntries(gateways.map(host => [host, `https://${pubkeyB36}${args.d}.${host}/`])),
}

fs.mkdirSync(outDir, {recursive: true})
const writeJson = (name, value) =>
  fs.writeFileSync(path.join(outDir, name), `${JSON.stringify(value, null, 2)}\n`)
writeJson("manifest.template.json", manifest)
if (args.snapshot) writeJson("snapshot.template.json", snapshot)
writeJson("summary.json", summary)
fs.writeFileSync(
  path.join(outDir, "uploads.tsv"),
  [...uploads.values()].map(u => [u.hash, u.size, u.path, u.uploadFile].join("\t")).join("\n") +
    "\n",
)
fs.writeFileSync(
  path.join(outDir, "hashes.txt"),
  [...new Set(pathEntries.map(([, hash]) => hash))].join("\n") + "\n",
)
console.log(JSON.stringify(summary, null, 2))
