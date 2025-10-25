#!/usr/bin/env bash

# Increase Node.js memory limit globally for this script
export NODE_OPTIONS="--max-old-space-size=8192"

temp_env=$(declare -p -x)

if [ -f .env.template ]; then
  source .env.template
fi

if [ -f .env ]; then
  source .env
fi

# Avoid overwriting env vars provided directly
# https://stackoverflow.com/a/69127685/1467342
eval "$temp_env"

if [[ -z $VITE_BUILD_HASH ]]; then
  export VITE_BUILD_HASH=$(git rev-parse --short HEAD)
fi

if [[ $VITE_PLATFORM_LOGO =~ ^https://* ]]; then
  curl $VITE_PLATFORM_LOGO > static/logo.png
  export VITE_PLATFORM_LOGO=static/logo.png
fi

# Build nostr-git CORE first (required for worker and lib files)
echo "Building @nostr-git/core..."
if [ -d "packages/nostr-git/packages/core" ]; then
  (cd packages/nostr-git/packages/core && pnpm build)
else
  echo "Warning: nostr-git core directory not found. Make sure submodules are initialized."
  echo "Run: git submodule update --init --recursive"
fi

# Build nostr-git UI components next
echo "Building nostr-git UI components..."
if [ -d "packages/nostr-git/packages/ui" ]; then
  (cd packages/nostr-git/packages/ui && pnpm build)
else
  echo "Warning: nostr-git UI directory not found. Make sure submodules are initialized."
  echo "Run: git submodule update --init --recursive"
fi

echo "Building nostr-git git-worker..."
if [ -d "packages/nostr-git/packages/git-worker" ]; then
  (cd packages/nostr-git/packages/git-worker && pnpm build)
else
  echo "Warning: nostr-git git-worker directory not found."
  echo "Run: git submodule update --init --recursive"
fi

npx pwa-assets-generator
npx vite build

# Copy nostr-git core files to build directory for worker imports
echo "Copying nostr-git core files to build directory..."
if [ -d "packages/nostr-git/packages/core/dist/lib" ] && [ "$(ls -A packages/nostr-git/packages/core/dist/lib 2>/dev/null)" ]; then
  mkdir -p build/_app/lib
  cp packages/nostr-git/packages/core/dist/lib/*.js build/_app/lib/
  cp -r packages/nostr-git/packages/core/dist/lib/git build/_app/lib/
  cp -r packages/nostr-git/packages/core/dist/lib/utils build/_app/lib/
  cp -r packages/nostr-git/packages/core/dist/lib/vendors build/_app/lib/
  cp -r packages/nostr-git/packages/core/dist/lib/workers build/_app/lib/
  echo "Nostr-git core files copied successfully"
else
  echo "Warning: Nostr-git core dist/lib directory missing or empty. Did the core build succeed?"
  echo "Checked path: packages/nostr-git/packages/core/dist/lib"
fi

# Copy terminal worker bundle from UI package for terminal component
echo "Copying terminal worker bundle to build directory..."
TERMINAL_WORKER_SRC="packages/nostr-git/packages/ui/dist/components/terminal/worker"
if [ -f "$TERMINAL_WORKER_SRC/cli.js" ]; then
  mkdir -p build/_app/lib/terminal/worker
  cp "$TERMINAL_WORKER_SRC/cli.js" build/_app/lib/terminal/worker/
  if [ -f "$TERMINAL_WORKER_SRC/cli.js.map" ]; then
    cp "$TERMINAL_WORKER_SRC/cli.js.map" build/_app/lib/terminal/worker/
  fi
  echo "Terminal worker bundle copied successfully"
else
  echo "Warning: Terminal worker bundle not found at $TERMINAL_WORKER_SRC. Did the UI build succeed?"
fi

# Copy git CLI adapter bundle used by terminal worker
GIT_CLI_ADAPTER_SRC="packages/nostr-git/packages/ui/dist/components/terminal/git-cli-adapter.js"
if [ -f "$GIT_CLI_ADAPTER_SRC" ]; then
  mkdir -p build/_app/immutable
  cp "$GIT_CLI_ADAPTER_SRC" build/_app/immutable/git-cli-adapter.js
  if [ -f "${GIT_CLI_ADAPTER_SRC}.map" ]; then
    cp "${GIT_CLI_ADAPTER_SRC}.map" build/_app/immutable/git-cli-adapter.js.map
  fi

  # Place alongside worker bundle so relative imports resolve without fallback
  mkdir -p build/_app/lib/terminal
  cp "$GIT_CLI_ADAPTER_SRC" build/_app/lib/terminal/git-cli-adapter.js
  if [ -f "${GIT_CLI_ADAPTER_SRC}.map" ]; then
    cp "${GIT_CLI_ADAPTER_SRC}.map" build/_app/lib/terminal/git-cli-adapter.js.map
  fi
  echo "Git CLI adapter bundle copied successfully"
else
  echo "Warning: Git CLI adapter bundle not found at $GIT_CLI_ADAPTER_SRC. Did the UI build succeed?"
fi

# Replace index.html variables with stuff from our env
perl -i -pe"s|{DESCRIPTION}|$VITE_PLATFORM_DESCRIPTION|g" build/index.html
perl -i -pe"s|{ACCENT}|$VITE_PLATFORM_ACCENT|g" build/index.html
perl -i -pe"s|{NAME}|$VITE_PLATFORM_NAME|g" build/index.html
perl -i -pe"s|{URL}|$VITE_PLATFORM_URL|g" build/index.html

npx cap sync
npx @capacitor/assets generate \
  --iconBackgroundColor '#eeeeee' \
  --iconBackgroundColorDark '#222222' \
  --splashBackgroundColor '#ffffff' \
  --splashBackgroundColorDark '#191E24'
