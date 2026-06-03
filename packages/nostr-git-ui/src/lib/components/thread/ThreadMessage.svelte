<script lang="ts">
  import { useRegistry } from "../../useRegistry";
  const { Avatar, AvatarFallback, AvatarImage } = useRegistry();
  import TimeAgo from "../../TimeAgo.svelte";
  import RichText from "../RichText.svelte";

  const {
    content,
    author,
    createdAt,
  }: {
    content: string;
    author: { name: string; avatar: string };
    createdAt: string;
  } = $props();
</script>

<div class="flex gap-3 group py-2">
  <Avatar class="h-8 w-8 mt-0.5">
    <AvatarImage src={author.avatar} alt={author.name} />
    <AvatarFallback>{author.name.substring(0, 2).toUpperCase()}</AvatarFallback>
  </Avatar>
  <div class="flex-1">
    <div class="flex items-center gap-2">
      <span class="font-semibold text-sm">{author.name}</span>
      <span class="text-xs text-muted-foreground"><TimeAgo date={createdAt} /></span>
    </div>
    <div class="text-sm mt-1 text-muted-foreground">
      <RichText content={content} prose={false} />
    </div>
  </div>
</div>
