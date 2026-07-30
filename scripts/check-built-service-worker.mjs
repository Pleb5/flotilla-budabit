#!/usr/bin/env node

import {readFileSync} from "node:fs"
import path from "node:path"

const buildDirectory = path.resolve("build")
const indexHtml = readFileSync(path.join(buildDirectory, "index.html"), "utf8")
const serviceWorker = readFileSync(path.join(buildDirectory, "service-worker.js"), "utf8")
const versionPayload = JSON.parse(
  readFileSync(path.join(buildDirectory, "_app/version.json"), "utf8"),
)
const buildVersion = typeof versionPayload?.version === "string" ? versionPayload.version : ""
const buildContractVersion = serviceWorker.match(/budabit-build:([^"'`\\]+)/)?.[1] || ""

const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

assert(
  !/navigator\.serviceWorker\.register\(/.test(indexHtml),
  "build/index.html contains a competing generated service-worker registration",
)
assert(serviceWorker.includes("budabit-app-"), "service worker is missing atomic app caches")
assert(serviceWorker.includes("APP_CACHE_READY"), "service worker is missing cache-ready signaling")
assert(
  serviceWorker.includes("APP_CACHE_GET_VERSION"),
  "service worker is missing its version handshake",
)
assert(
  serviceWorker.includes("APP_CACHE_ACTIVATED"),
  "service worker is missing cross-tab activation signaling",
)
assert(
  serviceWorker.includes("/_app/version.json"),
  "service worker does not gate installation on the published version marker",
)
assert(buildVersion, "build/_app/version.json does not contain a version")
assert(
  buildVersion && buildContractVersion === buildVersion,
  "service worker and build/_app/version.json use different build IDs",
)
assert(
  !indexHtml.includes("{DESCRIPTION}") &&
    !indexHtml.includes("{ACCENT}") &&
    !indexHtml.includes("{NAME}") &&
    !indexHtml.includes("{URL}"),
  "build/index.html still contains branding placeholders",
)

if (failures.length > 0) {
  console.error("Built service-worker contract failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Built service-worker contract passed")
