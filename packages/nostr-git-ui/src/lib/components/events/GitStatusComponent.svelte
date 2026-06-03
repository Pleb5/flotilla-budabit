<script lang="ts">
  import { nip19, type NostrEvent } from "nostr-tools";
  import { onMount } from "svelte";
  import { Activity, Copy } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";

  const { Card, Button, ProfileLink, Badge } = useRegistry();

  interface Props {
    event: NostrEvent;
  }

  let { event }: Props = $props();

  let statusMessage = $state("");
  let authorNpub = $state("");
  let repoAddress = $state("");
  let targetEventId = $state("");
  let previousStatus = $state("");
  let newStatus = $state("");

  const displayMessage = $derived(statusMessage || event.content || "Status change");
  const createdDate = $derived(new Date(event.created_at * 1000));

  const statusTypeInfo = $derived.by(() => {
    switch (event.kind) {
      case 1630:
        return {
          type: "Issue Status",
          color: "text-amber-500",
        };
      case 1631:
        return {
          type: "Merged Status",
          color: "text-purple-500",
        };
      case 1632:
        return {
          type: "Repository Status",
          color: "text-blue-500",
        };
      case 1633:
        return {
          type: "General Status",
          color: "text-gray-500",
        };
      default:
        return {
          type: "Status Change",
          color: "text-yellow-500",
        };
    }
  });

  const parseEventData = () => {
    const tags = event.tags || [];

    for (const tag of tags) {
      switch (tag[0]) {
        case "status":
          newStatus = tag[1] || "";
          break;
        case "previous-status":
          previousStatus = tag[1] || "";
          break;
        case "a":
          repoAddress = tag[1] || "";
          break;
        case "e":
          targetEventId = tag[1] || "";
          break;
        case "subject":
          statusMessage = tag[1] || "";
          break;
      }
    }

    // Generate npub from pubkey
    if (event.pubkey) {
      try {
        authorNpub = nip19.npubEncode(event.pubkey);
      } catch (error) {
        console.warn("Failed to encode npub:", error);
        authorNpub = event.pubkey.slice(0, 16) + "...";
      }
    }
  };

  // Effect to handle event updates
  $effect(() => {
    if (event) {
      parseEventData();
    }
  });

  // Handle copy to clipboard functionality
  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
    }
  };

  onMount(() => {
    parseEventData();
  });
</script>

<Card class="git-card hover:bg-muted/20 transition-colors">
  <div class="flex items-start gap-3">
    <Activity class={`h-6 w-6 mt-1 ${statusTypeInfo.color}`} />

    <div class="flex-1">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <h3 class="text-base font-semibold mb-0.5 leading-tight">
            {displayMessage}
          </h3>
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>By <ProfileLink pubkey={event.pubkey} /></span>
        <span>•</span>
        <span>{createdDate.toLocaleDateString()}</span>
        <span>•</span>
        <Badge variant="secondary" class="text-xs px-2 py-0.5 {statusTypeInfo.color}">
          {statusTypeInfo.type}
        </Badge>
      </div>

      {#if previousStatus && newStatus}
        <div class="flex items-center gap-2 mb-3">
          <span class="text-xs text-muted-foreground">Status:</span>
          <Badge variant="outline" class="text-xs px-2 py-0.5 text-red-600">
            {previousStatus}
          </Badge>
          <span class="text-muted-foreground">→</span>
          <Badge variant="outline" class="text-xs px-2 py-0.5 text-green-600">
            {newStatus}
          </Badge>
        </div>
      {:else if newStatus}
        <div class="flex items-center gap-2 mb-3">
          <span class="text-xs text-muted-foreground">New Status:</span>
          <Badge variant="outline" class="text-xs px-2 py-0.5 text-green-600">
            {newStatus}
          </Badge>
        </div>
      {/if}

      <div class="flex items-center justify-between">
        <div class="flex gap-2 text-xs">
          {#if repoAddress}
            <span class="text-muted-foreground">Repository:</span>
            <code class="bg-muted px-2 py-1 rounded font-mono">
              {repoAddress.split("/").pop() || repoAddress}
            </code>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-1"
              onclick={() => copyToClipboard(repoAddress)}
              title="Copy repository address"
            >
              <Copy class="h-3 w-3" />
            </Button>
          {/if}
        </div>

        {#if targetEventId}
          <div class="flex items-center gap-1 text-xs text-muted-foreground">
            <span>Target:</span>
            <code class="bg-muted px-2 py-1 rounded font-mono">
              {targetEventId.slice(0, 8)}...
            </code>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-1"
              onclick={() => copyToClipboard(targetEventId)}
              title="Copy event ID"
            >
              <Copy class="h-3 w-3" />
            </Button>
          </div>
        {/if}
      </div>
    </div>
  </div>
</Card>
