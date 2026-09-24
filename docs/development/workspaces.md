# Working in the Budabit monorepo

One plain Git clone and one root `pnpm install --frozen-lockfile` provide the host
and all maintained package sources. Use Node 22 (Jod) and pnpm 10.12.4. There are
no Git submodules and no package-level dependency installs.

| Directory under `packages/` | Responsibility |
| --- | --- |
| `nostr-git-core` | Git/Nostr protocol and worker implementation |
| `nostr-git-ui` | Git UI and worker integration |
| `budabit-releases-extension` | Release discovery, metadata verification and publication widget |
| `budabit-pipelines-extension` | Workflows, compute jobs and artifact attestations widget |
| `flotilla-extension-template` | Template application, shared bridge, `budabit-sdk`, manifest tools and scaffold CLI |
| `welshman` | Vendored Nostr libraries, with upstream procedure in `FORK.md` |

## Install and develop

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm dev                   # Budabit + core/UI watchers on port 1847
pnpm dev:releases          # Widget dev server in a separate terminal
pnpm dev:pipelines        # Work on Pipelines instead
pnpm dev:template         # Work on the template application instead
```

The widget dev commands launch separate iframe applications; they are not
automatically installed into the host. Use the normal Smart Widget installation
flow to embed the widget being developed. Package READMEs describe their host
contracts and widget manifests.

Widget dev servers default to strict port 5173. To run another alongside it, use
an explicit free port, for example `WIDGET_PORT=5174 pnpm dev:releases`.

The install lifecycle builds core/UI, the template's shared bridge, and the local
SDK exports. The root widget dev commands rebuild and watch their SDK/shared
dependency alongside Vite. For a one-off library rebuild, use
`pnpm --filter budabit-sdk --filter @budabit/ext-shared run build`.

## Build and verify

```sh
pnpm check                 # Host application typecheck
pnpm build                 # Host static application
pnpm build:extensions      # All widget/template child packages in dependency order
pnpm check:extensions      # Extension child-package typechecks
pnpm test:extensions       # Releases, Pipelines, template bridge/tools and SDK tests
pnpm test:releases         # Releases domain/SDK-consumer tests only
pnpm test:welshman         # Vendored Welshman tests
```

Use root filters for package-specific scripts, including coverage and controlled
widget E2E tests:

```sh
pnpm --filter budabit-releases-extension run test:coverage
pnpm --filter budabit-releases-extension run e2e
pnpm --filter budabit-pipelines-extension run build
pnpm --filter budabit-extension-template run build
```

Install a Playwright browser explicitly before E2E work. Unit/build commands do
not sign or publish widget events. The root contributor-bootstrap workflow
checks the self-contained checkout, frozen install, app and extension builds,
typechecks, and extension tests, plus Releases' lint and existing coverage gates.

Releases and Pipelines each emit `packages/iframe-app/dist/index.html` under
their own directory. The template emits its iframe plus SDK/tool `dist` outputs.
Host `pnpm build` and widget `pnpm build:extensions` are distinct artifacts.

## Shared dependencies and ownership

Releases and Pipelines declare `budabit-sdk: workspace:*`, resolving to
`packages/flotilla-extension-template/packages/sdk`. Changes to the SDK and its
consumers can be reviewed and tested in the same Budabit PR. The imported SDK is
Budabit's existing fork, including its community/visibility contracts; see its
`IMPORT.md` rather than assuming equivalence to another published SDK version.

The root workspace explicitly includes only the first level of extension child
packages. `packages/create-budabit-widget/template/` is a scaffold fixture that
generates independent projects: its own `pnpm-workspace.yaml` and CI are deliberate
and are not loaded by this monorepo. Keep real package additions in the root
workspace and update the root lockfile.

Submit all in-tree package changes against Budabit `dev`. Import provenance and
original licenses are recorded in the Releases/template directories. Their
former standalone repositories are historical sources, not submodule remotes.
The standalone Kanban repository remains outside this monorepo.

For old initialized template/core/UI checkouts, follow the
[migration instructions](../../CONTRIBUTING.md#updating-and-migrating-older-checkouts)
before rebasing across their conversion into tracked directories.
