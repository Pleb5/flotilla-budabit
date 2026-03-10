#!/usr/bin/env bash

set -e

# Fetch tags and set to env vars
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
	git fetch --prune --unshallow --tags || true
else
	git fetch --prune --tags || true
fi

git describe --tags --abbrev=0 2>/dev/null || true
export VITE_BUILD_VERSION=$RENDER_GIT_COMMIT
export VITE_BUILD_HASH=$RENDER_GIT_COMMIT

# Install dependencies
CI=0 pnpm i

# Rebuild native deps as needed (e.g., sharp)
pnpm rebuild || true

# Use unified build script (builds core, UI, app, and copies worker libs)
NODE_OPTIONS=--max_old_space_size=16384 ./build.sh
