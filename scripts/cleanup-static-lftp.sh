#!/usr/bin/env bash

set -euo pipefail

die() {
  printf 'cleanup-static-lftp: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: scripts/cleanup-static-lftp.sh [--dry-run|--apply] [--keep-build-dir PATH] [--local-remote PATH]

Dry-run is the default. Run this only during low-traffic maintenance windows.

This script builds a temporary keep set from:
  - BUDABIT_BUILD_DIR, defaulting to ./build
  - any --keep-build-dir PATH values
  - BUDABIT_CLEANUP_KEEP_BUILD_DIRS, colon-separated

It then mirrors that keep set to the remote _app/immutable directory with delete
enabled. Browser Cache Storage cleanup is handled by the service worker, which
keeps the current and previous budabit-app-* caches.

Environment:
  BUDABIT_SFTP_HOST       Required for real remote dry runs or apply
  BUDABIT_SFTP_USER       Required for real remote dry runs or apply
  BUDABIT_REMOTE_PATH     Remote web root, defaults to .
  LFTP_PASSWORD           Optional. If unset, the script prompts securely.
  BUDABIT_BUILD_DIR       Current build directory, defaults to ./build
  BUDABIT_LFTP_PARALLEL   lftp mirror parallelism, defaults to 4
  BUDABIT_DEPLOY_CONFIG   Local config file, defaults to ./.deploy.local.env
  BUDABIT_CLEANUP_LOCAL_REMOTE  Local mock remote path for verification
  BUDABIT_CLEANUP_KEEP_BUILD_DIRS  Colon-separated previous build directories
  BUDABIT_CLEANUP_ALLOW_CURRENT_ONLY=1  Allow --apply without a previous build
USAGE
}

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
config_file="${BUDABIT_DEPLOY_CONFIG:-$repo_root/.deploy.local.env}"

if [[ -f "$config_file" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$config_file"
  set +a
fi

build_dir="${BUDABIT_BUILD_DIR:-$repo_root/build}"
remote_path="${BUDABIT_REMOTE_PATH:-.}"
parallel="${BUDABIT_LFTP_PARALLEL:-4}"
dry_run=1
apply=0
local_remote="${BUDABIT_CLEANUP_LOCAL_REMOTE:-}"
keep_build_dirs=()

if [[ -n "${BUDABIT_CLEANUP_KEEP_BUILD_DIRS:-}" ]]; then
  IFS=':' read -r -a keep_build_dirs <<<"$BUDABIT_CLEANUP_KEEP_BUILD_DIRS"
fi

while (($#)); do
  case "$1" in
    --dry-run)
      dry_run=1
      apply=0
      ;;
    --apply)
      dry_run=0
      apply=1
      ;;
    --keep-build-dir)
      shift
      [[ $# -gt 0 ]] || die '--keep-build-dir requires a path'
      keep_build_dirs+=("$1")
      ;;
    --local-remote)
      shift
      [[ $# -gt 0 ]] || die '--local-remote requires a path'
      local_remote="$1"
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
  shift
done

[[ -d "$build_dir/_app/immutable" ]] || die "missing current build immutable directory: $build_dir/_app/immutable"
command -v rsync >/dev/null 2>&1 || die 'rsync is required'

if [[ "$apply" == '1' && ${#keep_build_dirs[@]} -eq 0 && "${BUDABIT_CLEANUP_ALLOW_CURRENT_ONLY:-0}" != '1' ]]; then
  die 'refusing --apply with only the current build; pass --keep-build-dir for the previous build or set BUDABIT_CLEANUP_ALLOW_CURRENT_ONLY=1 after a retention window'
fi

join_remote_path() {
  local base="$1"
  local child="${2#/}"

  if [[ "$base" == '/' ]]; then
    printf '/%s' "$child"
  elif [[ -z "$base" || "$base" == '.' ]]; then
    printf './%s' "$child"
  else
    printf '%s/%s' "${base%/}" "$child"
  fi
}

lftp_quote() {
  local value="$1"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  printf '"%s"' "$value"
}

tmp_dir="$(mktemp -d)"
cleanup_tmp() {
  rm -rf "$tmp_dir"
}
trap cleanup_tmp EXIT

mkdir -p "$tmp_dir/_app/immutable"

copy_keep_build() {
  local source_build="$1"
  local label="$2"

  [[ -d "$source_build/_app/immutable" ]] || die "missing $label immutable directory: $source_build/_app/immutable"
  rsync -a "$source_build/_app/immutable/" "$tmp_dir/_app/immutable/"
}

copy_keep_build "$build_dir" 'current build'

for keep_dir in "${keep_build_dirs[@]}"; do
  [[ -n "$keep_dir" ]] || continue
  copy_keep_build "$keep_dir" 'previous build'
done

run_local_cleanup() {
  local target="$1"
  local mode=(-ain)

  [[ -n "$target" ]] || die 'local remote path is empty'
  [[ "$target" = /* ]] || die 'local remote path must be absolute'
  [[ "$target" != '/' ]] || die 'refusing to clean /'
  [[ -d "$target/_app/immutable" ]] || die "missing local remote immutable directory: $target/_app/immutable"

  if [[ "$apply" == '1' ]]; then
    mode=(-ai)
  fi

  rsync "${mode[@]}" --delete "$tmp_dir/_app/immutable/" "$target/_app/immutable/"
}

emit_lftp_commands() {
  local remote_immutable
  local dry_run_flag='--dry-run'

  remote_immutable="$(join_remote_path "$remote_path" '_app/immutable/')"
  if [[ "$dry_run" == '0' ]]; then
    dry_run_flag=''
  fi

  cat <<LFTP
set cmd:fail-exit yes
set net:max-retries 2

# Cleanup remote immutable files not present in the current/previous keep set.
mirror -R --verbose=1 --parallel=$parallel --delete $dry_run_flag "_app/immutable/" $(lftp_quote "$remote_immutable")
bye
LFTP
}

if [[ -n "$local_remote" ]]; then
  run_local_cleanup "$local_remote"
  exit 0
fi

[[ -n "${BUDABIT_SFTP_HOST:-}" ]] || die 'BUDABIT_SFTP_HOST is required'
[[ -n "${BUDABIT_SFTP_USER:-}" ]] || die 'BUDABIT_SFTP_USER is required'
command -v lftp >/dev/null 2>&1 || die 'lftp is required'

password_from_prompt=0
if [[ -z "${LFTP_PASSWORD:-}" ]]; then
  [[ -t 0 ]] || die 'LFTP_PASSWORD is required when stdin is not interactive'
  read -rsp 'SFTP password: ' LFTP_PASSWORD
  printf '\n' >&2
  export LFTP_PASSWORD
  password_from_prompt=1
fi

(
  cd "$tmp_dir"
  emit_lftp_commands | lftp -u "$BUDABIT_SFTP_USER" --env-password "$BUDABIT_SFTP_HOST"
)

if [[ "$password_from_prompt" == '1' ]]; then
  unset LFTP_PASSWORD
fi
