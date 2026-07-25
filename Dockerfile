FROM node:22-bookworm-slim AS build

WORKDIR /app

# Public deployment settings are compiled into the static Vite bundle. Keep
# them explicit build arguments so production images do not silently inherit
# the repository's public-development defaults.
ARG VITE_APP_URL
ARG VITE_APP_NAME
ARG VITE_APP_LOGO
ARG VITE_INDEXER_RELAYS
ARG VITE_SIGNER_RELAYS
ARG VITE_DEFAULT_BLOSSOM_SERVERS
ARG VITE_GIT_RELAYS
ARG VITE_GIT_DEFAULT_CORS_PROXY
ARG VITE_PLATFORM_URL
ARG VITE_PLATFORM_NAME
ARG VITE_PLATFORM_SHORT_NAME
ARG VITE_PLATFORM_DESCRIPTION
ARG VITE_BUILD_HASH

ENV VITE_APP_URL=$VITE_APP_URL \
    VITE_APP_NAME=$VITE_APP_NAME \
    VITE_APP_LOGO=$VITE_APP_LOGO \
    VITE_INDEXER_RELAYS=$VITE_INDEXER_RELAYS \
    VITE_SIGNER_RELAYS=$VITE_SIGNER_RELAYS \
    VITE_DEFAULT_BLOSSOM_SERVERS=$VITE_DEFAULT_BLOSSOM_SERVERS \
    VITE_GIT_RELAYS=$VITE_GIT_RELAYS \
    VITE_GIT_DEFAULT_CORS_PROXY=$VITE_GIT_DEFAULT_CORS_PROXY \
    VITE_PLATFORM_URL=$VITE_PLATFORM_URL \
    VITE_PLATFORM_NAME=$VITE_PLATFORM_NAME \
    VITE_PLATFORM_SHORT_NAME=$VITE_PLATFORM_SHORT_NAME \
    VITE_PLATFORM_DESCRIPTION=$VITE_PLATFORM_DESCRIPTION \
    VITE_BUILD_HASH=$VITE_BUILD_HASH

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    git \
    ca-certificates \
    curl \
    perl \
    python3 \
    make \
    g++ \
  && rm -rf /var/lib/apt/lists/*

# Use the repository-pinned package manager. Installing `pnpm@latest` makes
# otherwise identical builds depend on the release date and currently breaks
# this lockfile under pnpm 11.
RUN corepack enable

# Seed the dependency layer with every production-workspace manifest and the
# patched dependency. Lifecycle scripts need source files, so they run only
# after the full tree is copied below.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches ./patches
COPY packages/nostr-git-core/package.json ./packages/nostr-git-core/package.json
COPY packages/nostr-git-ui/package.json ./packages/nostr-git-ui/package.json
COPY packages/budabit-pipelines-extension/package.json ./packages/budabit-pipelines-extension/package.json
RUN pnpm install --frozen-lockfile --ignore-scripts

COPY . .

# Build
ENV NODE_OPTIONS=--max_old_space_size=16384
RUN ./build-in-production.sh


FROM node:22-bookworm-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1847

RUN npm install -g serve@14

COPY --from=build /app/build ./build

EXPOSE 1847

CMD ["sh", "-c", "serve -s build -l ${PORT}"]
