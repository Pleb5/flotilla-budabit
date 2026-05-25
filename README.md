# Budabit

Budabit is a community-first Nostr client for social Git collaboration. Communities are identified by Communikey pubkeys, not relay URLs, and Git collaboration is exposed through Nostr Git events and a canonical `/git` surface.

If you would like to be interoperable with Flotilla, please check out this guide: https://habla.news/u/hodlbod@coracle.social/1741286140797

## Prerequisites

- **Node.js**: This project requires Node.js LTS (Jod) as specified in `.nvmrc`
- **pnpm**: Package manager for Node.js
- **Git**: For cloning and submodule management

## Setup Instructions

### 1. Install Node.js with nvm (Recommended)

If you don't have nvm installed, install it first:

```bash
# Install nvm (macOS/Linux)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Or on Windows
# Download and run the installer from: https://github.com/coreybutler/nvm-windows
```

Then install and use the correct Node.js version:

```bash
# Install and use Node.js LTS (Jod)
nvm install lts/jod
nvm use lts/jod

# Verify Node.js version
node --version
```

### 2. Install pnpm

```bash
# Install pnpm globally
npm install -g pnpm

# Verify installation
pnpm --version
```

### 3. Clone the Repository

```bash
# Clone the repository
git clone https://github.com/Pleb5/flotilla-budabit.git budabit
cd budabit
```

### 4. Initialize Git Submodules

This project includes multiple Git submodules (nostr-git core/ui and extension workspaces):

```bash
# Sync submodule remotes from .gitmodules and fetch pinned commits
git submodule sync --recursive
git submodule update --init --recursive
```

### 5. Install Dependencies

```bash
# Install all dependencies
pnpm install
```

### 6. Start Development Server

```bash
# Start the development server
pnpm dev
```

The application will be available at `http://localhost:1847` (or the next available port).

## Features

Budabit combines Communikey communities with decentralized Git functionality through the Nostr Git protocol:

- **Communikey Communities**: Select a community by hex pubkey, `npub`, or `ncommunity`; community definitions provide relays, sections, permissions, and media servers
- **Decentralized Git Repositories**: Discover and manage Git repositories using Nostr relays and Git remotes
- **Issue And Pull Request Tracking**: Create, manage, and discuss issues and PRs with Nostr-native status updates
- **Community Catalogs**: Target repositories, calendar events, goals, permalinks, and widgets to `/c/<community>` pages
- **Collaborative Development**: Work with teams using Nostr-based communication, moderation, and access requests

## Environment

You can also optionally create an `.env` file and populate it with the following environment variables (see `.env` for examples):

- `VITE_DEFAULT_PUBKEYS` - A comma-separated list of hex pubkeys for bootstrapping web of trust
- `VITE_APP_URL` - Public app URL used for app metadata and internal link detection
- `VITE_APP_NAME` - App name used for protocol metadata
- `VITE_APP_LOGO` - App/PWA logo URL
- `VITE_DEFAULT_COMMUNITY` - Optional recommended starting community as a hex pubkey, `npub`, or `ncommunity`
- `VITE_INDEXER_RELAYS` - Optional comma-separated relay URLs used for discovery and community bootstrap
- `VITE_APP_ACCENT` - A hex color for the app's accent color
- `VITE_GIT_RELAYS` - Comma-separated Nostr relays used for Git repository discovery
- `VITE_GIT_DEFAULT_CORS_PROXY` - Default CORS proxy for Git HTTP operations

## Troubleshooting

### Common Issues

**"Cannot find module" errors**: If you encounter module resolution errors, try:

```bash
# Clear node_modules and reinstall
rm -rf node_modules
pnpm install

# Clear SvelteKit cache
rm -rf .svelte-kit
```

**Submodule mismatch errors**: Make sure submodule remotes are synced and pinned commits are fetched:

```bash
git submodule sync --recursive
git submodule update --init --recursive
```

**Node.js version issues**: Ensure you're using the correct Node.js version:

```bash
# Check current version
node --version

# Switch to correct version if needed
nvm use lts/jod
```

**Submodule issues**: If submodules are in a broken local state:

```bash
# Remove and reinitialize submodules
git submodule deinit -f --all
git submodule sync --recursive
git submodule update --init --recursive
```

## Development

See [./CONTRIBUTING.md](CONTRIBUTING.md) for detailed development guidelines.

### Quick Start for Development

```bash
# Start development server with hot reload
pnpm dev

# Run type checking in watch mode
pnpm check:watch

# Run linting
pnpm lint

# Format code
pnpm format
```

For testing the dev server from a phone over a VPS tunnel (with remote console/network debugging, including ocmux profile setup), see `docs/ops/phone-dev-vps.md`.

### E2E (Playwright)

Install Playwright browsers (Chromium) used for E2E tests:

```bash
pnpm e2e:install
```

Run the E2E suite:

```bash
pnpm e2e
```

Optionally run in UI mode or headed mode:

```bash
pnpm e2e:ui
pnpm e2e:headed
```

Playwright will start (or reuse) the dev server at `http://127.0.0.1:1847`.

## Deployment

If you want the shortest path for running your own instance, read `docs/ops/self-hosting.md`.

To run your own Budabit instance, it's as simple as:

```sh
# Install dependencies (including submodules)
git clone https://github.com/Pleb5/flotilla-budabit.git budabit
cd budabit
git submodule sync --recursive
git submodule update --init --recursive

# Build for production (installs deps, rebuilds native modules, then runs build.sh)
pnpm run build-in-production

# Serve the built application
npx serve -s build
```

`build-in-production.sh` wraps the full production flow, including dependency install and native rebuilds.

For frequent self-hosted updates:

```sh
git pull --rebase
git submodule sync --recursive
git submodule update --init --recursive
pnpm run build-in-production
```

Or, if you prefer to use a container, build and run the local Dockerfile:

```sh
podman build -t budabit .
podman run -d -p 1847:1847 budabit
```

Alternatively, you can copy the build files into a directory of your choice and serve it yourself:

```sh
mkdir ./mount
podman create --name budabit-build budabit
podman cp budabit-build:/app/build/. ./mount/
podman rm budabit-build
```
