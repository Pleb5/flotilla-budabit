#!/usr/bin/env node

import {readFileSync} from "node:fs"
import path from "node:path"

const buildDirectory = path.resolve("build")
const indexHtml = readFileSync(path.join(buildDirectory, "index.html"), "utf8")
const serviceWorker = readFileSync(path.join(buildDirectory, "service-worker.js"), "utf8")

const failures = []
const assert = (condition, message) => {
  if (!condition) failures.push(message)
}

assert(
  /navigator\.serviceWorker\.register\(["']\/service-worker\.js["']\)/.test(indexHtml),
  "build/index.html does not contain SvelteKit's production service-worker registration",
)
assert(
  !/navigator\.serviceWorker\.register\([^)]*type\s*:\s*["']module["']/.test(indexHtml),
  "build/index.html registers the production service worker as a module",
)
assert(serviceWorker.includes("budabit-app-"), "service worker is missing atomic app caches")
assert(serviceWorker.includes("APP_CACHE_READY"), "service worker is missing cache-ready signaling")

if (failures.length > 0) {
  console.error("Built service-worker contract failed:")
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log("Built service-worker contract passed")
