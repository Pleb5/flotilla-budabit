<!--
  GitIssueComponent.svelte
  Compact feed-style component for Git Issue events (kind 1621)
-->
<script lang="ts">
  import { nip19, type NostrEvent } from "nostr-tools";
  import { onMount } from "svelte";
  import {
    CircleDot,
    Copy,
    ChevronDown,
    ChevronUp,
    BookmarkPlus,
    BookmarkCheck,
  } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";

  const { Card, Button, ProfileLink, Badge } = useRegistry();

  interface Props {
    event: NostrEvent;
    relay?: string;
  }

  let { event, relay }: Props = $props();

  // Reactive state using Svelte 5 runes
  let issueTitle = $state("");
  let issueSubject = $state("");
  let authorNpub = $state("");
  let repoAddress = $state("");
  let labels = $state<string[]>([]);
  let assignees = $state<string[]>([]);
  let status = $state("open");
  let isExpanded = $state(false);
  let isBookmarked = $state(false);

  // Derived computed values
  const displayTitle = $derived(issueTitle || issueSubject || "Untitled Issue");
  const issueContent = $derived(event.content || "");
  const createdDate = $derived(new Date(event.created_at * 1000));

  const shortenMiddle = (value: string, start = 10, end = 6) => {
    if (!value) return "";
    if (value.length <= start + end + 3) return value;
    return `${value.slice(0, start)}...${value.slice(-end)}`;
  };

  const parseRepoAddress = (address: string) => {
    const parts = address.split(":");
    if (parts.length < 3) return null;
    const [kindStr, pubkey, ...identifierParts] = parts;
    const kind = Number.parseInt(kindStr, 10);
    const identifier = identifierParts.join(":");
    if (!kind || !pubkey || !identifier) return null;
    return { kind, pubkey, identifier };
  };

  const deriveCommunityFromLocation = () => {
    if (typeof window === "undefined") return "";
    const match = window.location.pathname.match(/\/c\/([^/]+)/);
    if (!match) return "";
    return match[1];
  };

  const basePathFromLocation = () => {
    if (typeof window === "undefined") return "";
    const match = window.location.pathname.match(/(\/c\/[^/]+\/git\/[^/]+)/);
    return match ? match[1] : "";
  };

  const repoRelayHints = $derived.by(() =>
    relay?.match(/^wss?:\/\//) ? [relay] : []
  );

  const repoNaddr = $derived.by(() => {
    if (!repoAddress) return "";
    const parsed = parseRepoAddress(repoAddress);
    if (!parsed) return "";
    try {
      return nip19.naddrEncode({
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.identifier,
        relays: repoRelayHints,
      });
    } catch {
      return "";
    }
  });

  const basePath = $derived.by(() => {
    const communityValue = deriveCommunityFromLocation();
    if (repoNaddr && communityValue) {
      return `/c/${communityValue}/git/${repoNaddr}`;
    }
    return basePathFromLocation();
  });

  const issueHref = $derived.by(() => {
    if (basePath) return `${basePath}/issues/${event.id}`;
    return `issues/${event.id}`;
  });

  const repoDisplay = $derived.by(() => {
    if (!repoAddress) return "";
    const parsed = parseRepoAddress(repoAddress);
    if (parsed?.identifier) return parsed.identifier;
    return shortenMiddle(repoAddress);
  });

  // Status color mapping
  const statusInfo = $derived.by(() => {
    switch (status.toLowerCase()) {
      case "open":
        return { icon: CircleDot, color: "text-amber-500" };
      case "closed":
        return { icon: CircleDot, color: "text-red-500" };
      case "draft":
        return { icon: CircleDot, color: "text-gray-500" };
      default:
        return { icon: CircleDot, color: "text-blue-500" };
    }
  });

  // Parse event tags to extract issue information
  const parseEventData = () => {
    const tags = event.tags || [];

    for (const tag of tags) {
      switch (tag[0]) {
        case "title":
          issueTitle = tag[1] || "";
          break;
        case "subject":
          issueSubject = tag[1] || "";
          break;
        case "a":
          repoAddress = tag[1] || "";
          break;
        case "l":
          if (tag[1] && !labels.includes(tag[1])) {
            labels = [...labels, tag[1]];
          }
          break;
        case "p":
          if (tag[1] && !assignees.includes(tag[1])) {
            assignees = [...assignees, tag[1]];
          }
          break;
        case "status":
          status = tag[1] || "open";
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

  const toggleExpand = () => {
    isExpanded = !isExpanded;
  };

  const toggleBookmark = () => {
    isBookmarked = !isBookmarked;
  };

  onMount(() => {
    parseEventData();
  });
</script>

<Card class="git-card hover:bg-muted/20 transition-colors">
  <div class="flex items-start gap-3">
    <statusInfo.icon class={`h-6 w-6 mt-1 ${statusInfo.color}`} />

    <div class="flex-1">
      <div class="flex items-center justify-between">
        <div class="flex-1">
          <a href={issueHref} class="block">
            <h3
              class="text-base font-semibold mb-0.5 leading-tight hover:text-foreground transition-colors"
              title={displayTitle}
            >
              {displayTitle}
            </h3>
          </a>
        </div>

        <div class="flex items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            class={isBookmarked ? "text-primary" : "text-muted-foreground"}
            onclick={toggleBookmark}
          >
            {#if isBookmarked}
              <BookmarkCheck class="h-4 w-4" />
            {:else}
              <BookmarkPlus class="h-4 w-4" />
            {/if}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-expanded={isExpanded}
            class="ml-auto"
            onclick={toggleExpand}
          >
            {#if isExpanded}
              <ChevronUp class="h-5 w-5 text-muted-foreground" />
            {:else}
              <ChevronDown class="h-5 w-5 text-muted-foreground" />
            {/if}
          </Button>
        </div>
      </div>

      <div class="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        <span>Opened by <ProfileLink pubkey={event.pubkey} /></span>
        <span>•</span>
        <span>{createdDate.toLocaleDateString()}</span>
        <span>•</span>
        <span class={`capitalize ${statusInfo.color}`}>{status}</span>
      </div>

      {#if !isExpanded}
        <p class="text-sm text-muted-foreground mb-3 line-clamp-2">
          {issueContent}
        </p>
      {:else}
        <p class="text-sm text-muted-foreground mb-3">
          {issueContent}
        </p>

        {#if repoAddress}
          <div class="flex items-center gap-2 mb-2">
            <span class="text-xs text-muted-foreground">Repository:</span>
            <code class="bg-muted px-2 py-1 rounded text-xs font-mono" title={repoAddress}>
              {repoDisplay || repoAddress}
            </code>
            <Button
              variant="ghost"
              size="sm"
              class="h-6 px-1 text-xs"
              onclick={() => copyToClipboard(repoAddress)}
              title="Copy repository address"
            >
              <Copy class="h-3 w-3" />
            </Button>
          </div>
        {/if}
      {/if}

      {#if labels.length > 0}
        <div class="flex gap-1 flex-wrap mb-2">
          {#each labels.slice(0, isExpanded ? labels.length : 3) as label}
            <Badge variant="secondary" class="text-xs px-2 py-0.5">
              {label}
            </Badge>
          {/each}
          {#if !isExpanded && labels.length > 3}
            <span class="text-xs text-muted-foreground">
              +{labels.length - 3} more
            </span>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</Card>
