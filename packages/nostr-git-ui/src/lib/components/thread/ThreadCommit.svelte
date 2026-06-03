<script lang="ts">
  import { useRegistry } from "../../useRegistry";
  const { Avatar, AvatarFallback, AvatarImage } = useRegistry();
  import { GitCommit } from "@lucide/svelte";
  import TimeAgo from "../../TimeAgo.svelte";
  import type { Profile } from "@nostr-git/core/events";
  const {
    content,
    author,
    createdAt,
    metadata,
  }: {
    content: string;
    author: Profile;
    createdAt: string;
    metadata: { hash: string };
  } = $props();
</script>

<div class="flex gap-3 group py-2">
  <Avatar class="h-8 w-8 mt-0.5">
    <AvatarImage
      src={author?.picture ?? ""}
      alt={author?.name ?? author?.display_name ?? ""}
    />
    <AvatarFallback
      >{(author?.name ?? author?.display_name ?? "").substring(0, 2).toUpperCase()}</AvatarFallback
    >
  </Avatar>
  <div class="flex-1">
    <div class="flex items-center gap-2">
      <span class="font-semibold text-sm">{author.name}</span>
      <span class="text-xs text-muted-foreground"><TimeAgo date={createdAt} /></span>
    </div>
    <div class="flex items-center gap-1 mt-1 bg-secondary/50 rounded-md px-3 py-2">
      <GitCommit class="h-4 w-4 text-muted-foreground" />
      <span class="text-sm font-mono">{metadata.hash}</span>
      <span class="mx-1 text-muted-foreground">•</span>
      <span class="text-sm">{content}</span>
    </div>
  </div>
</div>
