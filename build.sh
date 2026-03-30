#!/usr/bin/env bash

# Increase Node.js memory limit globally for this script
export NODE_OPTIONS="--max-old-space-size=8192"

load_env_defaults() {
	local file="$1"

	if [ ! -f "$file" ]; then
		return
	fi

	while IFS= read -r -d '' key && IFS= read -r -d '' value; do
		if [ -z "${!key+x}" ]; then
			printf -v "$key" '%s' "$value"
			export "$key"
		fi
	done < <(
		node - "$file" <<'NODE'
const fs = require("node:fs")
const dotenv = require("dotenv")

const file = process.argv[2]
const parsed = dotenv.parse(fs.readFileSync(file))

for (const [key, value] of Object.entries(parsed)) {
  process.stdout.write(`${key}\0${value}\0`)
}
NODE
	)
}

# Load defaults from env files without overwriting already-set env vars
load_env_defaults .env.template
load_env_defaults .env

if [[ -z $VITE_BUILD_HASH ]]; then
	export VITE_BUILD_HASH=$(git rev-parse --short HEAD)
fi

if [[ $VITE_PLATFORM_LOGO =~ ^https://* ]]; then
	curl $VITE_PLATFORM_LOGO >static/logo.png
	export VITE_PLATFORM_LOGO=static/logo.png
fi

npx pwa-assets-generator
npx vite build

# Replace HTML placeholders and keep web manifest branding in sync
node - <<'NODE'
const fs = require("node:fs")

const DEFAULTS = {
  name: "Budabit",
  shortName: "Budabit",
  accent: "#8B5CF6",
  description: "Social Git collaboration on Nostr",
  url: "https://budabit.club",
}

const getEnv = (name, fallback) => {
  const value = process.env[name]
  return value && value.trim() ? value.trim() : fallback
}

const normalizedUrl = getEnv("VITE_PLATFORM_URL", DEFAULTS.url).replace(/\/+$/, "")

const platform = {
  name: getEnv("VITE_PLATFORM_NAME", DEFAULTS.name),
  shortName: getEnv("VITE_PLATFORM_SHORT_NAME", "") || getEnv("VITE_PLATFORM_NAME", DEFAULTS.shortName),
  accent: getEnv("VITE_PLATFORM_ACCENT", DEFAULTS.accent),
  description: getEnv("VITE_PLATFORM_DESCRIPTION", DEFAULTS.description),
  url: normalizedUrl,
}

const indexPath = "build/index.html"
if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, "utf8")
  const replacements = {
    "{DESCRIPTION}": platform.description,
    "{ACCENT}": platform.accent,
    "{NAME}": platform.name,
    "{URL}": platform.url,
  }

  for (const [placeholder, value] of Object.entries(replacements)) {
    html = html.split(placeholder).join(value)
  }

  fs.writeFileSync(indexPath, html)
}

const manifestPath = "build/manifest.webmanifest"
if (fs.existsSync(manifestPath)) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
  manifest.name = platform.name
  manifest.short_name = platform.shortName
  manifest.theme_color = platform.accent
  manifest.description = platform.description
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}
NODE
