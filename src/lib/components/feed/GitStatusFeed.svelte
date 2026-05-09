<script lang="ts">
  import {
    GitMerge,
    GitPullRequest,
    X,
    CheckCircle2,
    Clock,
    CircleDot
  } from "@lucide/svelte";
  import FeedItem from "./FeedItem.svelte";
  import type { Profile, StatusEvent } from "@nostr-git/core/events";

  interface Props {
    event: StatusEvent;
    author?: Profile;
    onReply?: () => void;
    onReact?: () => void;
    onBookmark?: () => void;
  }

  const { event, author, onReply, onReact, onBookmark }: Props = $props();

  // Parse status data
  let statusType = $state("");
  let targetTitle = $state("");
  let targetType = $state(""); // issue, pull request, etc.
  let targetEventId = $state("");
  let targetAddress = $state("");
  
  const createdDate = $derived(new Date(event.created_at * 1000).toISOString());
  
  // Determine if we have a target to show
  const hasTarget = $derived(targetTitle && targetType);
  
  // Status configuration based on event kind
  const statusConfig = $derived.by(() => {
    const kind = event.kind;
    
    // kind 1630 = open
    // kind 1631 = merged/resolved
    // kind 1632 = closed
    // kind 1633 = draft
    
    switch (kind) {
      case 1630:
        return {
          action: "opened",
          icon: GitPullRequest,
          color: "text-green-400",
          bgColor: "bg-green-500/10",
          borderColor: "border-green-500/30",
          message: "opened this"
        };
      case 1631:
        return {
          action: "merged",
          icon: GitMerge,
          color: "text-purple-400",
          bgColor: "bg-purple-500/10",
          borderColor: "border-purple-500/30",
          message: "merged this"
        };
      case 1632:
        return {
          action: "closed",
          icon: X,
          color: "text-red-400",
          bgColor: "bg-red-500/10",
          borderColor: "border-red-500/30",
          message: "closed this"
        };
      case 1633:
        return {
          action: "drafted",
          icon: Clock,
          color: "text-gray-400",
          bgColor: "bg-gray-500/10",
          borderColor: "border-gray-500/30",
          message: "marked this as draft"
        };
      default:
        return {
          action: "updated",
          icon: CheckCircle2,
          color: "text-blue-400",
          bgColor: "bg-blue-500/10",
          borderColor: "border-blue-500/30",
          message: "updated this"
        };
    }
  });

  // Parse event tags
  $effect(() => {
    const tags = (event.tags || []) as unknown as string[][];
    
    for (const tag of tags) {
      switch (tag[0] as string) {
        case "title":
          targetTitle = tag[1] || "";
          break;
        case "e":
          // Referenced event
          targetEventId = tag[1] || "";
          break;
        case "a":
          // Referenced address
          targetAddress = tag[1] || "";
          const parts = tag[1]?.split(':');
          if (parts && parts[0]) {
            const kind = parseInt(parts[0]);
            if (kind === 1621) targetType = "issue";
            else if (kind === 1618) targetType = "pull request";
          }
          break;
      }
    }
  });
</script>

<FeedItem
  author={author || { name: "Unknown", picture: "", pubkey: "" }}
  createdAt={createdDate}
  eventId={event.id}
  showQuickActions={false}
>
  <!-- Status Update - Timeline Style with Connected Card -->
  {#key statusConfig.icon}
    {@const Icon = statusConfig.icon}
    <div class="flex items-start gap-3">
      <!-- Timeline Line -->
      <div class="flex flex-col items-center">
        <div class="p-1.5 rounded-full {statusConfig.bgColor} border {statusConfig.borderColor}">
          <Icon class="w-3.5 h-3.5 {statusConfig.color}" />
        </div>
        {#if hasTarget}
          <div class="w-0.5 flex-1 bg-gray-700 mt-2 mb-1" style="min-height: 20px;"></div>
        {/if}
      </div>
      
      <!-- Content -->
      <div class="flex-1 pb-2">
        <!-- Status Message -->
        <div class="text-sm mb-2">
          <span class="text-gray-400">{statusConfig.message}</span>
        </div>
        
        <!-- Connected Target Card -->
        {#if hasTarget}
          <div class="border border-gray-700 rounded-lg p-3 bg-gray-900/30 hover:border-gray-600 transition-colors cursor-pointer">
            <div class="flex items-start gap-2">
              <!-- Target Type Icon -->
              <div class="flex-shrink-0 mt-0.5">
                {#if targetType === "issue"}
                  <CircleDot class="w-4 h-4 text-green-400" />
                {:else if targetType === "pull request"}
                  <GitPullRequest class="w-4 h-4 text-purple-400" />
                {/if}
              </div>
              
              <!-- Target Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-gray-400 uppercase">{targetType}</span>
                </div>
                <div class="text-sm text-gray-200 font-medium mt-0.5 truncate">
                  {targetTitle}
                </div>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {/key}
</FeedItem>
