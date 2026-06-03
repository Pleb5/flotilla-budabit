<script lang="ts">
  import { PlayCircle, Users } from "@lucide/svelte";
  import TimeAgo from "../../TimeAgo.svelte";
  import { Link } from "svelte-routing";
  import { useRegistry } from "../../useRegistry";
  const { Avatar, AvatarFallback, AvatarImage, Button } = useRegistry();

  const {
    id,
    repoId,
    title,
    host,
    language,
    participantCount,
    startedAt,
    isActive,
  }: {
    id: string;
    repoId: string;
    title: string;
    host: { name: string; avatar: string };
    language: string;
    participantCount: number;
    startedAt: string;
    isActive: boolean;
  } = $props();
</script>

<div class="bg-card text-card-foreground rounded-lg border shadow-sm p-4">
  <div class="flex items-start gap-3">
    <div class="relative">
      <PlayCircle class="h-5 w-5 {isActive ? 'text-green-500' : 'text-muted-foreground'}" />
      {#if isActive}
        <span
          class="absolute -top-1 -right-1 h-3 w-3 bg-green-500 rounded-full animate-pulse border border-background"
        ></span>
      {/if}
    </div>
    <div class="flex-1">
      <Link to={`/git/repo/${repoId}/live/${id}`}>
        <h3
          class="text-base font-semibold mb-0.5 leading-tight hover:text-foreground transition-colors"
        >
          {title}
        </h3>
      </Link>
      <div class="flex flex-wrap items-center gap-2 text-xs text-muted-foreground mb-1">
        <span class="rounded bg-muted px-2 py-0.5">{language}</span>
        <span>•</span>
        <span>Started <TimeAgo date={startedAt} /> by {host.name}</span>
        <span>•</span>
        <div class="flex items-center gap-1">
          <Users class="h-3 w-3" />
          <span>{participantCount} participant{participantCount !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <div class="flex items-center justify-between mt-3">
        <Link to={`/git/repo/${repoId}/live/${id}`}>
          <Button
            size="sm"
            class="h-8 px-3 py-0 text-xs font-medium rounded-md border bg-background hover:bg-muted transition {isActive
              ? 'bg-git hover:bg-git-hover'
              : ''}"
          >
            {isActive ? "Join session" : "View recording"}
          </Button>
        </Link>
        <Avatar class="size-8 border bg-muted text-muted-foreground ml-2">
          <AvatarImage src={host.avatar} alt={host.name} />
          <AvatarFallback>{host.name.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      </div>
    </div>
  </div>
</div>
