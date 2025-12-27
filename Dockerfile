FROM node:20-slim AS build

WORKDIR /app

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

# Install pnpm
RUN npm install -g pnpm@latest

# Install deps (cache-friendly)
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# Build
COPY . .
ENV NODE_OPTIONS=--max_old_space_size=16384
RUN ./build-in-production.sh


FROM node:20-slim AS runtime

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=1847

RUN npm install -g serve@14

COPY --from=build /app/build ./build

EXPOSE 1847

CMD ["sh", "-c", "serve -s build -l ${PORT}"]
