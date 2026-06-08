#!/usr/bin/env bash

set -euo pipefail

die() {
  printf 'deploy-static-lftp: %s\n' "$*" >&2
  exit 1
}

usage() {
  cat <<'USAGE'
Usage: scripts/deploy-static-lftp.sh [--dry-run] [--local-remote PATH]

Environment:
  BUDABIT_SFTP_HOST       Required for real deploys, for example sftp://example.com
  BUDABIT_SFTP_USER       Required for real deploys
  BUDABIT_REMOTE_PATH     Remote web root, defaults to .
  LFTP_PASSWORD           Optional. If unset, the script prompts securely.
  BUDABIT_BUILD_DIR       Build directory, defaults to ./build
  BUDABIT_LFTP_PARALLEL   lftp mirror parallelism, defaults to 8
  BUDABIT_DEPLOY_CONFIG   Local config file, defaults to ./.deploy.local.env
  BUDABIT_DEPLOY_LOCAL_REMOTE  Local mock remote path for verification
  BUDABIT_DEPLOY_TRACE_FILE    Optional trace file for local mock verification

Local config example, kept untracked in .deploy.local.env:
  BUDABIT_SFTP_HOST='sftp://example.com'
  BUDABIT_SFTP_USER='your-user'
  BUDABIT_REMOTE_PATH='.'
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
parallel="${BUDABIT_LFTP_PARALLEL:-8}"
dry_run="${BUDABIT_DEPLOY_DRY_RUN:-0}"
local_remote="${BUDABIT_DEPLOY_LOCAL_REMOTE:-}"

while (($#)); do
  case "$1" in
    --dry-run)
      dry_run=1
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

[[ -d "$build_dir" ]] || die "build directory does not exist: $build_dir"
[[ -d "$build_dir/_app/immutable" ]] || die "missing build/_app/immutable"
[[ -f "$build_dir/_app/version.json" ]] || die "missing build/_app/version.json"

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

trace() {
  [[ -n "${BUDABIT_DEPLOY_TRACE_FILE:-}" ]] || return 0
  printf '%s\n' "$*" >>"$BUDABIT_DEPLOY_TRACE_FILE"
}

trace_version_state() {
  local label="$1"
  local version_file="$2"

  if [[ -f "$version_file" ]]; then
    trace "$label version=$(<"$version_file")"
  else
    trace "$label version=<missing>"
  fi
}

run_local_deploy() {
  local target="$1"

  [[ -n "$target" ]] || die 'local remote path is empty'
  [[ "$target" = /* ]] || die 'local remote path must be absolute'
  [[ "$target" != '/' ]] || die 'refusing to deploy to /'
  command -v rsync >/dev/null 2>&1 || die 'rsync is required for --local-remote verification'

  mkdir -p "$target/_app/immutable" "$target/_app"

  trace 'pass1 immutable start'
  rsync -a "$build_dir/_app/immutable/" "$target/_app/immutable/"
  trace 'pass1 immutable done'

  trace 'pass2 mutable start'
  trace_version_state 'pass2 before' "$target/_app/version.json"
  rsync -a --delete \
    --exclude='/_app/immutable/***' \
    --exclude='/_app/version.json' \
    "$build_dir/" \
    "$target/"
  trace_version_state 'pass2 after' "$target/_app/version.json"
  trace 'pass2 mutable done'

  trace 'pass3 version start'
  cp "$build_dir/_app/version.json" "$target/_app/version.json"
  trace_version_state 'pass3 after' "$target/_app/version.json"
  trace 'pass3 version done'
}

emit_lftp_commands() {
  local remote_immutable
  local remote_app

  remote_immutable="$(join_remote_path "$remote_path" '_app/immutable/')"
  remote_app="$(join_remote_path "$remote_path" '_app')"

  cat <<LFTP
set cmd:fail-exit yes
set net:max-retries 2

# Pass 1: upload new immutable app assets, keep old immutable files.
mirror -R --verbose=1 --parallel=$parallel --ignore-time "_app/immutable/" $(lftp_quote "$remote_immutable")

# Pass 2: upload mutable files and delete removed mutable files, but do not publish the marker yet.
mirror -R --verbose=1 --parallel=$parallel --delete -x '(^|/)_app/immutable(/|$)' -x '^_app/version\.json$' "." $(lftp_quote "$remote_path")

# Pass 3: publish the stable update marker last.
put -O $(lftp_quote "$remote_app") "_app/version.json"
bye
LFTP
}

if [[ -n "$local_remote" ]]; then
  run_local_deploy "$local_remote"
  exit 0
fi

[[ -n "${BUDABIT_SFTP_HOST:-}" ]] || die 'BUDABIT_SFTP_HOST is required'
[[ -n "${BUDABIT_SFTP_USER:-}" ]] || die 'BUDABIT_SFTP_USER is required'

if [[ "$dry_run" == '1' ]]; then
  printf 'Would run ordered lftp deploy from %s:\n\n' "$build_dir"
  printf 'lftp -u %q --env-password %q <<LFTP\n' "$BUDABIT_SFTP_USER" "$BUDABIT_SFTP_HOST"
  emit_lftp_commands
  printf 'LFTP\n'
  exit 0
fi

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
  cd "$build_dir"
  emit_lftp_commands | lftp -u "$BUDABIT_SFTP_USER" --env-password "$BUDABIT_SFTP_HOST"
)

if [[ "$password_from_prompt" == '1' ]]; then
  unset LFTP_PASSWORD
fi
