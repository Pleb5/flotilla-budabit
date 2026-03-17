<script lang="ts">
  import {Button, toast} from "@nostr-git/ui"
  import {
    Check,
    ChevronLeft,
    Play,
    Plus,
    RotateCw,
    X,
  } from "@lucide/svelte"
  import {Lock} from "@lucide/svelte"
  import {SimplePool, nip19, generateSecretKey, getPublicKey} from "nostr-tools"
  import {bytesToHex} from "@noble/hashes/utils"
  import {pubkey, signer} from "@welshman/app"
  import {
    cashuTotalBalance,
    cashuBalancesByMint,
    cashuMints,
    createCashuToken,
  } from "@lib/budabit/cashu"
  import {onMount} from "svelte"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY} from "@lib/budabit/state"
  import {CICD_RELAYS, CICD_PUBLISH_RELAYS} from "@lib/budabit/constants"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  // Hive CI Workflow Runner Script — uploaded to Blossom before each run
  // Use the exact same script as hive-ci-site
  const WORKFLOW_RUNNER_SCRIPT = `#!/bin/bash
set -eo pipefail

# Hive CI Workflow Runner Script
# This script clones a Nostr repository, runs GitHub Actions with act,
# and uploads the results to Blossom using nak for Nostr event publishing.

# Environment variables (with defaults):
# - HIVE_CI_REPOSITORY: Nostr URL of the repository (required)
# - HIVE_CI_WORKFLOW: Workflow file path (optional, defaults to all workflows)
# - HIVE_CI_BRANCH: Git branch to checkout (optional, defaults to default branch)
# - HIVE_CI_RUN_ID: Unique run identifier (required)
# - HIVE_CI_NSEC: Ephemeral Nostr nsec for signing results (required)
# - HIVE_CI_BLOSSOM_SERVER: Blossom server URL (default: https://blossom.primal.net)
# - HIVE_CI_RELAYS: Comma-separated relay URLs (default: wss://relay.damus.io)

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
# Format: nostr://npub.../repo-name
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
echo "Run ID: \${HIVE_CI_RUN_ID}"
echo "Blossom Server: \${BLOSSOM_SERVER}"
echo "Working Directory: \${WORK_DIR}"
echo "ngit version: $(ngit --version 2>&1)"
echo "nak version: $(nak --version 2>&1)"
echo "================================"

# Configure ngit relay defaults for headless environments (no cached relay list)
# Convert comma-separated HIVE_CI_RELAYS to semicolon-separated for ngit git config
NGIT_RELAYS=$(echo "$RELAYS" | tr ',' ';')
git config --global nostr.relay-default-set "$NGIT_RELAYS"

# Clone the repository (with optional branch)
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
  # Change to repo directory
  cd "$REPO_NAME"

  # Run act with the specified workflow (or all workflows if not specified)
  echo ""
  echo ">>> Running GitHub Actions with act..."

  # Pass Hive CI variables into act as env vars so workflow run: steps can read them directly.
  # HIVE_CI_NSEC is the ephemeral nsec matching the publisher tag in the 5401 event.
  ACT_ENVS="--env HIVE_CI_NSEC=\${HIVE_CI_NSEC} --env HIVE_CI_RUN_ID=\${HIVE_CI_RUN_ID} --env HIVE_CI_RELAYS=\${RELAYS} --env HIVE_CI_BLOSSOM_SERVER=\${BLOSSOM_SERVER}"

  if [ -n "$HIVE_CI_WORKFLOW" ]; then
    echo "Workflow file: \${HIVE_CI_WORKFLOW}"
    if ! sudo act -P ubuntu-latest=catthehacker/ubuntu:act-latest -W "$HIVE_CI_WORKFLOW" $ACT_ENVS 2>&1 | tee "$ACT_LOG_FILE"; then
      EXIT_CODE=$?
      echo "Error: Workflow execution failed with exit code \${EXIT_CODE}"
    fi
  else
    echo "Running all workflows"
    if ! sudo act -P ubuntu-latest=catthehacker/ubuntu:act-latest $ACT_ENVS 2>&1 | tee "$ACT_LOG_FILE"; then
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

# Upload and capture result to temp file to avoid shell parsing issues
# Use || true so set -e doesn't kill the script if upload fails
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

# Determine status
if [ $EXIT_CODE -eq 0 ]; then
  STATUS="success"
else
  STATUS="failed"
fi

# Split relays into array for nak
IFS=',' read -ra RELAY_ARRAY <<< "$RELAYS"

# Build relay arguments
RELAY_ARGS=""
for relay in "\${RELAY_ARRAY[@]}"; do
  RELAY_ARGS="$RELAY_ARGS $relay"
done

# Build tag arguments
TAG_ARGS="-t e=\${HIVE_CI_RUN_ID} -t status=\${STATUS} -t exit_code=\${EXIT_CODE} -t duration=\${DURATION}"

# Add log URL if available
if [ -n "$LOG_URL" ]; then
  TAG_ARGS="$TAG_ARGS -t log_url=\${LOG_URL}"
fi

# Add workflow tag if specified
if [ -n "$HIVE_CI_WORKFLOW" ]; then
  TAG_ARGS="$TAG_ARGS -t workflow=\${HIVE_CI_WORKFLOW}"
fi

# Publish event using nak and capture event ID
# Generate event by providing empty JSON on stdin (nak reads stdin by default)
EVENT_JSON=$(echo '{}' | nak event -k 5402 $TAG_ARGS --sec "\${HIVE_CI_NSEC}" -c '')

# Extract event ID from the JSON
EVENT_ID=$(echo "$EVENT_JSON" | jq -r '.id')

if [ -z "$EVENT_ID" ] || [ "$EVENT_ID" = "null" ]; then
  echo "Error: Failed to generate workflow result event" >&2
  exit 1
fi

# Publish the event to relays (stderr output suppressed for cleaner logs)
echo "$EVENT_JSON" | nak event $RELAY_ARGS 2>/dev/null

echo "Workflow result published: \${EVENT_ID}" >&2

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
`

  const BLOSSOM_SERVERS = ["https://cdn.sovbit.host/", "https://blossom.primal.net"]

  /**
   * Upload the workflow runner script to a Blossom server using blossom-client-sdk.
   * Tries multiple servers until one succeeds.
   */
  async function uploadScriptToBlossom(): Promise<string> {
    const {BlossomClient} = await import("blossom-client-sdk")
    const blob = new Blob([WORKFLOW_RUNNER_SCRIPT], {type: "text/plain"})

    // Create a blossom-compatible signer from the Nostr signer
    const blossomSigner = async (event: any) => {
      return await $signer.sign(event)
    }

    const errors: string[] = []
    for (const server of BLOSSOM_SERVERS) {
      try {
        console.log(`[cicd] Trying to upload script to ${server}...`)
        const client = new BlossomClient(server, blossomSigner)
        const result = await client.uploadBlob(blob)
        console.log(`[cicd] Script uploaded to ${server}: ${result.url}`)
        return result.url
      } catch (e: any) {
        const msg = e?.message || "Unknown error"
        errors.push(`${server}: ${msg}`)
        console.warn(`[cicd] Blossom upload to ${server} failed:`, msg)
      }
    }
    throw new Error(`All Blossom servers failed:\n${errors.join("\n")}`)
  }

  const {relay, id} = $page.params
  const workflowName = $page.url.searchParams.get("workflow") ?? ""
  const workflowPath = $page.url.searchParams.get("path") ?? ""

  const repoNaddr = $derived.by(() => {
    if (!id) return id
    try {
      const decoded = nip19.decode(id)
      if (decoded.type === "naddr") {
        const {kind, pubkey: pk, identifier} = decoded.data
        return `${kind}:${pk}:${identifier}`
      }
    } catch {
      // pass
    }
    return id
  })

  // Form state
  let selectedBranch = $state(repoClass.mainBranch ?? "")
  let envVars = $state<{key: string; value: string}[]>([{key: "", value: ""}])
  let secrets = $state<{key: string; value: string}[]>([{key: "", value: ""}])
  let maxDuration = $state(600)
  let generatingToken = $state(false)
  let tokenError = $state("")

  // Worker discovery
  interface LoomWorker {
    pubkey: string
    name: string
    description: string
    architecture: string
    actVersion?: string
    pricing: {baseFee: number; perSecondRate: number; unit: string}
    mints: string[]
    minDuration: number
    maxDuration: number
    maxConcurrentJobs: number
    currentQueueDepth: number
    online: boolean
    lastSeen: number
  }

  let discoveredWorkers = $state<LoomWorker[]>([])
  let loadingWorkers = $state(true)
  let selectedWorker = $state<LoomWorker | null>(null)

  const perSecondRate = $derived(selectedWorker?.pricing.perSecondRate ?? 1)
  const minCost = $derived(Math.ceil((selectedWorker?.minDuration ?? 0) * perSecondRate))
  const cashuAmount = $derived(Math.ceil(maxDuration * perSecondRate * 1.1))
  const maxChange = $derived(Math.max(0, cashuAmount - minCost))

  const walletBalance = $derived($cashuTotalBalance)
  const walletMints = $derived($cashuMints)
  const walletBalancesByMint = $derived($cashuBalancesByMint)

  // Find mints that both wallet and worker support
  const overlappingMints = $derived(
    selectedWorker
      ? walletMints.filter(m => selectedWorker!.mints.includes(m))
      : [],
  )
  const bestMint = $derived(
    overlappingMints.length > 0
      ? overlappingMints.reduce(
          (best, m) =>
            (walletBalancesByMint.get(m) ?? 0) > (walletBalancesByMint.get(best) ?? 0) ? m : best,
          overlappingMints[0],
        )
      : "",
  )
  const bestMintBalance = $derived(bestMint ? (walletBalancesByMint.get(bestMint) ?? 0) : 0)
  const hasEnoughBalance = $derived(bestMintBalance >= cashuAmount)

  // Worker discovery via Kind 10100 (Loom worker advertisement)
  function parseLoomWorker(event: any): LoomWorker | null {
    try {
      const content = JSON.parse(event.content || "{}")
      if (
        !content.name ||
        content.max_concurrent_jobs === undefined ||
        content.current_queue_depth === undefined
      )
        return null

      const tags: string[][] = event.tags
      const tagVal = (name: string) => tags.find(t => t[0] === name)?.[1]

      const architecture = tagVal("A")
      if (!architecture) return null

      const software = tags
        .filter(t => t[0] === "S")
        .map(t => ({name: t[1], version: t[2], path: t[3]}))
      const actSoftware = software.find(s => s.name === "act")
      if (!actSoftware) return null

      const priceTags = tags.filter(t => t[0] === "price")
      if (priceTags.length === 0 || priceTags[0].length < 5) return null

      const perSecRate = parseFloat(priceTags[0][2])
      const unit = priceTags[0][3]
      const mints = priceTags.map(t => t[4]).filter(m => m)

      const minDur = parseInt(tagVal("min_duration") || "0")
      const maxDur = parseInt(tagVal("max_duration") || "0")

      return {
        pubkey: event.pubkey,
        name: content.name,
        description: content.description || "",
        architecture,
        actVersion: actSoftware.version,
        pricing: {baseFee: perSecRate * minDur, perSecondRate: perSecRate, unit},
        mints,
        minDuration: minDur,
        maxDuration: maxDur,
        maxConcurrentJobs: content.max_concurrent_jobs,
        currentQueueDepth: content.current_queue_depth,
        online: Date.now() - event.created_at * 1000 < 300000,
        lastSeen: event.created_at,
      }
    } catch {
      return null
    }
  }

  const workerRelays = CICD_RELAYS

  async function discoverWorkers() {
    loadingWorkers = true
    try {
      const pool = new SimplePool()
      const events = await pool.querySync(workerRelays, {kinds: [10100]})
      pool.close(workerRelays)

      const latestByPubkey = new Map<string, any>()
      for (const event of events) {
        const existing = latestByPubkey.get(event.pubkey)
        if (!existing || event.created_at > existing.created_at) {
          latestByPubkey.set(event.pubkey, event)
        }
      }

      const parsed = Array.from(latestByPubkey.values())
        .map(parseLoomWorker)
        .filter((w): w is LoomWorker => w !== null)
        .sort((a, b) => {
          if (a.online !== b.online) return a.online ? -1 : 1
          return a.currentQueueDepth - b.currentQueueDepth
        })

      discoveredWorkers = parsed

      if (!selectedWorker && parsed.length > 0) {
        const available = parsed.find(w => w.online && w.currentQueueDepth < w.maxConcurrentJobs)
        if (available) selectedWorker = available
      }
    } catch (e) {
      console.error("[cicd] Worker discovery failed:", e)
    } finally {
      loadingWorkers = false
    }
  }

  function refreshWorkers() {
    selectedWorker = null
    discoverWorkers()
  }

  function selectWorker(w: LoomWorker) {
    selectedWorker = selectedWorker?.pubkey === w.pubkey ? null : w
  }

  onMount(() => {
    discoverWorkers()
  })

  const onAddEnvVar = () => {
    envVars = [...envVars, {key: "", value: ""}]
  }

  const onRemoveEnvVar = (index: number) => {
    envVars = envVars.filter((_, i) => i !== index)
  }

  const onAddSecret = () => {
    secrets = [...secrets, {key: "", value: ""}]
  }

  const onRemoveSecret = (index: number) => {
    secrets = secrets.filter((_, i) => i !== index)
  }

  const cicdPath = `/spaces/${relay}/git/${id}/cicd`

  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  const publishRelays = CICD_PUBLISH_RELAYS
  // All relays: publish relays + repo relays (for relay hints and HIVE_CI_RELAYS)
  const allRelays = $derived(
    [...new Set([...publishRelays, ...($repoRelaysStore || [])])],
  )
  const jobRelays = $derived(allRelays.join(","))

  // Convert repo coordinate to nostr:// URL for git-remote-nostr
  // Format: nostr://<npub>/<relay-hints>/<identifier>
  // Relay hints between npub and identifier let ngit discover the repo on a headless worker
  const repoNostrUrl = $derived.by(() => {
    if (!repoNaddr) return ""
    try {
      const parts = repoNaddr.split(":")
      if (parts.length === 3) {
        const [_kind, pk, identifier] = parts
        const npub = nip19.npubEncode(pk)
        const relayHints = allRelays.map(r => encodeURIComponent(r)).join("/")
        if (relayHints) {
          return `nostr://${npub}/${relayHints}/${identifier}`
        }
        return `nostr://${npub}/${identifier}`
      }
    } catch {
      // pass
    }
    return ""
  })

  const onSubmitWorkflow = async () => {
    if (!selectedBranch) {
      tokenError = "Please select a branch."
      return
    }
    if (!selectedWorker) {
      tokenError = "Please select a worker."
      return
    }
    if (!bestMint) {
      tokenError = overlappingMints.length === 0
        ? "No overlapping mints between your wallet and the worker."
        : "No Cashu wallet available."
      return
    }
    if (!hasEnoughBalance) {
      tokenError = `Insufficient balance on ${bestMint}. Need ${cashuAmount.toLocaleString()} sats but have ${bestMintBalance.toLocaleString()} sats.`
      return
    }

    generatingToken = true
    tokenError = ""

    try {
      // 1. Generate ephemeral keypair for result publishing
      const ephemeralSecretKey = generateSecretKey()
      const ephemeralPubkey = getPublicKey(ephemeralSecretKey)
      const ephemeralSecretKeyHex = bytesToHex(ephemeralSecretKey)

      // 2. Create payment token
      let paymentToken = ""
      try {
        paymentToken = await createCashuToken(cashuAmount, bestMint, "CI/CD pipeline runner")
      } catch (e: any) {
        console.error("[cicd] Failed to generate cashu token:", e)
        tokenError =
          e?.message === "backup_required"
            ? "Please back up your Cashu seed phrase before spending."
            : "Failed to generate token. Check your wallet balance."
        return
      }

      // 3. Upload workflow runner script to Blossom
      toast.push({message: "Uploading workflow script...", variant: "default"})
      let scriptUrl: string
      try {
        scriptUrl = await uploadScriptToBlossom()
      } catch (e: any) {
        console.error("[cicd] Failed to upload script:", e)
        tokenError = "Failed to upload workflow script to Blossom."
        return
      }

      // 4. Publish Kind 5401 (workflow run event)
      const workflowRunEvent = {
        kind: 5401,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["a", repoNaddr ?? ""],
          ["workflow", workflowPath],
          ["triggered-by", $pubkey ?? ""],
          ["publisher", ephemeralPubkey],
          ["trigger", "manual"],
          ["branch", selectedBranch],
          ["t", "hive-ci"],
        ],
        pubkey: $pubkey ?? "",
      }

      const signedRunEvent = await $signer.sign(workflowRunEvent)
      const pool = new SimplePool()
      await pool.publish(publishRelays, signedRunEvent)
      const runId = signedRunEvent.id

      console.log("[cicd] Published Kind 5401 workflow run:", runId)

      // 5. Build env tags (HIVE_CI_* vars + user env vars)
      const envTags = [
        ["env", "HIVE_CI_RUN_ID", runId],
        ["env", "HIVE_CI_REPOSITORY", repoNostrUrl],
        ["env", "HIVE_CI_WORKFLOW", workflowPath],
        ["env", "HIVE_CI_BRANCH", selectedBranch],
        ["env", "HIVE_CI_RELAYS", jobRelays],
        ["env", "HIVE_CI_BLOSSOM_SERVER", "https://blossom.primal.net"],
        ["env", "RUST_BACKTRACE", "1"],
        ...envVars
          .filter(e => e.key && e.value)
          .map(e => ["env", e.key, e.value]),
      ]

      // 6. Encrypt secrets via NIP-44 to worker pubkey (HIVE_CI_NSEC + user secrets)
      const secretTags: string[][] = []
      try {
        // Encrypt ephemeral private key as secret
        const encryptedPrivKey = await $signer.nip44.encrypt(selectedWorker.pubkey, ephemeralSecretKeyHex)
        secretTags.push(["secret", "HIVE_CI_NSEC", encryptedPrivKey])

        // Encrypt user-defined secrets
        const activeSecrets = secrets.filter(s => s.key && s.value)
        for (const s of activeSecrets) {
          const encrypted = await $signer.nip44.encrypt(selectedWorker.pubkey, s.value)
          secretTags.push(["secret", s.key, encrypted])
        }
      } catch (e) {
        console.error("[cicd] Failed to encrypt secrets:", e)
        tokenError = "Failed to encrypt secrets. Check your signer."
        return
      }

      // 7. Publish Kind 5100 (loom job request) referencing the workflow run
      const bashCommand = `curl -fsSL "${scriptUrl}" -o /tmp/run-workflow.sh && chmod +x /tmp/run-workflow.sh && /tmp/run-workflow.sh`

      const jobEvent = {
        kind: 5100,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["p", selectedWorker.pubkey],
          ["e", runId],
          ["cmd", "bash"],
          ["args", "-c", bashCommand],
          ["payment", paymentToken],
          ...envTags,
          ...secretTags,
        ],
        pubkey: $pubkey ?? "",
      }

      const signedJobEvent = await $signer.sign(jobEvent)
      await pool.publish(publishRelays, signedJobEvent)
      pool.close(publishRelays)

      console.log("[cicd] Published Kind 5100 loom job:", signedJobEvent.id, "referencing run:", runId)

      toast.push({
        message: "Workflow submitted successfully",
        variant: "default",
      })

      goto(`${cicdPath}/${runId}`)
    } catch (e) {
      console.error("Failed to submit workflow:", e)
      toast.push({
        message: "Failed to submit workflow",
        variant: "error",
      })
    } finally {
      generatingToken = false
    }
  }
</script>

<svelte:head>
  <title>New Run - {workflowName} - {repoClass.name}</title>
</svelte:head>

<div class="py-4">
  <!-- Header -->
  <div class="mb-6 flex items-center gap-3">
    <Button variant="ghost" size="sm" onclick={() => goto(cicdPath)}>
      <ChevronLeft class="h-4 w-4" />
    </Button>
    <div>
      <h2 class="text-xl font-semibold">Run {workflowName}</h2>
      <p class="text-sm text-muted-foreground">{workflowPath}</p>
    </div>
  </div>

  <div class="flex flex-col gap-6 lg:flex-row lg:items-start">
    <!-- Left column: Form -->
    <div class="min-w-0 flex-1 space-y-6">
      <!-- Worker Selection -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <label class="text-sm font-medium">Worker</label>
          <Button variant="ghost" size="sm" class="h-6 gap-1 text-xs" onclick={refreshWorkers}>
            <RotateCw class="h-3 w-3 {loadingWorkers ? 'animate-spin' : ''}" />
            Refresh
          </Button>
        </div>
        {#if loadingWorkers}
          <div
            class="flex items-center gap-2 rounded-md border border-input p-3 text-sm text-muted-foreground">
            <RotateCw class="h-4 w-4 animate-spin" />
            Discovering workers…
          </div>
        {:else if discoveredWorkers.length === 0}
          <div class="rounded-md border border-input p-3 text-sm text-muted-foreground">
            No compatible workers found. Workers must have <code>act</code> installed.
          </div>
        {:else}
          <div class="grid gap-2 sm:grid-cols-2">
            {#each discoveredWorkers as w (w.pubkey)}
              <button
                class="flex w-full items-start gap-3 rounded-md border p-3 text-left text-sm transition-colors {selectedWorker?.pubkey ===
                w.pubkey
                  ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/30'
                  : 'border-input hover:bg-accent'}"
                onclick={() => selectWorker(w)}>
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-2">
                    <span class="truncate font-medium">{w.name}</span>
                    <span
                      class="inline-flex h-2 w-2 shrink-0 rounded-full {w.online
                        ? 'bg-green-500'
                        : 'bg-gray-300'}"></span>
                  </div>
                  {#if w.description}
                    <p class="mt-0.5 text-xs text-muted-foreground">{w.description}</p>
                  {/if}
                  <div class="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>{w.architecture}</span>
                    {#if w.actVersion}<span>act {w.actVersion}</span>{/if}
                    <span>{w.pricing.perSecondRate} {w.pricing.unit}/s</span>
                    <span>Queue: {w.currentQueueDepth}/{w.maxConcurrentJobs}</span>
                  </div>
                </div>
                {#if selectedWorker?.pubkey === w.pubkey}
                  <Check class="mt-0.5 h-4 w-4 shrink-0 text-blue-500" />
                {/if}
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="grid gap-6 sm:grid-cols-2">
        <!-- Branch Selection -->
        <div class="space-y-2">
          <label for="branch-select" class="text-sm font-medium">Branch</label>
          <select
            id="branch-select"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            bind:value={selectedBranch}>
            <option value="" disabled>Select a branch</option>
            {#each repoClass.branches as branch}
              <option value={branch.name}>{branch.name}</option>
            {/each}
          </select>
        </div>

        <!-- Max Duration -->
        <div class="space-y-2">
          <label for="max-duration" class="text-sm font-medium">Max Duration (seconds)</label>
          <input
            id="max-duration"
            type="number"
            class="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            placeholder="600"
            min="1"
            bind:value={maxDuration} />
        </div>
      </div>

      <!-- Environment Variables -->
      <div class="space-y-2">
        <span class="text-sm font-medium">Environment Variables</span>
        <div class="space-y-2">
          {#each envVars as envVar, index (index)}
            <div class="flex gap-2">
              <input
                type="text"
                class="w-48 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                placeholder="KEY"
                bind:value={envVar.key} />
              <input
                type="text"
                class="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                placeholder="value"
                bind:value={envVar.value} />
              {#if envVars.length > 1}
                <button
                  class="shrink-0 p-2 text-muted-foreground hover:text-destructive"
                  onclick={() => onRemoveEnvVar(index)}>
                  <X class="h-4 w-4" />
                </button>
              {/if}
            </div>
          {/each}
          <button
            class="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-input text-muted-foreground hover:border-foreground hover:text-foreground"
            onclick={onAddEnvVar}>
            <Plus class="h-4 w-4" />
          </button>
        </div>
      </div>

      <!-- Secrets (NIP-44 encrypted) -->
      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium">Secrets</span>
          <Lock class="h-3 w-3 text-muted-foreground" />
        </div>
        <p class="text-xs text-muted-foreground">
          Encrypted with NIP-44 to the worker. Only the worker can decrypt these.
        </p>
        <div class="space-y-2">
          {#each secrets as secret, index (index)}
            <div class="flex gap-2">
              <input
                type="text"
                class="w-48 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                placeholder="SECRET_KEY"
                bind:value={secret.key} />
              <input
                type="password"
                class="flex-1 rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                placeholder="secret value"
                bind:value={secret.value} />
              {#if secrets.length > 1}
                <button
                  class="shrink-0 p-2 text-muted-foreground hover:text-destructive"
                  onclick={() => onRemoveSecret(index)}>
                  <X class="h-4 w-4" />
                </button>
              {/if}
            </div>
          {/each}
          <button
            class="flex h-8 w-8 items-center justify-center rounded-md border border-dashed border-input text-muted-foreground hover:border-foreground hover:text-foreground"
            onclick={onAddSecret}>
            <Plus class="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>

    <!-- Right column: Payment summary (sticky) -->
    <div class="w-full shrink-0 lg:sticky lg:top-4 lg:w-80">
      <div
        class="space-y-3 rounded-lg border border-blue-200 bg-blue-50/50 p-4 dark:border-blue-900 dark:bg-blue-950/30">
        <h4 class="text-sm font-medium">Payment Summary</h4>
        <div class="space-y-1 text-sm">
          <div class="flex justify-between">
            <span class="text-muted-foreground">Rate:</span>
            <span class="font-mono"
              >{perSecondRate} {selectedWorker?.pricing.unit ?? "sat"}/s</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Min. payment:</span>
            <span class="font-mono">{minCost.toLocaleString()} sats</span>
          </div>
          <div class="flex justify-between">
            <span class="text-muted-foreground">Est. change:</span>
            <span class="font-mono text-green-600 dark:text-green-400">0 – {maxChange.toLocaleString()} sats</span>
          </div>
          <div class="flex justify-between border-t border-blue-200 pt-1 dark:border-blue-800">
            <span class="font-medium">Prepayment:</span>
            <span class="font-mono font-semibold">{cashuAmount.toLocaleString()} sats</span>
          </div>
        </div>

        {#if selectedWorker && overlappingMints.length === 0}
          <div class="rounded-md border border-amber-300 bg-amber-50 p-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            No overlapping mints. Your wallet uses {walletMints.join(", ") || "no mints"} but the worker accepts {selectedWorker.mints.join(", ")}.
          </div>
        {:else if bestMint}
          <div class="flex items-center justify-between text-xs">
            <span class="text-muted-foreground">
              Mint: {bestMint.replace(/^https?:\/\//, "").split("/")[0]}
            </span>
            <span class="font-mono">{bestMintBalance.toLocaleString()} sats</span>
          </div>
          {#if !hasEnoughBalance}
            <div class="text-xs text-error">Insufficient balance on this mint.</div>
          {/if}
        {/if}

        <p class="text-xs text-muted-foreground">Unused payment returned as change.</p>
        {#if tokenError}
          <p class="text-xs text-error">{tokenError}</p>
        {/if}

        <div class="flex flex-col gap-2 border-t border-blue-200 pt-3 dark:border-blue-800">
          <Button
            variant="git"
            class="w-full"
            onclick={onSubmitWorkflow}
            disabled={generatingToken || !selectedWorker || !hasEnoughBalance || overlappingMints.length === 0}>
            {#if generatingToken}
              Generating payment…
            {:else}
              <Play class="h-4 w-4" />
              Submit ({cashuAmount.toLocaleString()} sats)
            {/if}
          </Button>
          <Button variant="outline" class="w-full" onclick={() => goto(cicdPath)}>Cancel</Button>
        </div>
      </div>
    </div>
  </div>
</div>
