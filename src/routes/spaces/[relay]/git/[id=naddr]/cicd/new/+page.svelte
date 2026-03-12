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
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"

  const repoClass = getContext<Repo>(REPO_KEY)
  if (!repoClass) {
    throw new Error("Repo context not available")
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
  let selectedBranch = $state("master")
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

  const workerRelays = ["wss://relay.sharegap.net", "wss://nos.lol", "wss://relay.primal.net"]

  async function discoverWorkers() {
    loadingWorkers = true
    try {
      const pool = new SimplePool()
      const events = await pool.querySync(workerRelays, {kinds: [10100]})

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

  // Convert repo coordinate to nostr:// URL for the workflow runner script
  const repoNostrUrl = $derived.by(() => {
    if (!repoNaddr) return ""
    try {
      const parts = repoNaddr.split(":")
      if (parts.length === 3) {
        const [kind, pk, identifier] = parts
        const naddrEncoded = nip19.naddrEncode({
          kind: parseInt(kind),
          pubkey: pk,
          identifier,
          relays: [],
        })
        return `nostr://${naddrEncoded}`
      }
    } catch {
      // pass
    }
    return ""
  })

  const publishRelays = ["wss://relay.sharegap.net", "wss://nos.lol"]

  const onSubmitWorkflow = async () => {
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

      // 3. Publish Kind 5401 (workflow run event)
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

      // 4. Build env tags (HIVE_CI_* vars + user env vars)
      const envTags = [
        ["env", "HIVE_CI_RUN_ID", runId],
        ["env", "HIVE_CI_REPOSITORY", repoNostrUrl],
        ["env", "HIVE_CI_WORKFLOW", workflowPath],
        ["env", "HIVE_CI_BRANCH", selectedBranch],
        ["env", "HIVE_CI_RELAYS", publishRelays.join(",")],
        ...envVars
          .filter(e => e.key && e.value)
          .map(e => ["env", e.key, e.value]),
      ]

      // 5. Encrypt secrets via NIP-44 to worker pubkey (HIVE_CI_PRIVATEKEY + user secrets)
      const secretTags: string[][] = []
      try {
        // Encrypt ephemeral private key as secret
        const encryptedPrivKey = await $signer.nip44.encrypt(selectedWorker.pubkey, ephemeralSecretKeyHex)
        secretTags.push(["secret", "HIVE_CI_PRIVATEKEY", encryptedPrivKey])

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

      // 6. Publish Kind 5100 (loom job request) referencing the workflow run
      const scriptUrl = "https://blossom.primal.net/run-workflow.sh"
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

      console.log("[cicd] Published Kind 5100 loom job:", signedJobEvent.id, "referencing run:", runId)

      toast.push({
        message: "Workflow submitted successfully",
        variant: "default",
      })

      goto(cicdPath)
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
            <option value="master">master</option>
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
