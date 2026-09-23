import net from "node:net"
import {pathToFileURL} from "node:url"

export const DEV_PORT = 1847

export const checkDevPort = (port = DEV_PORT) =>
  new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once("error", error => {
      reject(
        "code" in error && error.code === "EADDRINUSE"
          ? new Error(
              `Port ${port} is already in use. Reuse the running dev server or stop it before starting pnpm dev.`,
            )
          : error,
      )
    })
    server.listen({port, exclusive: true}, () => server.close(resolve))
  })

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await checkDevPort()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
