<script lang="ts">
  import TimeAgo from "../../TimeAgo.svelte";
  import { GitBranch, Star, BookOpen, Circle } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  const { Avatar, Button, AvatarImage, AvatarFallback, Markdown } = useRegistry();
  import type { Profile } from "@nostr-git/core/events";
  import type { Repo } from "./Repo.svelte";
  // Accept event and optional owner (Profile)
  const {
    repo,
    owner = {
      pubkey: "",
    },
    issueCount = 0,
    lastUpdated = undefined,
  }: {
    repo: Repo;
    owner?: Profile;
    issueCount?: number;
    lastUpdated?: string;
  } = $props();
  // Prefer owner for avatar/name if provided
  const repoOwner: Profile = { ...owner };
  const id = repo.key;
  const name = repo.name ?? "";
  const description = repo.description ?? "";
  // Use event createdAt if lastUpdated not provided
  const updated = lastUpdated ?? repo.createdAt;

  const getLinkRanges = (text: string) => {
    const ranges: Array<{ start: number; end: number }> = [];
    const patterns = [
      /\[[^\]]+\]\([^)]+\)/g,
      /<https?:\/\/[^>\s]+>/g,
      /(?:https?:\/\/|www\.)[^\s<>()]+/g,
    ];

    for (const pattern of patterns) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(text))) {
        ranges.push({ start: match.index, end: match.index + match[0].length });
      }
    }

    if (ranges.length < 2) return ranges;

    ranges.sort((a, b) => a.start - b.start);
    const merged: Array<{ start: number; end: number }> = [ranges[0]];

    for (const range of ranges.slice(1)) {
      const last = merged[merged.length - 1];
      if (range.start <= last.end) {
        last.end = Math.max(last.end, range.end);
      } else {
        merged.push({ ...range });
      }
    }

    return merged;
  };

  const truncateDescription = (text: string, max = 300) => {
    if (!text) return "";
    if (text.length <= max) return text;

    const ranges = getLinkRanges(text);
    let cut = max;
    const crossing = ranges.find((range) => range.start < cut && range.end > cut);
    if (crossing) {
      cut = crossing.start;
    }

    const truncated = text.slice(0, cut).trimEnd();
    return truncated ? `${truncated}...` : "...";
  };

  const descriptionPreview = $derived.by(() => truncateDescription(description, 300));
</script>

<div class="bg-card text-card-foreground rounded-lg border shadow-sm p-4">
  <div class="flex items-start gap-3">
    <Avatar class="size-8 border bg-muted text-muted-foreground">
      <AvatarImage
        src={repoOwner.picture ||
          `https://ui-avatars.com/api/?name=${encodeURIComponent(repoOwner.display_name || repoOwner.name || "Unknown")}&background=random`}
        alt={repoOwner.display_name || repoOwner.name || "Unknown"}
      />
      <AvatarFallback
        >{(repoOwner.display_name || repoOwner.name || "U")
          .slice(0, 2)
          .toUpperCase()}</AvatarFallback
      >
    </Avatar>
    <div class="flex-1">
      <div class="flex items-center gap-1 mb-1">
        <Circle class="h-3 w-3 text-amber-500" />
        <span class="text-xs text-muted-foreground"
          >{repoOwner.display_name || repoOwner.name || "Unknown"}</span
        >
        <span class="text-xs text-muted-foreground"><TimeAgo date={updated} /></span>
      </div>
      <a href={`/git/repo/${id}`} class="block">
        <h3
          class="text-base font-semibold mb-0.5 leading-tight hover:text-foreground transition-colors"
        >
          {name}
        </h3>
      </a>
      {#if Markdown}
        <div class="text-muted-foreground mb-2">
          <Markdown
            content={descriptionPreview}
            event={repo.repoEvent as any}
            relays={repo.relays}
            variant="comment"
          />
        </div>
      {:else}
        <p class="text-xs text-muted-foreground mb-2">{descriptionPreview}</p>
      {/if}
      <div class="flex flex-wrap gap-2">
        <Button
          href={`/git/repo/${id}/browse`}
          variant="outline"
          size="sm"
          class="h-8 px-3 py-0 text-xs font-medium rounded-md border bg-background hover:bg-muted transition"
        >
          <BookOpen class="h-4 w-4" /> Browse
        </Button>
        <Button
          href={`/git/repo/${id}/issues`}
          variant="outline"
          size="sm"
          class="h-8 px-3 py-0 text-xs font-medium rounded-md border bg-background hover:bg-muted transition text-git-issue"
        >
          Issues ({issueCount})
        </Button>
      </div>
    </div>
    <div class="flex flex-col gap-2 items-end ml-2">
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 p-0"
        onclick={() => console.log("Star button clicked")}><Star class="h-5 w-5" /></Button
      >
      <Button
        variant="ghost"
        size="icon"
        class="h-8 w-8 p-0"
        onclick={() => console.log("GitBranch button clicked")}
        ><GitBranch class="h-5 w-5" /></Button
      >
    </div>
  </div>
  <div class="border-t border-border mt-3 mb-2"></div>
  <div class="flex justify-between items-end gap-2 py-2">
    <div class="text-xs text-muted-foreground">
      <p class="font-semibold">{name}</p>
      {#if Markdown}
        <Markdown
          content={descriptionPreview}
          event={repo.repoEvent as any}
          relays={repo.relays}
          variant="comment"
        />
      {:else}
        <p>{descriptionPreview}</p>
      {/if}
    </div>
    <div class="flex flex-col items-end gap-1">
      <button
        class="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
        onclick={() => console.log("View on Web button clicked")}>View on Web</button
      >
      <div class="flex gap-4">
        <div class="flex flex-col items-start">
          <span class="text-xs font-medium">Recent Issues</span>
          <button
            class="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            onclick={() => console.log("View Wiki button clicked")}>View Wiki</button
          >
        </div>
        <div class="flex flex-col items-end">
          <span class="text-xs font-medium">Recent PRs</span>
          <button
            class="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            onclick={() => console.log("Join Live Coding Session button clicked")}
            >Join Live Coding Session</button
          >
        </div>
      </div>
    </div>
  </div>
</div>
