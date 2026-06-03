<script lang="ts">
  import { Copy, Calendar, GitCommit } from "@lucide/svelte";
  import { toast } from "../../stores/toast";
  import NostrAvatar from "./NostrAvatar.svelte";

  interface Props {
    sha: string;
    author: string;
    email: string;
    date: number;
    message: string;
    parents: string[];
    // Optional: resolved avatar URL and display name from app-level Profile
    avatarUrl?: string;
    displayName?: string;
    // Optional Nostr enrichments
    pubkey?: string;
    nip05?: string;
    nip39?: string;
    // Optional: function to generate parent commit href for navigation
    getParentHref?: (commitId: string) => string;
  }

  let {
    sha,
    author,
    email,
    date,
    message,
    parents,
    avatarUrl,
    displayName,
    pubkey,
    nip05,
    nip39,
    getParentHref,
  }: Props = $props();

  // Format date for display
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDays === 0) {
      return "today";
    } else if (diffDays === 1) {
      return "yesterday";
    } else if (diffDays < 7) {
      return `${diffDays} days ago`;
    } else {
      return date.toLocaleDateString();
    }
  };

  const formatExactDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleString();
  };

  // Copy SHA to clipboard
  const copySha = async () => {
    try {
      await navigator.clipboard.writeText(sha);
      toast.push({ message: "Commit SHA copied to clipboard" });
    } catch (err) {
      console.error("Failed to copy SHA:", err);
      toast.push({ message: "Failed to copy SHA", theme: "error" });
    }
  };

  // Extract commit title and body
  const commitLines = message.split("\n");
  const commitTitle = commitLines[0] || "";
  const commitBody = commitLines.slice(1).join("\n").trim();
</script>

<div class="sticky z-10 border-b border-border bg-card" style="top: var(--repo-tabs-height, 0px);">
  <div class="px-6 py-4">
    <!-- Commit Title -->
    <div class="mb-4">
      <h1 class="text-xl font-semibold text-foreground break-words">
        {commitTitle}
      </h1>
      {#if commitBody}
        <div class="mt-2 text-sm text-muted-foreground whitespace-pre-wrap break-words">
          {commitBody}
        </div>
      {/if}
    </div>

    <!-- Commit Metadata -->
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        <!-- Author Info -->
        <div class="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
          <NostrAvatar
            pubkey={pubkey}
            avatarUrl={avatarUrl}
            nip05={nip05}
            nip39={nip39}
            email={email}
            displayName={displayName || author}
            size={24}
            class="h-6 w-6 flex-shrink-0"
            title={displayName || author}
          />
          <span class="font-medium text-foreground truncate" title={displayName || author}
            >{displayName || author}</span
          >
          {#if email}
            <span class="text-muted-foreground truncate" title={email}>({email})</span>
          {/if}
        </div>

        <!-- Date Info -->
        <div class="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar class="h-4 w-4" />
          <span title={formatExactDate(date)}>
            committed {formatDate(date)}
          </span>
        </div>

        <!-- Parent Commits -->
        {#if parents.length > 0}
          <div class="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <GitCommit class="h-4 w-4 flex-shrink-0" />
            <span class="truncate">
              {parents.length === 1 ? "parent" : "parents"}:
              {#each parents as parent, i}
                {#if getParentHref}
                  <a
                    href={getParentHref(parent)}
                    class="mx-1 rounded bg-muted px-1 py-0.5 text-xs font-mono hover:bg-muted/80 hover:text-foreground transition-colors"
                    title={parent}
                  >
                    {parent.slice(0, 7)}
                  </a>
                {:else}
                  <code class="mx-1 rounded bg-muted px-1 py-0.5 text-xs font-mono" title={parent}>
                    {parent.slice(0, 7)}
                  </code>
                {/if}
                {#if i < parents.length - 1},{/if}
              {/each}
            </span>
          </div>
        {/if}
      </div>

      <!-- SHA and Copy Button -->
      <div class="flex items-center gap-2">
        <code class="rounded bg-muted px-2 py-1 text-sm font-mono text-foreground">
          {sha.slice(0, 7)}
        </code>
        <button
          onclick={copySha}
          class="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
          title="Copy full SHA"
        >
          <Copy class="h-3 w-3" />
          Copy
        </button>
      </div>
    </div>
  </div>
</div>

<style>
  /* Ensure long commit messages don't break layout */
  .break-words {
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
</style>
