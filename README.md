# Flotilla Budabit

A discord-like nostr client based on the idea of "relays as groups", enhanced with nostr-git functionality for decentralized Git operations.

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
git clone https://github.com/chebizarro/flotilla-budabit.git
cd flotilla-budabit
```

### 4. Initialize Git Submodules

This project includes the `nostr-git` submodule which provides Git functionality:

```bash
# Initialize and update submodules
git submodule init
git submodule update

# Or clone with submodules in one command
git clone --recursive https://github.com/chebizarro/flotilla-budabit.git
```

### 5. Install Dependencies

```bash
# Install all dependencies
pnpm install
```

### 6. Build nostr-git Components

The nostr-git submodule needs to be built:

```bash
# Build the nostr-git UI components
cd packages/nostr-git/packages/ui
pnpm build
cd ../../..
```

### 7. Start Development Server

```bash
# Start the development server
pnpm dev
```

The application will be available at `http://localhost:5173` (or the next available port).

## Features

Flotilla Budabit extends the original Flotilla with decentralized Git functionality through the nostr-git protocol:

- **Decentralized Git Repositories**: Create and manage Git repositories using Nostr relays
- **Issue Tracking**: Create, manage, and track issues with status updates
- **Patch Management**: Submit, review, and merge patches
- **Collaborative Development**: Work with teams using Nostr-based communication
- **Real-time Updates**: Reactive feeds for issues and patches with live status updates

## Environment

You can also optionally create an `.env` file and populate it with the following environment variables (see `.env` for examples):

- `VITE_DEFAULT_PUBKEYS` - A comma-separated list of hex pubkeys for bootstrapping web of trust.
- `VITE_PLATFORM_URL` - The url where the app will be hosted. This is only used for build-time population of meta tags.
- `VITE_PLATFORM_NAME` - The name of the app
- `VITE_PLATFORM_LOGO` - A logo url for the app
- `VITE_PLATFORM_RELAYS` - A list of comma-separated relay urls that will make flotilla operate in "platform mode". Disables all space browse/add/select functionality and makes the first platform relay the home page.
- `VITE_PLATFORM_ACCENT` - A hex color for the app's accent color
- `VITE_PLATFORM_DESCRIPTION` - A description of the app
- `VITE_GLITCHTIP_API_KEY` - A Sentry DSN for use with glitchtip (error reporting)
- `GLITCHTIP_AUTH_TOKEN` - A glitchtip auth token for error reporting

If you're deploying a custom version of flotilla, be sure to remove the `plausible.coracle.social` script from `app.html`. This sends analytics to a server hosted by the developer.

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

**nostr-git components not working**: Make sure you've built the nostr-git UI components:
```bash
cd packages/nostr-git/packages/ui
pnpm build
cd ../../..
```

**Node.js version issues**: Ensure you're using the correct Node.js version:
```bash
# Check current version
node --version

# Switch to correct version if needed
nvm use lts/jod
```

**Submodule issues**: If the nostr-git submodule is not properly initialized:
```bash
# Remove and reinitialize submodules
git submodule deinit -f packages/nostr-git
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

## Deployment

To run your own Flotilla Budabit, it's as simple as:

```sh
# Install dependencies (including submodules)
git submodule update --init --recursive
pnpm install

# Build the application (automatically builds nostr-git components)
pnpm run build

# Serve the built application
npx serve build
```

The build script automatically handles building the nostr-git UI components, so you don't need to build them manually for deployment.

Or, if you prefer to use a container:

```sh
podman run -d -p 3000:3000 ghcr.io/coracle-social/flotilla:latest
```

Alternatively, you can copy the build files into a directory of your choice and serve it yourself:

```sh
mkdir ./mount
podman run -v ./mount:/app/mount ghcr.io/coracle-social/flotilla:latest bash -c 'cp -r build/* mount'
```
