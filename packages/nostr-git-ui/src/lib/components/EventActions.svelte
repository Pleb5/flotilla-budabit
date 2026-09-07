<script lang="ts">
  import type { Snippet } from "svelte";
  import { Reply, MoreHorizontal, Pencil } from "@lucide/svelte";
  import ShareIcon from "./ShareIcon.svelte";

  type Props = {
    event: unknown;
    url: string;
    noun: string;
    customActions?: Snippet;
    onShare?: () => void | Promise<void>;
    reply?: () => void;
    edit?: () => void;
    infoLabel?: string;
    relays?: string[];
    repoAddress?: string;
    strictZapRelays?: boolean;
    ownerPubkey?: string;
    showReport?: boolean;
    showModeration?: boolean;
    readOnly?: boolean;
    menuOnly?: boolean;
    class?: string;
  };

  const {
    customActions,
    onShare,
    reply,
    edit,
    noun,
    readOnly = false,
    menuOnly = false,
  }: Props = $props();
  const actionButtonClass =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground";
  let menuOpen = $state(false);
</script>

<div class="flex items-center gap-2">
  {#if reply && !readOnly}
    <button
      type="button"
      class={actionButtonClass}
      onclick={reply}
      aria-label={`Reply to ${noun}`}
      title="Reply"
    >
      <Reply class="h-4 w-4" />
    </button>
  {/if}
  {#if onShare}
    <button
      type="button"
      class={actionButtonClass}
      onclick={(event) => {
        event.stopPropagation();
        void onShare();
      }}
      aria-label={`Share ${noun}`}
      title={`Share ${noun}`}
      data-stop-link
      data-stop-tap
    >
      <ShareIcon />
    </button>
  {/if}
  {#if menuOnly && (customActions || (!readOnly && (reply || edit)))}
    <details class="relative" bind:open={menuOpen}>
      <summary
        class={`${actionButtonClass} list-none cursor-pointer`}
        aria-label={`Open ${noun} actions`}
      >
        <MoreHorizontal class="h-4 w-4" />
      </summary>
      <ul class="absolute right-0 z-10 min-w-40 rounded border bg-background p-2 shadow-md">
        {#if reply && !readOnly}
          <li>
            <button
              type="button"
              onclick={() => {
                menuOpen = false;
                reply();
              }}>Send Reply</button
            >
          </li>
        {/if}
        {@render customActions?.()}
        {#if edit && !readOnly}
          <li>
            <button
              type="button"
              class="flex items-center gap-2"
              onclick={() => {
                menuOpen = false;
                edit();
              }}
            >
              <Pencil class="h-4 w-4" /> Edit {noun}
            </button>
          </li>
        {/if}
      </ul>
    </details>
  {:else}
    {@render customActions?.()}
  {/if}
</div>
