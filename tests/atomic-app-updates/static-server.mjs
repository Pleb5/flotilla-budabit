import {createReadStream} from "node:fs"
import {cp, mkdir, readFile, rm, stat} from "node:fs/promises"
import {createServer} from "node:http"
import path from "node:path"
import {fileURLToPath} from "node:url"

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const outputRoot = path.join(projectRoot, "test-results/atomic-app-updates")
const fixture = JSON.parse(await readFile(path.join(outputRoot, "state.json"), "utf8"))
let failedAsset = ""
let failedAssetRequests = 0
let workerMarkerReads = {}

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".webp": "image/webp",
}

const copyBuildWithoutMarker = async () => {
  await cp(
    path.join(fixture.buildB, "_app/immutable"),
    path.join(fixture.remote, "_app/immutable"),
    {
      recursive: true,
    },
  )

  const entries = await import("node:fs/promises").then(fs => fs.readdir(fixture.buildB))
  for (const entry of entries) {
    if (entry === "_app") continue
    const source = path.join(fixture.buildB, entry)
    const destination = path.join(fixture.remote, entry)
    await rm(destination, {recursive: true, force: true})
    await cp(source, destination, {recursive: true})
  }
}

const sendJson = (response, status, payload) => {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  })
  response.end(JSON.stringify(payload))
}

const handleControl = async (request, response, pathname) => {
  if (request.method === "GET" && pathname === "/__atomic/state") {
    sendJson(response, 200, {
      failedAsset,
      failedAssetRequests,
      failingAsset: fixture.failingAsset,
      workerMarkerReads,
    })
    return true
  }

  if (request.method !== "POST") return false

  if (pathname === "/__atomic/reset") {
    await rm(fixture.remote, {recursive: true, force: true})
    await mkdir(fixture.remote, {recursive: true})
    await cp(fixture.buildA, fixture.remote, {recursive: true})
    failedAsset = ""
    failedAssetRequests = 0
    workerMarkerReads = {}
  } else if (pathname === "/__atomic/stage-b") {
    await copyBuildWithoutMarker()
  } else if (pathname === "/__atomic/publish-b") {
    await cp(
      path.join(fixture.buildB, "_app/version.json"),
      path.join(fixture.remote, "_app/version.json"),
    )
  } else if (pathname === "/__atomic/fail-b-asset") {
    failedAsset = fixture.failingAsset
    failedAssetRequests = 0
  } else if (pathname === "/__atomic/allow-b-asset") {
    failedAsset = ""
  } else {
    return false
  }

  sendJson(response, 200, {ok: true})
  return true
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", "http://localhost")
    if (await handleControl(request, response, url.pathname)) return

    if (request.method === "GET" && url.pathname === "/__atomic/legacy-window") {
      const html = `<!doctype html><title>Legacy client</title><script>navigator.serviceWorker.register('/service-worker.js')</script>`
      response.writeHead(200, {
        "cache-control": "no-store",
        "content-length": Buffer.byteLength(html),
        "content-type": "text/html; charset=utf-8",
      })
      response.end(html)
      return
    }

    if (url.pathname === failedAsset) {
      failedAssetRequests += 1
      response.writeHead(503, {"cache-control": "no-store", "content-type": "text/plain"})
      response.end("Injected atomic update failure")
      return
    }

    const workerVersion = url.searchParams.get("_budabitWorker") || ""
    if (url.pathname === "/_app/version.json" && workerVersion) {
      const marker = JSON.parse(
        await readFile(path.join(fixture.remote, "_app/version.json"), "utf8"),
      )
      const key = `${workerVersion}:${marker.version || marker.status || "missing"}`
      workerMarkerReads[key] = (workerMarkerReads[key] || 0) + 1
    }

    const decodedPath = decodeURIComponent(url.pathname)
    const relativePath = decodedPath.replace(/^\/+/, "")
    let filePath = path.resolve(fixture.remote, relativePath || "index.html")
    if (!filePath.startsWith(`${path.resolve(fixture.remote)}${path.sep}`)) {
      response.writeHead(403)
      response.end()
      return
    }

    let fileStat = await stat(filePath).catch(() => null)
    if ((!fileStat || !fileStat.isFile()) && !decodedPath.startsWith("/_app/")) {
      filePath = path.join(fixture.remote, "index.html")
      fileStat = await stat(filePath).catch(() => null)
    }
    if (!fileStat?.isFile()) {
      response.writeHead(404, {"cache-control": "no-store", "content-type": "text/plain"})
      response.end("Not found")
      return
    }

    const immutable = decodedPath.startsWith("/_app/immutable/")
    const headers = {
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-store, must-revalidate",
      "content-length": fileStat.size,
      "content-type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    }
    if (decodedPath === "/service-worker.js") headers["service-worker-allowed"] = "/"
    response.writeHead(200, headers)
    if (request.method === "HEAD") response.end()
    else createReadStream(filePath).pipe(response)
  } catch (error) {
    sendJson(response, 500, {error: error instanceof Error ? error.message : String(error)})
  }
})

server.listen(1848, "localhost")

const close = () => server.close(() => process.exit(0))
process.on("SIGINT", close)
process.on("SIGTERM", close)
