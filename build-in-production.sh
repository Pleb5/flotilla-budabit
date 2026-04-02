#!/usr/bin/env bash

set -e

# Fetch tags and set build metadata env vars
if [ "$(git rev-parse --is-shallow-repository 2>/dev/null)" = "true" ]; then
	git fetch --prune --unshallow --tags || true
else
	git fetch --prune --tags || true
fi

build_commit="${RENDER_GIT_COMMIT:-}"
if [ -z "$build_commit" ]; then
	build_commit="$(git rev-parse --short HEAD 2>/dev/null || true)"
fi

if [ -n "$build_commit" ]; then
	export VITE_BUILD_VERSION="$build_commit"
	export VITE_BUILD_HASH="$build_commit"
fi

# Install dependencies
CI=0 pnpm i

# Rebuild native deps as needed (e.g., sharp)
pnpm rebuild || true

# Use unified build script (builds core, UI, app, and copies worker libs)
if [ -z "${NODE_OPTIONS:-}" ]; then
	export NODE_OPTIONS="--max-old-space-size=16384"
fi

./build.sh
