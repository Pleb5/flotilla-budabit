# Releases quick start

Use Node 22.12+ and pnpm 10.12.4. Run from the Budabit monorepo root:

```sh
pnpm install --frozen-lockfile
pnpm dev:releases
```

The widget at `http://localhost:5173` waits for repository context when opened alone. Embed it in Budabit's Releases repo tab, or use the disposable test host:

```sh
pnpm --filter @budabit-releases-extension/iframe dev --host localhost --port 5179 --strictPort
```

Open `http://localhost:5179/test-host/`. Its signing/publication controls use deterministic test keys and in-memory responses, not real accounts or relay connections. For file-verification testing, select a file containing exactly the four bytes `test`.

```sh
pnpm --filter budabit-releases-extension run verify
WIDGET_APP_URL=https://your-cdn.example/releases.html pnpm --filter budabit-releases-extension run manifest:generate
```

The manifest command only generates unsigned files. Uploading or publishing requires a separate intentional command. See the [README](../README.md) for the supported host, actual user flow, verification limits and deployment instructions.
