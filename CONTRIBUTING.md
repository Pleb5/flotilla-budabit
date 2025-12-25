# Contributing Guidelines

## Project Overview

Flotilla Budabit is a fork of [Flotilla](https://github.com/coracle-social/flotilla) - a svelte/typescript/capacitor project that serves as an alternative to Discord for Nostr users. This fork adds budabit-specific features and integrates the [nostr-git](https://github.com/chebizarro/nostr-git) protocol for decentralized Git operations.

A high-quality UX is a priority, with an emphasis on well-tested, intuitive designs, and robust implementations.

## Getting Started

Run `pnpm run dev` to get a dev server, and `pnpm run check:watch` to watch for typescript errors. When you're ready to commit, a pre-commit hook will run to lint and typecheck your work. To run the project on Android or iOS, use Android Studio or Xcode.

The `master` branch is intended to be automatically deployed to production, so always work on feature branches based on the `dev` branch.

### Working with Submodules

This project uses the `nostr-git` package as a **git submodule** located at `packages/nostr-git`. Most git-related functionality is handled by this separate package. When cloning or updating:

```bash
# Initialize and update submodules
git submodule update --init --recursive

# Build nostr-git UI components
cd packages/nostr-git/packages/ui
pnpm build
cd ../../../..
```

Changes to the nostr-git submodule should be contributed to the [nostr-git repository](https://github.com/chebizarro/nostr-git) directly, not to this repository.

### Working with Welshman

This project may use unreleased versions of [welshman](https://welshman.coracle.social). To develop against a local copy, clone welshman to a parent directory and add `link:../welshman/packages/packagename` to the `pnpm.overrides` section of your `package.json`:

```javascript
#!/usr/bin/env node

import fs from 'fs'
import path from 'path'

const packageJson = JSON.parse(fs.readFileSync('./package.json', 'utf8'))

packageJson.pnpm.overrides = Object.keys(packageJson.dependencies)
  .filter(pkg => pkg.startsWith('@welshman/'))
  .reduce((acc, pkg) => {
    const packageName = pkg.split('/')[1]
    acc[pkg] = `link:../welshman/packages/${packageName}` 
    return acc
  }, {})

fs.writeFileSync('./package.json', JSON.stringify(packageJson, null, 2) + '\n')

console.log('Added welshman package overrides.')
```

**Important:** Avoid committing overrides to `package.json` or `pnpm-lock.yaml`. These overrides persist until another `pnpm install` command runs.

## File Structure

The main parts of the application are as follows:

- `static` - static assets like fonts, images, etc.
- `src/assets` - svgs for use as icons.
- `src/lib` - general purpose components and utilities.
- **`src/lib/budabit`** - **budabit-specific features and extensions** (see Contribution Workflow below).
- `src/app/core/state` - environment variables, constants, custom stores, and some utilities derived from them.
- `src/app/core/requests` - utilities related to loading data from the nostr network.
- `src/app/core/commands` - utilities related to publishing nostr events and uploading media to blossom servers.
- `src/app/utils` - other application logic, including stuff related to modals, routing, etc.
- `src/app/editor` - configuration for `@welshman/editor` for use in various app views.
- `src/app/components` - reusable components that depend on other `app` stuff.
- `src/routes` - file-based routing interpreted by sveltekit.
- **`packages/nostr-git`** - **git submodule** containing nostr-git protocol implementation (separate repository).

Application organization is based on an acyclic dependency graph:

- `routes` can depend on anything
- `app/components` can depend on anything in `app` or `lib` 
- `app/utils` and `app/core` can only depend on `lib` 
- `lib` (and everything else) can depend only on external libraries
- **`lib/budabit` follows the same rules as `lib`** - it can only depend on external libraries and other `lib` modules

The main stylistic/organizational rule when working in this project is that imports should be sorted based on the dependency graph. Third-party libraries should come first, then `lib`, then `app`.

## System Architecture

Flotilla's architecture generally mirrors the file structure. State is stored using Svelte `store`s provided either by `@welshman/app` or by `app/core/state`, allowing for idiomatic svelte 4 usage (svelte 5 runes are [ghey](https://habla.news/u/hodlbod@coracle.social/1739830562159) and not allowed outside of UI components).

State is then synchronized to local storage or indexeddb using storage helpers provided by welshman in `routes/+layout.svelte`. Other top level synchronization logic generally belongs there.

`app/core/state` contains all environment variables, constants, custom stores, and utilities derived from them. Most stores are `derived` from our event `repository` using `deriveEventsMapped`, which efficiently queries the repository and maps events to custom data structures. Some of these data structures are provided by `welshman`, and some are defined in `app/core/state`. In either case, they can always be mapped back to an event, which is important for updating replaceables without dropping unknown data.

Here are a few important domain objects:

- Spaces are relays used as community groups. Their `url`s are core to a lot of data and components, and are frequently passed around from place to place.
- Chats are direct message conversations. There is currently some ambiguity in routing, since relays that don't support NIP 29 also have a "chat" tab, which uses vanilla NIP-C7.
- NIP 29 groups are called "rooms". Conventionally, "h" is a group id, while a "room" as an object representing the group's metadata.
- "Alerts" are records of requests the user has made to be notified, following [this NIP](https://github.com/nostr-protocol/nips/pull/1796)

`app/core/requests` contains utilities related to loading data from the nostr network. This might include feed manager utilities, loaders, or listeners.

`app/core/commands` contains utilities related to publishing nostr events and uploading media to blossom servers. This also includes utilities related to sending lighting payments, authenticating with relays, or probing relay policy. Event creation should generally be split into `make` functions which build the event, and `publish` functions which publish the event using `publishThunk`.

Any of these utilities can be included either in `app/components` or `routes`. Crucial to keep in mind is that nearly all global state runs through welshman's `repository` in a unidirectional way. To update state, run `publishThunk`, which immediately publishes the event to the local repository. State can be read from the repository using `deriveEventsMapped` or other utilities provided by welshman like `deriveProfile`.

Thunks are designed to reduce UI latency, handling signatures and delayed sending the background. In most cases, thunk status should be displayed to the user so that they can cancel sending or address errors.

Toast, modals, and sidebar dialogs are controlled in `app/util/modal` and `app/util/toast`. In both cases, component objects can be passed along with parameters, but care has to be taken that the calling component either doesn't unmount before the modal (as when one modal replaces another), or that `$state.snapshot` is appropriately called on any state runes. These components frequently run into weird svelte compiler bugs too, in which case you may have to do some silly things to cope.

## Contribution Workflow

### Where to Make Changes

This project is a **fork** of the upstream [Flotilla](https://github.com/coracle-social/flotilla) repository. Please follow these guidelines:

#### 1. **Budabit-Specific Features → `src/lib/budabit/` Module**

For budabit-specific functionality, add or modify code in the `src/lib/budabit/` directory:

- **State management**: `src/lib/budabit/state.ts`
- **Commands**: `src/lib/budabit/commands.ts`
- **Requests**: `src/lib/budabit/requests.ts`
- **Routes**: `src/lib/budabit/routes.ts`
- **Components**: `src/lib/budabit/components/`
- **Labels & utilities**: `src/lib/budabit/labels.ts`, `worker-singleton.ts`, etc.

**Do not modify core Flotilla code** in `src/app/` or `src/lib/` (outside of `budabit/`) for budabit-specific features. This keeps the fork clean and makes upstream syncing easier.

#### 2. **Core Flotilla Improvements → Upstream**

If you find bugs or want to add features that would benefit **all Flotilla users** (not just budabit):

1. Contribute to the [upstream Flotilla repository](https://github.com/coracle-social/flotilla)
2. Once merged upstream, we can pull those changes into this fork
3. This ensures improvements benefit the entire Flotilla community

#### 3. **Git Functionality → `nostr-git` Submodule**

The `packages/nostr-git` directory is a **separate git repository** managed as a submodule. For changes to git-related functionality:

1. Contribute to the [nostr-git repository](https://github.com/chebizarro/nostr-git) directly
2. Update the submodule reference in this repository after changes are merged
3. Do not modify files inside `packages/nostr-git/` directly in this repository

```bash
# To update the nostr-git submodule to latest
cd packages/nostr-git
git pull origin main
cd ../..
git add packages/nostr-git
git commit -m "Update nostr-git submodule"
```

### Issues and Pull Requests

All work by contributors should be done against an issue. If there is no issue for the work you're doing, please open one or ask the project owner to open one. 

All PRs should be opened against the `dev` branch (unless for hotfixes). **Clearly indicate in your PR** whether the change is:
- Budabit-specific (changes in `src/lib/budabit/`)
- A potential upstream contribution (core Flotilla changes)
- A submodule update (nostr-git)

## Communication

Discussion about Flotilla Budabit development should be done through:
- **Issues**: For bugs, features, and general development discussion
- **Pull Requests**: For code review and implementation discussion

For upstream Flotilla discussions, visit [the upstream Flotilla space](https://app.flotilla.social/spaces/internal.coracle.social).

## Project License

This project is licensed under the MIT license. By contributing, you agree to waive all intellectual property rights to your contributions to this project.

