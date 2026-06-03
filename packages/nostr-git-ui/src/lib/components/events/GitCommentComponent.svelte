<script lang="ts">
  import { nip19, type NostrEvent } from "nostr-tools";
  import { onMount } from "svelte";
  import { MessageCircle, Copy, Reply } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  import RichText from "../RichText.svelte";

  const { Card, Button, ProfileLink, Markdown } = useRegistry();

  interface Props {
    event: NostrEvent;
    relays?: string[];
  }

  let { event, relays = [] }: Props = $props();

  // Reactive state using Svelte 5 runes
  let commentSubject = $state("");
  let authorNpub = $state("");
  let repoAddress = $state("");
  let replyToEventId = $state("");
  let threadDepth = $state(0);

  // Derived computed values
  const displaySubject = $derived(commentSubject || "Comment");
  const commentContent = $derived(event.content || "");
  const createdDate = $derived(new Date(event.created_at * 1000));
  const isReply = $derived(!!replyToEventId);
  const shortReplyId = $derived(replyToEventId ? replyToEventId.slice(0, 8) : "");

  // Parse event tags to extract comment information
  const parseEventData = () => {
    const tags = event.tags || [];

    for (const tag of tags) {
      switch (tag[0]) {
        case "subject":
          commentSubject = tag[1] || "";
          break;
        case "a":
          repoAddress = tag[1] || "";
          break;
        case "e":
          replyToEventId = tag[1] || "";
          break;
        case "depth":
          threadDepth = parseInt(tag[1] || "0", 10);
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

  // Handle reply action (placeholder for future implementation)
  const handleReply = () => {
    console.log("Reply to comment:", event.id);
  };

  onMount(() => {
    parseEventData();
  });
</script>

<Card
  class="git-card hover:bg-muted/20 transition-colors"
  style="margin-left: {threadDepth * 12}px;"
>
  <div class="flex items-start gap-3">
    <MessageCircle class="h-6 w-6 mt-1 text-blue-600" />

    <div class="flex-1">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <h3 class="text-base font-semibold mb-0.5 leading-tight">
            {displaySubject}
          </h3>
        </div>

        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
          onclick={handleReply}
          title="Reply to comment"
        >
          <Reply class="h-3 w-3 mr-1" />
          Reply
        </Button>
      </div>

      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>By <ProfileLink pubkey={event.pubkey} /></span>
        <span>•</span>
        <span>{createdDate.toLocaleDateString()}</span>
        {#if isReply}
          <span>•</span>
          <span class="flex items-center gap-1">
            <Reply class="h-3 w-3" />
            Reply to {shortReplyId}...
          </span>
        {/if}
        {#if threadDepth > 0}
          <span>•</span>
          <span>Level {threadDepth}</span>
        {/if}
      </div>

      <div class="text-muted-foreground text-sm mb-3">
        {#if Markdown}
          <Markdown content={commentContent} event={event as any} variant="comment" />
        {:else}
          <RichText content={commentContent} prose={false} />
        {/if}
      </div>

      {#if repoAddress}
        <div class="flex items-center gap-2 text-xs">
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
        </div>
      {/if}
    </div>
  </div>
</Card>
