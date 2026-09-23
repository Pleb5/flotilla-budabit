import net from "node:net"
import type {AddressInfo} from "node:net"
import {describe, expect, it} from "vitest"
import {checkDevPort} from "../scripts/check-dev-port.mjs"

const listen = (server: net.Server, port = 0) =>
  new Promise<number>((resolve, reject) => {
    server.once("error", reject)
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port))
  })

const close = (server: net.Server) => new Promise<void>(resolve => server.close(() => resolve()))

describe("dev startup port check", () => {
  it("rejects an occupied port before workspace builds can start", async () => {
    const server = net.createServer()
    const port = await listen(server)
    try {
      await expect(checkDevPort(port)).rejects.toThrow(`Port ${port} is already in use`)
    } finally {
      await close(server)
    }
  })

  it("releases an available port for Vite to bind", async () => {
    const server = net.createServer()
    const port = await listen(server)
    await close(server)
    await checkDevPort(port)
    try {
      await expect(listen(server, port)).resolves.toBe(port)
    } finally {
      await close(server)
    }
  })
})
