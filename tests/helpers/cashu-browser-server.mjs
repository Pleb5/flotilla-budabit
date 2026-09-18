// Opt-in local browser fixture, never part of the production bundle. Run with
// Node's TypeScript stripping support and the normal workspace watchers active:
// node tests/helpers/cashu-browser-server.mjs
import {createServer} from "vite"
import {CashuTestMint} from "./cashu-mint.ts"

process.env.VITE_CASHU_WALLET_ENABLED = "1"
const mint = new CashuTestMint({url: "http://localhost:1848"})
const server = await createServer({
  cacheDir: "node_modules/.vite-cashu-verify",
  server: {host: "localhost", port: 1848, strictPort: true},
  plugins: [
    {
      name: "cashu-synthetic-verification",
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          const action = req.url.split("/")[2]
          if (
            req.url.startsWith("/__fixture__/") &&
            ["pay", "issued", "recover"].includes(action) &&
            req.method === "POST"
          ) {
            const id = req.url.split("/").at(-1)
            if (!mint.quotes.has(id)) {
              res.statusCode = 404
              res.end()
              return
            }
            if (action === "pay") mint.pay(id)
            if (action === "issued") mint.quotes.get(id).state = "ISSUED"
            if (action === "recover") {
              let body = ""
              for await (const chunk of req) body += chunk
              mint.issueBeforeCrash(id, JSON.parse(body).outputs)
            }
            res.end(`synthetic ${action}`)
            return
          }
          if (!req.url.startsWith("/v1/")) return next()
          let body = ""
          for await (const chunk of req) body += chunk
          try {
            const response = await mint.fetch(new URL(req.url, mint.url), {
              method: req.method,
              body: body || undefined,
            })
            res.statusCode = response.status
            res.setHeader("Content-Type", "application/json")
            res.end(await response.text())
          } catch {
            res.statusCode = 500
            res.end(JSON.stringify({error: "Synthetic mint request failed"}))
          }
        })
      },
    },
  ],
})
await server.listen()
server.printUrls()
