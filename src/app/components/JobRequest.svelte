<script lang="ts">
  import {signer} from "@welshman/app"
  import {makeEvent, type EventTemplate} from "@welshman/util"
  import {publishJobRequest} from "@app/core/commands"
  import {pushToast} from "@app/util/toast"
  import {INDEXER_RELAYS} from "@app/core/state"
  import {DEFAULT_WORKER_PUBKEY} from "@lib/budabit/state"
  import {isMobile, preventDefault} from "@lib/html"
  import CpuBolt from "@assets/icons/cpu-bolt.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Field from "@lib/components/Field.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"

  interface JobRequestResult {
    event: any
    successCount: number
    failureCount: number
    publishStatus: Array<{
      relay: string
      success: boolean
      error?: string
    }>
  }

  const {url} = $props()

  let cashuToken: string = $state("")
  let isSubmitting: boolean = $state(false)
  let result: JobRequestResult | null = $state(null)
  let showRawEvent: boolean = $state(false)

  const back = () => history.back()

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      pushToast({
        theme: "success" as any,
        message: "Copied to clipboard!",
      })
    } catch (error) {
      console.error("Failed to copy to clipboard:", error)
      pushToast({
        theme: "error",
        message: "Failed to copy to clipboard",
      })
    }
  }

  const submit = async () => {
    if (isSubmitting) return

    if (!cashuToken.trim()) {
      return pushToast({
        theme: "error",
        message: "Please enter a Cashu token.",
      })
    }

    isSubmitting = true
    result = null
    showRawEvent = false

    try {
      const relays = [url, ...INDEXER_RELAYS]
      const jobResult = await publishJobRequest({
        cashuToken: cashuToken.trim(),
        relays,
        cmd: "act",
        args: ["--help"]
      })

      result = jobResult

      if (jobResult.successCount > 0) {
        pushToast({
          theme: "success" as any,
          message: `Job request published to ${jobResult.successCount}/${relays.length} relays`,
        })
      } else {
        pushToast({
          theme: "error",
          message: "Failed to publish job request to any relay",
        })
      }
    } catch (error) {
      console.error("Error publishing job request:", error)
      pushToast({
        theme: "error",
        message: `Error: ${error}`,
      })
    } finally {
      isSubmitting = false
    }
  }

  const formatEvent = (event: any) => {
    return JSON.stringify(event, null, 2)
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      <div>Run Job Request</div>
    {/snippet}
    {#snippet info()}
      <div>Submit a job request to Loom compute worker.</div>
    {/snippet}
  </ModalHeader>

  <div class="col-8">
    <Field>
      {#snippet label()}
        <p>Cashu Token*</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={CpuBolt} />
          <input
            bind:value={cashuToken}
            class="grow"
            type="text"
            placeholder="cashuAxxxxxxxxxxxxxxx..."
            disabled={isSubmitting} />
        </label>
      {/snippet}
    </Field>

    <Field>
      {#snippet label()}
        <p>Worker</p>
      {/snippet}
      {#snippet input()}
        <div class="flex items-center gap-2">
          <code class="text-sm opacity-75">{DEFAULT_WORKER_PUBKEY.slice(0, 16)}...</code>
          <span class="text-sm opacity-50">(hardcoded)</span>
        </div>
      {/snippet}
    </Field>

    <Field>
      {#snippet label()}
        <p>Command</p>
      {/snippet}
      {#snippet input()}
        <div class="flex items-center gap-2">
          <code>act --help</code>
          <span class="text-sm opacity-50">(hardcoded)</span>
        </div>
      {/snippet}
    </Field>

    {#if result}
      <div class="border border-base-200 rounded-lg p-4 space-y-3">
        <h3 class="font-semibold text-lg">Publish Results</h3>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span>Success:</span>
            <span class="text-success">{result.successCount}/{result.publishStatus.length} relays</span>
          </div>
          <div class="flex items-center justify-between">
            <span>Failures:</span>
            <span class="text-error">{result.failureCount} relays</span>
          </div>
        </div>

        <div class="space-y-1">
          {#each result.publishStatus as status}
            <div class="flex items-center gap-2 text-sm">
              {#if status.success}
                <span class="text-success">✅</span>
                <span class="text-success">{status.relay}</span>
              {:else}
                <span class="text-error">❌</span>
                <span class="text-error">{status.relay}</span>
                {#if status.error}
                  <span class="text-xs opacity-75">({status.error})</span>
                {/if}
              {/if}
            </div>
          {/each}
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-medium">Event ID:</span>
            <Button
              class="btn btn-sm btn-outline"
              onclick={() => result && copyToClipboard(result.event.id)}
            >
              Copy ID
            </Button>
          </div>
          <code class="block w-full p-2 bg-base-100 rounded text-xs break-all">
            {result.event.id}
          </code>
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <span class="font-medium">Raw Event:</span>
            <Button
              class="btn btn-sm"
              onclick={() => showRawEvent = !showRawEvent}
            >
              {showRawEvent ? 'Hide' : 'Show'}
            </Button>
          </div>
          {#if showRawEvent}
            <div class="relative">
              <pre class="block w-full p-3 bg-base-100 rounded text-xs overflow-auto max-h-64 whitespace-pre-wrap">
                {formatEvent(result.event)}
              </pre>
              <Button
                class="btn btn-sm btn-outline absolute top-2 right-2"
                onclick={() => result && copyToClipboard(formatEvent(result.event))}
              >
                Copy Event
              </Button>
            </div>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <ModalFooter>
    <Button class="btn btn-link" onclick={back} disabled={isSubmitting}>
      Cancel
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={isSubmitting}>
      {#if isSubmitting}
        <span class="loading loading-spinner loading-sm"></span>
        Publishing...
      {:else}
        Run Job
      {/if}
    </Button>
  </ModalFooter>
</form>
