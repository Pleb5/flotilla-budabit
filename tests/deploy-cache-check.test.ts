import {execFile} from "node:child_process"
import {createServer, type Server} from "node:http"
import path from "node:path"
import {fileURLToPath} from "node:url"
import {promisify} from "node:util"
import {afterEach, describe, expect, it} from "vitest"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const checker = path.join(projectRoot, "scripts/check-deploy-cache.mjs")
let server: Server | null = null

const startServer = async ({
  marker,
  workerVersion,
  immutableContentType = "application/javascript",
}: {
  marker: Record<string, string>
  workerVersion: string
  immutableContentType?: string
}) => {
  server = createServer((request, response) => {
    const pathname = new URL(request.url || "/", "http://localhost").pathname
    const immutable = pathname.startsWith("/_app/immutable/")
    let contentType = "application/javascript"
    let body = ""

    if (pathname === "/" || pathname === "/settings") {
      contentType = "text/html"
      body = '<script src="/_app/immutable/app.js"></script>'
    } else if (pathname === "/_app/version.json") {
      contentType = "application/json"
      body = JSON.stringify(marker)
    } else if (pathname === "/service-worker.js") {
      body = `self.__SW_BUILD_CONTRACT__="budabit-build:${workerVersion}"`
    } else if (pathname === "/manifest.webmanifest") {
      contentType = "application/manifest+json"
      body = "{}"
    } else if (immutable || pathname === "/sw.js") {
      if (immutable) contentType = immutableContentType
      body = "export {}"
    } else {
      response.writeHead(404)
      response.end()
      return
    }

    response.writeHead(200, {
      "cache-control": immutable
        ? "public, max-age=31536000, immutable"
        : "no-store, must-revalidate",
      "content-length": Buffer.byteLength(body),
      "content-type": contentType,
    })
    response.end(request.method === "HEAD" ? "" : body)
  })

  await new Promise<void>(resolve => server?.listen(0, "127.0.0.1", resolve))
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Test server did not bind")
  return `http://127.0.0.1:${address.port}`
}

afterEach(async () => {
  if (!server) return
  await new Promise<void>((resolve, reject) =>
    server?.close(error => (error ? reject(error) : resolve())),
  )
  server = null
})

describe("deployed release validation", () => {
  it("accepts a stable marker that matches the service worker", async () => {
    const origin = await startServer({marker: {version: "build-b"}, workerVersion: "build-b"})
    const {stdout} = await execFileAsync("node", [checker, origin], {cwd: projectRoot})

    expect(stdout).toContain("Deploy cache verification passed")
  })

  it("rejects a deployment sentinel", async () => {
    const origin = await startServer({
      marker: {version: "", status: "deploying"},
      workerVersion: "build-b",
    })

    await expect(
      execFileAsync("node", [checker, origin], {cwd: projectRoot}),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("deployment sentinel is still published"),
    })
  })

  it("rejects a marker and worker build mismatch", async () => {
    const origin = await startServer({marker: {version: "build-b"}, workerVersion: "build-a"})

    await expect(
      execFileAsync("node", [checker, origin], {cwd: projectRoot}),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("release marker and service worker use different build IDs"),
    })
  })

  it("rejects an immutable path served by the HTML fallback", async () => {
    const origin = await startServer({
      marker: {version: "build-b"},
      workerVersion: "build-b",
      immutableContentType: "text/html",
    })

    await expect(
      execFileAsync("node", [checker, origin], {cwd: projectRoot}),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining("expected an immutable asset, got HTML fallback"),
    })
  })
})
