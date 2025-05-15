#!/usr/bin/env bash

# Fetch tags and set to env vars
git fetch --prune --unshallow --tags
git describe --tags --abbrev=0
export VITE_BUILD_VERSION=$RENDER_GIT_COMMIT
export VITE_BUILD_HASH=$RENDER_GIT_COMMIT

# Install dependencies
pnpm i

# Rebuild sharp
pnpm rebuild

# The build runs out of memory at times
NODE_OPTIONS=--max_old_space_size=16384 pnpm run build
