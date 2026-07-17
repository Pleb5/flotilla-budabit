<script lang="ts">
  import { formatDistanceToNow } from "date-fns";
  import { Copy, Check } from "@lucide/svelte";
  import NostrAvatar from "./NostrAvatar.svelte";

  // Real git commit data structure
  interface GitCommitData {
    oid: string;
    commit: {
      message: string;
      author: {
        name: string;
        email: string;
        timestamp?: number;
      };
      committer: {
        name: string;
        email: string;
        timestamp?: number;
      };
      parent: string[];
    };
  }

  interface CommitCardProps {
    commit: GitCommitData;
    href?: string; // Optional direct href for navigation
    getParentHref?: (commitId: string) => string; // Function to generate parent commit href
    disablePrefetch?: boolean; // Disable SvelteKit link prefetching
    // Optional avatar and display name supplied by app layer
    avatarUrl?: string;
    displayName?: string;
    pubkey?: string; // Optional Nostr pubkey for ProfileComponent avatar
    nip05?: string;
    nip39?: string;
  }

  let {
    commit,
    href,
    getParentHref,
    disablePrefetch = false,
    avatarUrl,
    displayName,
    pubkey,
    nip05,
    nip39,
  }: CommitCardProps = $props();

  let copied = $state(false);

  function truncateHash(hash: string): string {
    return hash.substring(0, 7);
  }

  function getCommitSubject(message: string): string {
    return message.split(/\r?\n/, 1)[0]?.trim() || message;
  }

  function getCommitTimestamp(commit: GitCommitData): number | undefined {
    const timestamp = [commit.commit.author?.timestamp, commit.commit.committer?.timestamp].find(
      (value) => typeof value === "number" && Number.isFinite(value)
    );
    return timestamp;
  }

  function formatDate(timestamp: number | undefined): string {
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) return "Unknown";
    const date = new Date(timestamp * 1000);
    if (Number.isNaN(date.getTime())) return "Unknown";
    return formatDistanceToNow(date, { addSuffix: true });
  }

  function getAuthorName(commit: GitCommitData): string {
    return commit.commit.author?.name || commit.commit.committer?.name || "Unknown";
  }

  function getAuthorEmail(commit: GitCommitData): string {
    return commit.commit.author?.email || commit.commit.committer?.email || "";
  }

  function copyHash() {
    navigator.clipboard.writeText(commit.oid);
    copied = true;
    setTimeout(() => (copied = false), 2000);
  }
</script>

<article
  class="min-w-0 bg-card px-3 py-2.5 transition-colors hover:bg-muted/20 sm:px-4"
  role="listitem"
>
  <div class="flex min-w-0 items-start gap-2.5">
    <NostrAvatar
      pubkey={pubkey}
      avatarUrl={avatarUrl}
      nip05={nip05}
      nip39={nip39}
      email={getAuthorEmail(commit)}
      displayName={displayName || getAuthorName(commit)}
      size={24}
      class="h-6 w-6 shrink-0"
      title={displayName || getAuthorName(commit)}
    />

    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 items-start gap-2">
        <div class="min-w-0 flex-1">
          {#if href}
            <a
              href={href}
              class="block truncate text-sm font-semibold leading-5 text-foreground hover:underline"
              data-sveltekit-preload-data={disablePrefetch ? "off" : undefined}
              title={commit.commit.message}
            >
              {getCommitSubject(commit.commit.message)}
            </a>
          {:else}
            <div class="truncate text-sm font-semibold leading-5" title={commit.commit.message}>
              {getCommitSubject(commit.commit.message)}
            </div>
          {/if}
        </div>

        <div class="flex shrink-0 items-center gap-1">
          {#if commit.commit.parent.length > 0}
            {#if getParentHref}
              <a
                href={getParentHref(commit.commit.parent[0])}
                class="whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                data-sveltekit-preload-data={disablePrefetch ? "off" : undefined}
                title={`View first parent ${commit.commit.parent[0]}`}
              >
                <span class="hidden sm:inline">Parent </span>{truncateHash(commit.commit.parent[0])}
              </a>
            {:else}
              <span
                class="whitespace-nowrap px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground"
                title={commit.commit.parent[0]}
              >
                <span class="hidden sm:inline">Parent </span>{truncateHash(commit.commit.parent[0])}
              </span>
            {/if}
          {/if}

          <button
            type="button"
            onclick={copyHash}
            class="flex items-center gap-1 whitespace-nowrap rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
            aria-label={copied ? "Commit hash copied" : "Copy commit hash"}
            title={commit.oid}
          >
            {truncateHash(commit.oid)}
            {#if copied}
              <Check class="h-3 w-3 text-green-500" />
            {:else}
              <Copy class="h-3 w-3" />
            {/if}
          </button>
        </div>
      </div>

      <div
        class="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-xs leading-4 text-muted-foreground"
      >
        <span class="max-w-full truncate font-medium text-foreground/80">
          {displayName || getAuthorName(commit)}
        </span>
        {#if getAuthorEmail(commit)}
          <span aria-hidden="true">&middot;</span>
          <span class="min-w-0 max-w-full truncate" title={getAuthorEmail(commit)}>
            {getAuthorEmail(commit)}
          </span>
        {/if}
        <span aria-hidden="true">&middot;</span>
        <span class="whitespace-nowrap">{formatDate(getCommitTimestamp(commit))}</span>
      </div>
    </div>
  </div>
</article>
