#!/usr/bin/env node

const args = process.argv.slice(2)
const allowMissingSw = args.includes("--allow-missing-sw")
const originArg = args.find(arg => !arg.startsWith("--"))

if (!originArg) {
  console.error("Usage: node scripts/check-deploy-cache.mjs <origin> [--allow-missing-sw]")
  process.exit(1)
}

const origin = new URL(originArg)
origin.pathname = origin.pathname.replace(/\/+$/, "")
origin.search = ""
origin.hash = ""

const failures = []
const warnings = []

const makeUrl = path => new URL(path, origin).toString()

const getHeader = (response, name) => response.headers.get(name) || ""

const getStatusLine = response => `${response.status} ${response.statusText}`.trim()

const fetchResponse = async (path, method = "HEAD") => {
  const url = makeUrl(path)
  const options = {
    method,
    headers: {
      "cache-control": "no-cache",
      pragma: "no-cache",
    },
  }

  let response = await fetch(url, options)
  if (method === "HEAD" && [405, 501].includes(response.status)) {
    response = await fetchResponse(path, "GET")
  }

  return response
}

const fetchText = async path => {
  const response = await fetchResponse(path, "GET")
  const text = await response.text()
  return {response, text}
}

const hasNoStoreOrRevalidate = cacheControl => {
  const value = cacheControl.toLowerCase()
  return value.includes("no-store") || (value.includes("max-age=0") && value.includes("must-revalidate"))
}

const hasImmutableCache = cacheControl => {
  const value = cacheControl.toLowerCase()
  const maxAge = value.match(/max-age=(\d+)/)?.[1]
  return value.includes("immutable") && Number(maxAge || 0) >= 31536000
}

const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

const checkMutable = async path => {
  const response = await fetchResponse(path)
  const cacheControl = getHeader(response, "cache-control")

  if (path === "/sw.js" && response.status === 404 && allowMissingSw) {
    warnings.push(`${path}: missing but allowed during pre-transition implementation`)
    return
  }

  assert(response.ok, `${path}: expected 2xx, got ${getStatusLine(response)}`)
  assert(
    hasNoStoreOrRevalidate(cacheControl),
    `${path}: expected no-store or max-age=0 must-revalidate, got Cache-Control: ${cacheControl || "<missing>"}`,
  )
}

const checkHtml = async path => {
  const response = await fetchResponse(path)
  const cacheControl = getHeader(response, "cache-control")
  const contentType = getHeader(response, "content-type")

  assert(response.ok, `${path}: expected 2xx, got ${getStatusLine(response)}`)
  assert(
    contentType.toLowerCase().includes("text/html"),
    `${path}: expected text/html, got Content-Type: ${contentType || "<missing>"}`,
  )
  assert(
    hasNoStoreOrRevalidate(cacheControl),
    `${path}: expected no-store or max-age=0 must-revalidate, got Cache-Control: ${cacheControl || "<missing>"}`,
  )
}

const checkManifest = async () => {
  const path = "/manifest.webmanifest"
  const response = await fetchResponse(path)
  const cacheControl = getHeader(response, "cache-control")
  const contentType = getHeader(response, "content-type")

  assert(response.ok, `${path}: expected 2xx, got ${getStatusLine(response)}`)
  assert(
    contentType.toLowerCase().includes("application/manifest+json"),
    `${path}: expected application/manifest+json, got Content-Type: ${contentType || "<missing>"}`,
  )
  assert(
    hasNoStoreOrRevalidate(cacheControl),
    `${path}: expected no-store or max-age=0 must-revalidate, got Cache-Control: ${cacheControl || "<missing>"}`,
  )
}

const findImmutableAsset = async () => {
  const {response, text} = await fetchText("/")
  assert(response.ok, `/: expected 2xx while reading HTML, got ${getStatusLine(response)}`)

  return text.match(/\/_app\/immutable\/[^"'<>\s)]+/)?.[0] || ""
}

const checkImmutable = async path => {
  assert(Boolean(path), "Could not find an immutable asset in root HTML")
  if (!path) return

  const response = await fetchResponse(path)
  const cacheControl = getHeader(response, "cache-control")

  assert(response.ok, `${path}: expected 2xx, got ${getStatusLine(response)}`)
  assert(
    hasImmutableCache(cacheControl),
    `${path}: expected public max-age>=31536000 immutable, got Cache-Control: ${cacheControl || "<missing>"}`,
  )
}

console.log(`Checking deploy cache headers for ${origin.toString()}`)

await checkHtml("/")
await checkHtml("/settings")
await checkMutable("/_app/version.json")
await checkMutable("/service-worker.js")
await checkMutable("/sw.js")
await checkManifest()
await checkImmutable(await findImmutableAsset())

for (const warning of warnings) console.warn(`WARN ${warning}`)

if (failures.length > 0) {
  console.error("Deploy cache verification failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Deploy cache verification passed")
