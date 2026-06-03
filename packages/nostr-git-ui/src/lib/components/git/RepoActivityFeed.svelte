<script lang="ts">
  import { Activity } from "@lucide/svelte";
  import { formatDistanceToNow } from "date-fns";

  import { useRegistry } from "../../useRegistry";
  const { Avatar, Button, Card, AvatarImage, AvatarFallback } = useRegistry();

  import type { Profile } from "@nostr-git/core/events";
  interface ActivityItem {
    id: string;
    type: "commit" | "discussion" | "star";
    title: string;
    user: Profile;
    timestamp: Date;
  }

  const {
    activities = [],
  }: {
    activities?: ActivityItem[];
  } = $props();

</script>

<div class="space-y-6">
  <!-- header -->
  <div class="flex items-center justify-between">
    <h3 class="text-lg font-semibold">Recent Activity</h3>
    <Button variant="ghost" size="sm" class="gap-2">
      <Activity class="h-4 w-4" /> View all
    </Button>
  </div>

  <!-- feed -->
  <div class="space-y-4">
    {#each activities as a (a.id)}
      <Card>
        <div class="p-4 flex items-start gap-3">
          <Avatar class="h-8 w-8">
            <AvatarImage
              src={a.user?.picture ?? ""}
              alt={a.user?.name ?? a.user?.display_name ?? ""}
            />
            <AvatarFallback
              >{(a.user?.name ?? a.user?.display_name ?? "")
                .slice(0, 2)
                .toUpperCase()}</AvatarFallback
            >
          </Avatar>

          <div class="flex-1 space-y-1">
            <p class="text-sm">
              <button class="font-medium" onclick={() => console.log("User name clicked")}
                >{a.user?.name ?? a.user?.display_name ?? ""}</button
              >&nbsp;{a.title}
            </p>
            <p class="text-xs text-muted-foreground">
              {formatDistanceToNow(a.timestamp, { addSuffix: true })}
            </p>
          </div>
        </div>
      </Card>
    {/each}
  </div>
</div>
