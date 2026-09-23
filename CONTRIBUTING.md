# Contributing Guidelines

## Project Overview

Budabit is a community-first Nostr client for social Git collaboration, forked
from [Flotilla](https://github.com/coracle-social/flotilla). It uses SvelteKit,
Svelte 5, TypeScript, and in-tree nostr-git workspaces for decentralized Git operations.

A high-quality UX is a priority, with an emphasis on well-tested, intuitive designs, and robust implementations.

## Getting Started

Follow the [README setup](README.md#setup-instructions) with Node.js 22 (Jod) and
pnpm 10.12.4. Work on a feature branch based on `origin/dev`:

```sh
git clone --recurse-submodules --branch dev https://github.com/Pleb5/flotilla-budabit.git budabit
cd budabit
git switch -c my-feature origin/dev
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` builds and watches core/UI as well as the app. Use `pnpm check:watch`
for continuous typechecking. Before submitting, run `pnpm check`, `pnpm lint`,
and the focused tests for your change; there is no repository-provided pre-commit
hook that runs these checks automatically. Run app unit tests with `pnpm test:main`
and see the README for Playwright setup.

`master` is the production branch. Open feature PRs against `dev`. If contributing
through a GitHub fork, keep `origin` pointing at Pleb5 and add your fork as a
separate push remote:

```sh
git remote add fork https://github.com/YOUR_ACCOUNT/flotilla-budabit.git
git push -u fork my-feature
```

### Workspace Packages and the Template Submodule

Core (`packages/nostr-git-core`), UI (`packages/nostr-git-ui`), pipelines
(`packages/budabit-pipelines-extension`), and Welshman (`packages/welshman`) are
ordinary directories tracked by Budabit. Changes to their source belong in a
Budabit commit and PR.

The only submodule is `packages/flotilla-extension-template`. Its pinned checkout
is required by the root Vitest project configuration, including selected app tests.
Contribute template changes to [Pleb5/flotilla-extension-template](https://github.com/Pleb5/flotilla-extension-template),
then update the gitlink here to the exact reviewed, publicly fetchable commit:

```sh
git -C packages/flotilla-extension-template fetch origin
git -C packages/flotilla-extension-template checkout --detach REVIEWED_COMMIT
git add packages/flotilla-extension-template
git commit -m "chore(template): update reviewed template revision"
```

Kanban is an independent [repository on GRASP](https://grasp.budabit.club/npub16p8v7varqwjes5hak6q7mz6pygqm4pwc6gve4mrned3xs8tz42gq7kfhdw/budabit-kanban-extension.git).
Clone it outside Budabit, install its own dependencies, and submit widget changes
there. Budabit does not discover or test an optional local Kanban checkout.

### Working with Welshman

Budabit owns a vendored Welshman fork under `packages/welshman`. The workspace
packages resolve directly to TypeScript source; no sibling checkout or package
overrides are needed. Edit that source here and run `pnpm test:welshman` and
`pnpm check`. See [packages/welshman/FORK.md](packages/welshman/FORK.md) for the
fork's intentional differences and the `git subtree` upstream-import procedure.

## File Structure

The main parts of the application are as follows:

- `static` - static assets like fonts, images, etc.
- `src/assets` - svgs for use as icons.
- `src/lib` - general purpose components and utilities.
- **`src/app/core/git-*`** - **Budabit git state, requests, and commands**.
- `src/app/core/state` - environment variables, constants, custom stores, and some utilities derived from them.
- `src/app/core/requests` - utilities related to loading data from the nostr network.
- `src/app/core/commands` - utilities related to publishing nostr events and uploading media to blossom servers.
- `src/app/utils` - other application logic, including stuff related to modals, routing, etc.
- `src/app/editor` - configuration for `@welshman/editor` for use in various app views.
- `src/app/components` - reusable components that depend on other `app` stuff.
- `src/routes` - file-based routing interpreted by sveltekit.
- **`packages/nostr-git-core`** - in-tree workspace containing nostr-git core protocol logic.
- **`packages/nostr-git-ui`** - in-tree workspace containing nostr-git UI and worker integration.
- **`packages/welshman`** - vendored Welshman source and its workspace packages.
- **`packages/flotilla-extension-template`** - the sole Git submodule.

Application organization is based on an acyclic dependency graph:

- `routes` can depend on anything
- `app/components` can depend on anything in `app` or `lib`
- `app/utils` and `app/core` can only depend on `lib`
- `lib` (and everything else) can depend only on external libraries
- Budabit-specific app code belongs in `src/app`; avoid adding new fork-only directories under `src/lib`.

The main stylistic/organizational rule when working in this project is that imports should be sorted based on the dependency graph. Third-party libraries should come first, then `lib`, then `app`.

## System Architecture

The architecture generally mirrors the file structure. Shared state uses Svelte
stores from `@welshman/app` or `app/core/state`. Keep shared application state in
those stores; use Svelte 5 runes within UI components where appropriate.

State is then synchronized to local storage or indexeddb using storage helpers provided by welshman in `routes/+layout.svelte`. Other top level synchronization logic generally belongs there.

`app/core/state` contains all environment variables, constants, custom stores, and utilities derived from them. Most stores are `derived` from our event `repository` using `deriveEventsMapped`, which efficiently queries the repository and maps events to custom data structures. Some of these data structures are provided by `welshman`, and some are defined in `app/core/state`. In either case, they can always be mapped back to an event, which is important for updating replaceables without dropping unknown data.

Here are a few important domain objects:

- Spaces are relays used as community groups. Their `url`s are core to a lot of data and components, and are frequently passed around from place to place.
- Chats are direct message conversations. There is currently some ambiguity in routing, since relays that don't support NIP 29 also have a "chat" tab, which uses vanilla NIP-C7.
- NIP 29 groups are called "rooms". Conventionally, "h" is a group id, while a "room" as an object representing the group's metadata.
- Git email digests are one account-wide, provider-specific subscription derived from explicit repository Watch settings.

`app/core/requests` contains utilities related to loading data from the nostr network. This might include feed manager utilities, loaders, or listeners.

`app/core/commands` contains utilities related to publishing nostr events and uploading media to blossom servers. This also includes utilities related to sending lighting payments, authenticating with relays, or probing relay policy. Event creation should generally be split into `make` functions which build the event, and `publish` functions which publish the event using `publishThunk`.

Any of these utilities can be included either in `app/components` or `routes`. Crucial to keep in mind is that nearly all global state runs through welshman's `repository` in a unidirectional way. To update state, run `publishThunk`, which immediately publishes the event to the local repository. State can be read from the repository using `deriveEventsMapped` or other utilities provided by welshman like `deriveProfile`.

Thunks are designed to reduce UI latency, handling signatures and delayed sending the background. In most cases, thunk status should be displayed to the user so that they can cancel sending or address errors.

Toast, modals, and sidebar dialogs are controlled in `app/util/modal` and `app/util/toast`. In both cases, component objects can be passed along with parameters, but care has to be taken that the calling component either doesn't unmount before the modal (as when one modal replaces another), or that `$state.snapshot` is appropriately called on any state runes. These components frequently run into weird svelte compiler bugs too, in which case you may have to do some silly things to cope.

## Contribution Workflow

### Where to Make Changes

This project is a **fork** of the upstream [Flotilla](https://github.com/coracle-social/flotilla) repository. Please follow these guidelines:

#### 1. **Budabit-Specific Features → `src/app/` Modules**

For budabit-specific functionality, add or modify code in the canonical app directories:

- **Git state management**: `src/app/core/git-state.ts`
- **Git commands**: `src/app/core/git-commands.ts`
- **Git requests**: `src/app/core/git-requests.ts`
- **Components**: `src/app/components/`
- **Generic UI primitives**: `src/lib/components/`
- **Utilities**: `src/app/util/`

Avoid reintroducing `src/lib/budabit/`; app-specific code should live under `src/app`, while reusable primitives belong under `src/lib/components`.

#### 2. **Core Flotilla Improvements → Upstream**

If you find bugs or want to add features that would benefit **all Flotilla users** (not just budabit):

1. Contribute to the [upstream Flotilla repository](https://github.com/coracle-social/flotilla)
2. Once merged upstream, we can pull those changes into this fork
3. This ensures improvements benefit the entire Flotilla community

#### 3. **Git Functionality → In-Tree `nostr-git` Workspaces**

Edit `packages/nostr-git-core` and `packages/nostr-git-ui` directly and include
those files in the Budabit PR. They have been ordinary tracked directories since
June 2026; changing a separate repository or running `git submodule update --remote`
does not update them.

Use `pnpm dev` to rebuild/watch both libraries with the app, or build explicitly:

```bash
pnpm --filter @nostr-git/core --filter @nostr-git/ui run build
pnpm check
```

Run focused tests for the library being changed. Keep unrelated app and library
changes separate; tightly coupled changes may share a commit. Coordinate any
backport to an external upstream independently of the Budabit PR.

### Updating and Migrating Older Checkouts

For a clean feature branch using the current layout:

```sh
git fetch --no-recurse-submodules origin
git -c submodule.recurse=false rebase origin/dev
git submodule sync --recursive
git submodule update --init --recursive
pnpm install --frozen-lockfile
```

`clone --recurse-submodules` initializes the template; it does not set
`submodule.recurse=true`. With that setting enabled, `git pull --rebase` can fail
with `cannot rebase with locally recorded submodule modifications` when local
commits change a gitlink. Fetch/rebase the parent separately as above, then update
the template checkout. Publish template commits before referencing them in Budabit.

**Pre-June-2026 core/UI/pipelines checkouts:** their initialized submodule files
can block rebasing onto the conversion to ordinary directories, even when an
app-only feature and the submodules are clean. Git reports `untracked working tree
files would be overwritten by checkout` and `could not detach HEAD`.

Before crossing that conversion, save any work/commits from the old package
repositories in independent checkouts. While still on the old branch, deinitialize
only paths that are still submodules there:

```sh
git submodule deinit -- packages/nostr-git-core packages/nostr-git-ui packages/budabit-pipelines-extension
```

Use the subset listed by that revision's `.gitmodules`; do not force deinit to
discard changes. Then fetch/rebase as above. A feature commit that changes an old
gitlink will still have a file/directory or modify/delete conflict: port its
underlying package changes into the new tracked directory rather than blindly
skipping the commit.

**Removing the former Kanban submodule:** save any local widget work in its
standalone repository first. On a revision that still registers it, run
`git submodule deinit -- packages/budabit-kanban-extension` before updating
Budabit. If an old checkout leaves that directory behind, move it outside Budabit;
the current explicit workspace list and test configuration do not load it.

### Issues and Pull Requests

All work by contributors should be done against an issue. If there is no issue for the work you're doing, please open one or ask the project owner to open one.

All PRs should be opened against the `dev` branch (unless for hotfixes). **Clearly indicate in your PR** whether the change is:

- Budabit-specific (changes in `src/app/core/git-*`, `src/app/components`, or `src/app/util`)
- A potential upstream contribution (core Flotilla changes)
- An in-tree core/UI, pipelines, or Welshman change
- A template submodule update

## Communication

Discussion about Flotilla Budabit development should be done through:

- **Issues**: For bugs, features, and general development discussion
- **Pull Requests**: For code review and implementation discussion

For upstream Flotilla discussions, visit [the upstream Flotilla space](https://app.flotilla.social/spaces/internal.coracle.social).

## Project License

This project is licensed under the MIT license. By contributing, you agree to waive all intellectual property rights to your contributions to this project.
