<script lang="ts">
  import { nip19, type NostrEvent } from "nostr-tools";
  import { onMount } from "svelte";
  import { FolderGit2, Copy, Star, GitBranch } from "@lucide/svelte";
  import { parseRepoCommunityBinding } from "@nostr-git/core/events";
  import { useRegistry } from "../../useRegistry";

  const { Card, Button, Avatar, AvatarImage, AvatarFallback, ProfileLink } = useRegistry();

  interface Props {
    event: NostrEvent;
  }

  let { event }: Props = $props();

  // Reactive state using Svelte 5 runes
  let repoName = $state("");
  let repoDescription = $state("");
  let cloneUrl = $state("");
  let authorNpub = $state("");
  let repoId = $state("");
  let webUrl = $state("");

  // Derived computed values
  const displayName = $derived(repoName || "Unnamed Repository");
  const shortDescription = $derived(repoDescription || "No description provided");
  const shortNpub = $derived(authorNpub ? authorNpub.slice(0, 16) + "..." : "");
  const createdDate = $derived(new Date(event.created_at * 1000));
  const community = $derived(parseRepoCommunityBinding(event));
  const communityLabel = $derived(
    community ? `${community.pubkey.slice(0, 8)}...${community.pubkey.slice(-6)}` : ""
  );

  // Parse event tags to extract repository information
  const parseEventData = () => {
    const tags = event.tags || [];

    for (const tag of tags) {
      switch (tag[0]) {
        case "d":
          repoId = tag[1] || "";
          break;
        case "name":
          repoName = tag[1] || "";
          break;
        case "description":
          repoDescription = tag[1] || "";
          break;
        case "clone":
          cloneUrl = tag[1] || "";
          break;
        case "web":
          webUrl = tag[1] || "";
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
    <FolderGit2 class="h-6 w-6 mt-1 text-blue-600" />

    <div class="flex-1">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <a href={webUrl || `#repo/${repoId}`} class="block">
            <h3
              class="text-base font-semibold mb-0.5 leading-tight hover:text-foreground transition-colors"
            >
              {displayName}
            </h3>
          </a>
        </div>

        <div class="flex items-center gap-2">
          <Button variant="ghost" size="icon" class="h-8 w-8 p-0">
            <Star class="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" class="h-8 w-8 p-0">
            <GitBranch class="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>By <ProfileLink pubkey={event.pubkey} /></span>
        {#if community}
          <span>•</span>
          <span class="rounded-full border px-1.5 py-0.5 text-[11px]">Community {communityLabel}</span>
        {/if}
        <span>•</span>
        <span>{createdDate.toLocaleDateString()}</span>
      </div>

      <p class="text-sm text-muted-foreground mb-3 line-clamp-2">
        {shortDescription}
      </p>

      <div class="flex items-center justify-between">
        <div class="flex gap-2">
          <Button variant="outline" size="sm" class="h-8 px-3 py-0 text-xs">Browse</Button>
          <Button variant="outline" size="sm" class="h-8 px-3 py-0 text-xs">Issues</Button>
        </div>

        {#if cloneUrl}
          <Button
            variant="ghost"
            size="sm"
            class="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
            onclick={() => copyToClipboard(cloneUrl)}
            title="Copy clone URL"
          >
            <Copy class="h-3 w-3 mr-1" />
            Clone
          </Button>
        {/if}
      </div>
    </div>

    <Avatar class="size-8 border bg-muted text-muted-foreground">
      <AvatarImage
        src={`https://ui-avatars.com/api/?name=${encodeURIComponent(shortNpub)}&background=random`}
        alt={shortNpub}
      />
      <AvatarFallback>{shortNpub.slice(0, 2).toUpperCase()}</AvatarFallback>
    </Avatar>
  </div>
</Card>
