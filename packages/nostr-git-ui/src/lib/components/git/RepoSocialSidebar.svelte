<script lang="ts">
  import { Star, Eye, Users, MessageSquare } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  const { Avatar, AvatarFallback, AvatarImage, Button, Card, Separator } = useRegistry();

  // Accept props for sidebar data
  const props = $props();
  const watchers: number = props.watchers ?? 0;
  import type { Profile } from "@nostr-git/core/events";
  const contributors: Profile[] = props.contributors ?? [];
</script>

<Card class="space-y-4">
  <div class="p-4 space-y-4">
    <!-- stars & watchers -->
    <div class="flex justify-between">
      <div class="flex items-center gap-2">
        <Star class="h-4 w-4 text-yellow-500" />
      </div>
      <div class="flex items-center gap-2">
        <Eye class="h-4 w-4 text-purple-500" />
        <span class="font-medium">{watchers} watching</span>
      </div>

      <Separator />

      <!-- contributors -->
      <div>
        <h4 class="text-sm font-medium mb-2 flex items-center gap-2">
          <Users class="h-4 w-4" /> Top Contributors
        </h4>
        <div class="flex -space-x-2">
          {#each contributors.slice(0, 5) as c (c.name)}
            <Avatar class="h-8 w-8 border-2 border-background">
              <AvatarImage src={c?.picture ?? ""} alt={c?.name ?? c?.display_name ?? ""} />
              <AvatarFallback
                >{(c?.name ?? c?.display_name ?? "").slice(0, 2).toUpperCase()}</AvatarFallback
              >
            </Avatar>
          {/each}
          {#if contributors.length > 5}
            <Button variant="outline" size="sm" class="ml-2 h-8"
              >+{contributors.length - 5} more</Button
            >
          {/if}
        </div>
      </div>

      <Separator />

      <!-- discussions -->
      <div>
        <h4 class="text-sm font-medium mb-2 flex items-center gap-2">
          <MessageSquare class="h-4 w-4" /> Active Discussions
        </h4>

        <div class="space-y-2 text-sm">
          <div>
            <p class="cursor-pointer font-medium hover:text-foreground">
              Authentication flow improvements
            </p>
            <p class="text-xs text-muted-foreground">12 participants • Updated 2 h ago</p>
          </div>
          <div>
            <p class="cursor-pointer font-medium hover:text-foreground">
              New feature proposal: Dark mode
            </p>
            <p class="text-xs text-muted-foreground">8 participants • Updated 5 h ago</p>
          </div>
        </div>
      </div>
    </div>
  </div></Card
>
