<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {page} from "$app/stores"
  import {decodeRelay, getEventsForUrl} from "@app/core/state"
  import {makeFeed} from "@app/core/requests"
  import {sortBy} from "@welshman/lib"
  import {Button} from "@nostr-git/ui"

  const url = decodeRelay($page.params.relay!)
  const repositoryNaddr = $page.params.id!
  const workflowFilter = {kinds: [5100], "#a": [repositoryNaddr]}

  let loading = $state(true)
  let events = $state<any[]>([])
  let feedCleanup: (() => void) | undefined = $state(undefined)

  onMount(() => {
    console.log("=== Starting workflow query test ===")
    console.log("URL:", url)
    console.log("Repository naddr:", repositoryNaddr)
    console.log("Filter:", workflowFilter)

    const {cleanup} = makeFeed({
      element: document.body,
      relays: ["wss://relay.damus.io"],
      feedFilters: [workflowFilter],
      subscriptionFilters: [workflowFilter],
      initialEvents: getEventsForUrl(url, [workflowFilter]),
      onEvent: event => {
        console.log("✅ Received workflow event:", event.id, event.kind)
        console.log("   Full tags array:", JSON.stringify(event.tags, null, 2))
        console.log(
          "   #a tags:",
          event.tags.filter((t: string[]) => t[0] === "a"),
        )
        console.log("   Content:", event.content.substring(0, 200))
        events = sortBy(e => -e.created_at, [event, ...events])
      },
      onExhausted: () => {
        console.log(`🎉 Feed exhausted. Total events: ${events.length}`)
        loading = false
      },
    })

    feedCleanup = cleanup
  })

  onDestroy(() => {
    if (feedCleanup) {
      console.log("Cleaning up feed")
      feedCleanup()
    }
  })
</script>

<svelte:head>
  <title>Workflow Query Test</title>
</svelte:head>

<div class="space-y-6 p-8">
  <h1 class="mb-6 text-3xl font-bold">Kind 5100 Workflow Events Test</h1>

  <div class="mb-6 rounded-lg border bg-gray-50 p-4">
    <h2 class="mb-2 font-semibold">Relay</h2>
    <code class="block break-all rounded bg-gray-800 p-3 text-sm text-gray-100">
      wss://relay.damus.io
    </code>
  </div>

  <div class="mb-6 rounded-lg border bg-purple-50 p-4">
    <h2 class="mb-2 font-semibold">Repository Filter</h2>
    <p class="mb-2 text-sm text-gray-600">
      Only showing events with #a tag matching this repository:
    </p>
    <code class="block break-all rounded bg-purple-800 p-3 text-sm text-purple-100">
      {repositoryNaddr}
    </code>
  </div>

  <div class="mb-6 rounded-lg border bg-blue-50 p-4">
    <h2 class="mb-2 font-semibold">Status</h2>
    <p class="text-lg">
      {#if loading}
        Querying damus relay...
      {:else}
        {events.length} event{events.length === 1 ? "" : "s"} found
      {/if}
    </p>
  </div>

  {#if events.length > 0}
    <div class="space-y-4">
      <h2 class="mb-4 text-2xl font-semibold">
        Found {events.length} Event{events.length === 1 ? "" : "s"} for this repository
      </h2>

      {#each events as event, i}
        <div class="space-y-3 rounded-lg border bg-white p-4">
          <div class="mb-3 flex items-center gap-2">
            <span class="text-lg font-semibold">Event {i + 1}</span>
            <span class="rounded bg-blue-100 px-2 py-1 text-xs text-blue-800">
              Kind {event.kind}
            </span>
          </div>
          <div class="mb-3 font-mono text-sm text-gray-700">ID: {event.id}</div>
          <div class="mb-3 text-sm">
            Created: {new Date(event.created_at * 1000).toLocaleString()}
          </div>
          <div class="mb-3 text-sm">
            <strong>Pubkey:</strong>
            {event.pubkey.substring(0, 8)}...{event.pubkey.substring(8)}
          </div>
          {#if event.content}
            <div class="mb-3 rounded bg-green-50 p-3">
              <h3 class="mb-2 font-semibold">Content Preview</h3>
              <pre
                class="overflow-auto bg-green-800 p-2 text-xs text-green-100">{event.content.substring(
                  0,
                  500,
                )}{event.content.length > 500 ? "..." : ""}</pre>
            </div>
          {/if}
          <div class="mb-3 rounded bg-gray-100 p-3">
            <h3 class="mb-2 font-semibold">Full Tags Array</h3>
            <pre
              class="max-h-48 overflow-auto bg-gray-800 p-2 text-xs text-gray-100">{JSON.stringify(
                event.tags,
                null,
                2,
              )}</pre>
          </div>
          <div class="mb-3 rounded bg-gray-100 p-3">
            <h3 class="mb-2 font-semibold">#a Tags Only</h3>
            {#if event.tags.find((t: string[]) => t[0] === "a")}
              <pre class="overflow-auto bg-gray-800 p-2 text-xs text-gray-100">{JSON.stringify(
                  event.tags.find((t: string[]) => t[0] === "a"),
                  null,
                  2,
                )}</pre>
            {:else}
              <p class="text-sm text-gray-500">No #a tag found</p>
            {/if}
          </div>
          <details class="mt-3">
            <summary class="cursor-pointer text-sm text-blue-600 hover:text-blue-800">
              View full event JSON
            </summary>
            <pre
              class="mt-2 max-h-96 overflow-auto rounded bg-gray-900 p-3 text-xs text-gray-100">{JSON.stringify(
                event,
                null,
                2,
              )}</pre>
          </details>
        </div>
      {/each}
    </div>
  {:else if !loading}
    <div class="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
      <p class="text-lg text-gray-600">No events found.</p>
      <p class="mt-2 text-sm text-gray-500">Check browser console for detailed logs.</p>
    </div>
  {/if}
</div>
