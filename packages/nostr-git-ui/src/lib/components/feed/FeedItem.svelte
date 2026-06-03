<script lang="ts">
  import { useRegistry } from "../../useRegistry";
  import {
    MessageSquare,
    Heart,
    Bookmark,
    Share2,
    MoreHorizontal,
    Link as LinkIcon,
  } from "@lucide/svelte";
  import TimeAgo from "../../TimeAgo.svelte";
  import type { Profile } from "@nostr-git/core/events";

  interface Props {
    author: Profile;
    createdAt: string;
    eventId?: string;
    children?: import("svelte").Snippet;
    actions?: import("svelte").Snippet;
    showQuickActions?: boolean;
    isHighlighted?: boolean;
    onReply?: () => void;
    onReact?: () => void;
    onBookmark?: () => void;
    onShare?: () => void;
  }

  const {
    author,
    createdAt,
    eventId,
    children,
    actions,
    showQuickActions = true,
    isHighlighted = false,
    onReply,
    onReact,
    onBookmark,
    onShare,
  }: Props = $props();

  let isHovered = $state(false);
  let showActions = $derived(isHovered && showQuickActions);

  const authorName = $derived(
    author?.name || author?.display_name || author?.nip05?.split("@")[0] || "Anonymous"
  );

  const handleCopyLink = () => {
    if (eventId) {
      // Copy event link to clipboard
      const link = `nostr:${eventId}`;
      navigator.clipboard.writeText(link);
    }
  };
</script>

<div
  class={`group relative px-4 py-2.5 hover:bg-muted/30 transition-colors duration-150 ${
    isHighlighted ? "bg-blue-500/10 border-l-2 border-blue-500" : ""
  }`}
  onmouseenter={() => (isHovered = true)}
  onmouseleave={() => (isHovered = false)}
  role="article"
>
  <div class="flex gap-3">
    <!-- Content -->
    <div class="flex-1 min-w-0">
      <!-- Main Content -->
      {#if children}
        <div class="text-sm text-foreground">
          {@render children()}
        </div>
      {/if}

      <!-- Custom Actions (if provided) -->
      {#if actions}
        <div class="mt-2">
          {@render actions()}
        </div>
      {/if}
    </div>

    <!-- Quick Actions (appear on hover) -->
    {#if showActions}
      <div
        class="absolute top-2 right-4 flex items-center gap-1 bg-popover border border-border rounded-lg shadow-lg px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
      >
        {#if onReact}
          <button
            onclick={onReact}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Add reaction"
            aria-label="Add reaction"
          >
            <Heart class="w-4 h-4 text-muted-foreground hover:text-pink-500" />
          </button>
        {/if}

        {#if onReply}
          <button
            onclick={onReply}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Reply"
            aria-label="Reply"
          >
            <MessageSquare class="w-4 h-4 text-muted-foreground hover:text-blue-500" />
          </button>
        {/if}

        {#if onBookmark}
          <button
            onclick={onBookmark}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Bookmark"
            aria-label="Bookmark"
          >
            <Bookmark class="w-4 h-4 text-muted-foreground hover:text-yellow-600 dark:hover:text-yellow-400" />
          </button>
        {/if}

        {#if eventId}
          <button
            onclick={handleCopyLink}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Copy link"
            aria-label="Copy link"
          >
            <LinkIcon class="w-4 h-4 text-muted-foreground hover:text-foreground" />
          </button>
        {/if}

        <button
          class="p-1.5 hover:bg-muted rounded transition-colors"
          title="More options"
          aria-label="More options"
        >
          <MoreHorizontal class="w-4 h-4 text-muted-foreground" />
        </button>
      </div>
    {/if}
  </div>
</div>
