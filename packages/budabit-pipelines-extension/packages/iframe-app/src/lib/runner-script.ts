import type { LoomWorker } from './types';

/**
 * Hive CI Workflow Runner Script
 *
 * Uploaded to Blossom before each run and executed by the loom worker.
 * Clones a Nostr repository via ngit, runs GitHub Actions with act,
 * uploads the act log to Blossom, and publishes a Kind 5402 workflow result event.
 *
 * Aligned with the runner script from PR #17 / hive-ci-site.
 */
export const WORKFLOW_RUNNER_SCRIPT = `#!/bin/bash
set -eo pipefail

# Hive CI Workflow Runner Script
# Clones a Nostr repository, runs GitHub Actions with act,
# and uploads the results to Blossom using nak for Nostr event publishing.

# Validate required environment variables
if [ -z "$HIVE_CI_REPOSITORY" ]; then
  echo "Error: HIVE_CI_REPOSITORY is required"
  exit 1
fi

if [ -z "$HIVE_CI_RUN_ID" ]; then
  echo "Error: HIVE_CI_RUN_ID is required"
  exit 1
fi

if [ -z "$HIVE_CI_NSEC" ]; then
  echo "Error: HIVE_CI_NSEC is required"
  exit 1
fi

# Set defaults
BLOSSOM_SERVER="\${HIVE_CI_BLOSSOM_SERVER:-https://blossom.primal.net}"
RELAYS="\${HIVE_CI_RELAYS:-wss://relay.damus.io}"

# Extract repository name from Nostr URL
REPO_NAME=$(echo "$HIVE_CI_REPOSITORY" | sed 's|.*/||')

# Create working directory
WORK_DIR="/tmp/hive-ci-\${HIVE_CI_RUN_ID}"
mkdir -p "$WORK_DIR"
cd "$WORK_DIR"

# Track start time
START_TIME=$(date +%s)

# Initialize result variables
EXIT_CODE=0
ACT_LOG_FILE="\${WORK_DIR}/act-output.log"
touch "$ACT_LOG_FILE"

echo "=== Hive CI Workflow Runner ==="
echo "Repository: \${HIVE_CI_REPOSITORY}"
echo "Workflow: \${HIVE_CI_WORKFLOW:-all workflows}"
echo "Branch: \${HIVE_CI_BRANCH:-default}"
echo "Commit: \${HIVE_CI_COMMIT:-HEAD}"
echo "Run ID: \${HIVE_CI_RUN_ID}"
echo "Blossom Server: \${BLOSSOM_SERVER}"
echo "Working Directory: \${WORK_DIR}"
echo "ngit version: $(ngit --version 2>&1 || echo 'not found')"
echo "nak version: $(nak --version 2>&1 || echo 'not found')"
echo "================================"

# Configure ngit relay defaults
NGIT_RELAYS=$(echo "$RELAYS" | tr ',' ';')
git config --global nostr.relay-default-set "$NGIT_RELAYS"

# Clone the repository
export RUST_BACKTRACE=full
echo ""
echo ">>> Cloning repository..."
CLONE_ARGS=""
if [ -n "$HIVE_CI_BRANCH" ]; then
  echo "Cloning branch: \${HIVE_CI_BRANCH}"
  CLONE_ARGS="--branch $HIVE_CI_BRANCH"
fi
if ! git clone $CLONE_ARGS "$HIVE_CI_REPOSITORY" 2>&1; then
  echo "Error: Failed to clone repository"
  EXIT_CODE=1
fi

if [ $EXIT_CODE -eq 0 ]; then
  cd "$REPO_NAME"

  if [ -n "$HIVE_CI_COMMIT" ]; then
    echo "Checking out commit: \${HIVE_CI_COMMIT}"
    if ! git checkout "$HIVE_CI_COMMIT" 2>&1; then
      echo "Error: Failed to checkout commit \${HIVE_CI_COMMIT}"
      EXIT_CODE=1
    fi
  fi
fi

if [ $EXIT_CODE -eq 0 ]; then
  echo ""
  echo ">>> Running GitHub Actions with act..."

  if [ -n "$HIVE_CI_WORKFLOW" ]; then
    echo "Workflow file: \${HIVE_CI_WORKFLOW}"
    if ! sudo act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W "$HIVE_CI_WORKFLOW" 2>&1 | tee "$ACT_LOG_FILE"; then
      EXIT_CODE=$?
      echo "Error: Workflow execution failed with exit code \${EXIT_CODE}"
    fi
  else
    echo "Running all workflows"
    if ! sudo act -P ubuntu-latest=catthehacker/ubuntu:act-latest 2>&1 | tee "$ACT_LOG_FILE"; then
      EXIT_CODE=$?
      echo "Error: Workflow execution failed with exit code \${EXIT_CODE}"
    fi
  fi
fi

# Calculate duration
END_TIME=$(date +%s)
DURATION=$((END_TIME - START_TIME))

echo ""
echo ">>> Workflow execution completed"
echo "Exit Code: \${EXIT_CODE}"
echo "Duration: \${DURATION} seconds"

# Upload log file to Blossom using nak
echo ""
echo ">>> Uploading log to Blossom..."

LOG_URL=""
UPLOAD_TEMP=$(mktemp)
if cat "$ACT_LOG_FILE" | nak blossom --server "$BLOSSOM_SERVER" --sec "$HIVE_CI_NSEC" upload > "$UPLOAD_TEMP" 2>&1; then
  LOG_URL=$(cat "$UPLOAD_TEMP" | jq -r '.url // empty')
  if [ -n "$LOG_URL" ] && [ "$LOG_URL" != "null" ]; then
    echo "Log uploaded: \${LOG_URL}"
  else
    echo "Warning: Blossom upload returned no URL"
    echo "Response: $(cat "$UPLOAD_TEMP")"
    LOG_URL=""
  fi
else
  echo "Warning: Failed to upload log to Blossom (exit code: $?)"
  echo "Error output: $(cat "$UPLOAD_TEMP")"
  LOG_URL=""
fi
rm -f "$UPLOAD_TEMP"

# Publish Kind 5402 (Workflow Log) event using nak
echo ""
echo ">>> Publishing workflow result to Nostr..."

if [ $EXIT_CODE -eq 0 ]; then
  STATUS="success"
else
  STATUS="failed"
fi

IFS=',' read -ra RELAY_ARRAY <<< "$RELAYS"

RELAY_ARGS=""
for relay in "\${RELAY_ARRAY[@]}"; do
  RELAY_ARGS="$RELAY_ARGS $relay"
done

TAG_ARGS="-t e=\${HIVE_CI_RUN_ID} -t status=\${STATUS} -t exit_code=\${EXIT_CODE} -t duration=\${DURATION}"

if [ -n "$LOG_URL" ]; then
  TAG_ARGS="$TAG_ARGS -t log_url=\${LOG_URL}"
fi

if [ -n "$HIVE_CI_WORKFLOW" ]; then
  TAG_ARGS="$TAG_ARGS -t workflow=\${HIVE_CI_WORKFLOW}"
fi

EVENT_JSON=$(echo '{}' | nak event -k 5402 $TAG_ARGS --sec "\${HIVE_CI_NSEC}" -c '')
EVENT_ID=$(echo "$EVENT_JSON" | jq -r '.id')

if [ -z "$EVENT_ID" ] || [ "$EVENT_ID" = "null" ]; then
  echo "Error: Failed to generate workflow result event" >&2
else
  echo "$EVENT_JSON" | nak event $RELAY_ARGS 2>/dev/null
  echo "Workflow result published: \${EVENT_ID}" >&2
fi

# Cleanup
echo ""
echo ">>> Cleaning up..."
cd /tmp
rm -rf "$WORK_DIR"

echo ""
echo "=== Hive CI Workflow Runner Complete ==="
echo "Final Status: \${STATUS}"
echo "Exit Code: \${EXIT_CODE}"
echo "Duration: \${DURATION} seconds"
if [ -n "$LOG_URL" ]; then
  echo "Log URL: \${LOG_URL}"
fi
if [ -n "$EVENT_ID" ]; then
  echo "Result Event ID: \${EVENT_ID}"
fi
echo "========================================"

exit $EXIT_CODE
`;

export function buildRunnerScriptTemplate(
  workflowPath: string,
  worker: LoomWorker | null,
  branch: string
): string {
  const workflowLabel = workflowPath || '[set HIVE_CI_WORKFLOW before submit]';
  const workerLabel = worker
    ? `${worker.name}${worker.architecture ? ` (${worker.architecture})` : ''}${worker.actVersion ? ` act ${worker.actVersion}` : ''}`
    : 'auto-selected worker';

  return [
    `# Suggested for workflow: ${workflowLabel}`,
    `# Suggested branch: ${branch || 'main'}`,
    `# Suggested worker: ${workerLabel}`,
    '# Edit if your workers need extra setup before act runs.',
    '',
    WORKFLOW_RUNNER_SCRIPT,
  ].join('\n');
}

export function buildInlineRunnerArgs(script: string): string[] {
  return [
    '-lc',
    `cat <<'HIVE_CI_RUNNER_SCRIPT_EOF_DELIMITER' >/tmp/run-workflow.sh\n${script}\nHIVE_CI_RUNNER_SCRIPT_EOF_DELIMITER\nchmod +x /tmp/run-workflow.sh\n/tmp/run-workflow.sh`,
  ];
}
