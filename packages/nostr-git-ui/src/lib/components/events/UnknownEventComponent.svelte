<script lang="ts">
  import { nip19, type NostrEvent } from "nostr-tools";
  import { onMount } from "svelte";
  import { HelpCircle, Copy } from "@lucide/svelte";

  interface Props {
    event: NostrEvent;
  }

  let { event }: Props = $props();

  let authorNpub = $state("");
  let eventId = $state("");
  let expandedRaw = $state(false);

  const shortNpub = $derived(authorNpub ? authorNpub.slice(0, 16) + "..." : "");
  const shortEventId = $derived(eventId ? eventId.slice(0, 16) + "..." : "");
  const eventContent = $derived(event.content || "");
  const createdDate = $derived(new Date(event.created_at * 1000));
  const formattedDate = $derived(
    createdDate.toLocaleDateString() + " " + createdDate.toLocaleTimeString()
  );
  const tagCount = $derived(event.tags?.length || 0);

  const parseEventData = () => {
    if (event.pubkey) {
      try {
        authorNpub = nip19.npubEncode(event.pubkey);
      } catch (error) {
        console.warn("Failed to encode npub:", error);
        authorNpub = event.pubkey.slice(0, 16) + "...";
      }
    }

    eventId = event.id || "";
  };

  $effect(() => {
    if (event) {
      parseEventData();
    }
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };
  const toggleRawData = () => {
    expandedRaw = !expandedRaw;
  };

  onMount(() => {
    // Initialize component
    parseEventData();
  });
</script>

<div class="unknown-event border-l-4 border-yellow-500 bg-yellow-50 p-4 rounded-r-lg transition-all duration-200 ease-in-out hover:shadow-md dark:bg-yellow-950/30">
  <div class="flex items-start gap-3">
    <HelpCircle class="text-yellow-600 dark:text-yellow-300 mt-1" size={20} />

    <div class="flex-1">
      <div class="flex items-center gap-2 mb-2">
        <h3 class="font-semibold text-lg text-yellow-900 dark:text-yellow-100">
          Unknown Event Kind {event.kind}
        </h3>
        <span class="text-sm text-yellow-800 bg-yellow-200 px-2 py-1 rounded dark:bg-yellow-900/50 dark:text-yellow-200">
          Kind {event.kind}
        </span>
      </div>

      {#if eventContent}
        <div class="prose prose-sm max-w-none mb-3 break-words overflow-wrap-anywhere">
          <div class="bg-gray-50 p-3 rounded border dark:border-gray-700 dark:bg-gray-900/70">
            <p class="text-gray-800 whitespace-pre-wrap dark:text-gray-100">{eventContent}</p>
          </div>
        </div>
      {/if}

      <div class="space-y-2">
        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-yellow-800/80 dark:text-yellow-100/70">Author:</span>
          <span class="text-sm text-yellow-700 dark:text-yellow-300 font-mono">{shortNpub}</span>
          <button
            type="button"
            onclick={() => copyToClipboard(event.pubkey)}
            class="text-yellow-600 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-200 text-sm"
            title="Copy pubkey"
          >
            <Copy size={16} />
          </button>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-yellow-800/80 dark:text-yellow-100/70">Event ID:</span>
          <code class="bg-gray-100 px-2 py-1 rounded text-xs font-mono text-gray-900 dark:bg-gray-900/70 dark:text-gray-100">
            {shortEventId}
          </code>
          <button
            type="button"
            onclick={() => copyToClipboard(eventId)}
            class="text-yellow-600 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-200 text-sm"
            title="Copy full event ID"
          >
            <Copy size={16} />
          </button>
        </div>

        <div class="flex items-center gap-2">
          <span class="text-sm font-medium text-yellow-800/80 dark:text-yellow-100/70">Tags:</span>
          <span class="text-sm text-gray-700 dark:text-gray-300">
            {tagCount} tag{tagCount !== 1 ? "s" : ""}
          </span>
        </div>

        {#if event.tags && event.tags.length > 0}
          <div class="flex items-start gap-2">
            <span class="text-sm font-medium text-yellow-800/80 dark:text-yellow-100/70">Tag preview:</span>
            <div class="flex gap-1 flex-wrap">
              {#each event.tags.slice(0, 3) as tag}
                <span class="text-xs bg-gray-100 text-gray-700 px-2 py-1 rounded font-mono dark:bg-gray-800 dark:text-gray-300">
                  {tag[0]}{tag[1]
                    ? `: ${tag[1].slice(0, 20)}${tag[1].length > 20 ? "..." : ""}`
                    : ""}
                </span>
              {/each}
              {#if event.tags.length > 3}
                <span class="text-xs text-yellow-700/80 dark:text-yellow-200/70">
                  +{event.tags.length - 3} more
                </span>
              {/if}
            </div>
          </div>
        {/if}
      </div>

      <div class="mt-3 flex items-center justify-between">
        <div class="text-xs text-yellow-700/70 dark:text-yellow-200/60">
          Created {formattedDate}
        </div>

        <button
          type="button"
          onclick={toggleRawData}
          class="text-xs text-yellow-600 hover:text-yellow-800 dark:text-yellow-300 dark:hover:text-yellow-200 underline"
        >
          {expandedRaw ? "Hide" : "Show"} Raw Data
        </button>
      </div>

      {#if expandedRaw}
        <div class="mt-3 bg-gray-900 text-green-400 p-3 rounded text-xs font-mono overflow-x-auto">
          <pre class="whitespace-pre-wrap break-words max-h-[300px] overflow-y-auto">{JSON.stringify(event, null, 2)}</pre>
        </div>
      {/if}
    </div>
  </div>
</div>
