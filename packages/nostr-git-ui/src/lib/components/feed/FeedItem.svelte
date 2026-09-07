<script lang="ts">
  import { toast } from "../../stores/toast";
  import { getCopySuccessMessage } from "../../utils/clipboard";
  import { MessageSquare, Heart, Bookmark, MoreHorizontal } from "@lucide/svelte";
  import ShareIcon from "../ShareIcon.svelte";
  import type { Profile } from "@nostr-git/core/events";

  interface Props {
    author: Profile;
    createdAt: string;
    eventLink?: string;
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
    eventLink,
    children,
    actions,
    showQuickActions = true,
    isHighlighted = false,
    onReply,
    onReact,
    onBookmark,
    onShare,
  }: Props = $props();

  const handleCopyLink = async (event: MouseEvent) => {
    event.stopPropagation();
    if (onShare) {
      onShare();
      return;
    }
    if (!eventLink) return;
    try {
      await navigator.clipboard.writeText(eventLink);
      const message = getCopySuccessMessage(eventLink, "");
      if (message) toast.push({ message, timeout: 2000 });
    } catch (error) {
      console.error("Failed to copy event link:", error);
    }
  };
</script>

<div
  class={`group relative px-4 py-2.5 hover:bg-muted/30 transition-colors duration-150 ${
    isHighlighted ? "bg-blue-500/10 border-l-2 border-blue-500" : ""
  }`}
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

    <!-- Sharing stays visible even when optional quick actions are disabled. -->
    {#if eventLink || onShare || showQuickActions}
      <div
        class="flex shrink-0 flex-wrap self-start items-center gap-1 bg-popover border border-border rounded-lg px-1 py-1"
      >
        {#if eventLink || onShare}
          <button
            type="button"
            onclick={handleCopyLink}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Share"
            aria-label="Share"
            data-stop-link
            data-stop-tap
          >
            <ShareIcon class="w-4 h-4 text-muted-foreground" />
          </button>
        {/if}
        {#if showQuickActions && onReact}
          <button
            onclick={onReact}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Add reaction"
            aria-label="Add reaction"
          >
            <Heart class="w-4 h-4 text-muted-foreground hover:text-pink-500" />
          </button>
        {/if}

        {#if showQuickActions && onReply}
          <button
            onclick={onReply}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Reply"
            aria-label="Reply"
          >
            <MessageSquare class="w-4 h-4 text-muted-foreground hover:text-blue-500" />
          </button>
        {/if}

        {#if showQuickActions && onBookmark}
          <button
            onclick={onBookmark}
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="Bookmark"
            aria-label="Bookmark"
          >
            <Bookmark
              class="w-4 h-4 text-muted-foreground hover:text-yellow-600 dark:hover:text-yellow-400"
            />
          </button>
        {/if}

        {#if showQuickActions}
          <button
            class="p-1.5 hover:bg-muted rounded transition-colors"
            title="More options"
            aria-label="More options"
          >
            <MoreHorizontal class="w-4 h-4 text-muted-foreground" />
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
