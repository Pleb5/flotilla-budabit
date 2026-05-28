<script lang="ts">
  import TimeAgo from "../../TimeAgo.svelte";
  import { CircleDot, ChevronDown, ChevronUp, CircleCheck, FileCode } from "@lucide/svelte";
  import type { CommentEvent, IssueEvent, StatusEvent } from "@nostr-git/core/events";
  import {
    getTagValue,
    GIT_STATUS_CLOSED,
    GIT_STATUS_OPEN,
    GIT_STATUS_APPLIED,
    parseIssueEvent,
    GIT_STATUS_DRAFT,
  } from "@nostr-git/core/events";
  import IssueThread from "./IssueThread.svelte";
  import Status from "./Status.svelte";
  import { useRegistry } from "../../useRegistry";
  import NostrAvatar from "./NostrAvatar.svelte";
  import { fly } from "svelte/transition";
  const { ProfileLink, Card, EventActions, ReactionSummary, Markdown } = useRegistry();
  import BaseItemCard from "../BaseItemCard.svelte";

  interface Props {
    event: IssueEvent;
    comments?: CommentEvent[];
    status?: StatusEvent | undefined;
    currentCommenter: string;
    onCommentCreated?: (comment: CommentEvent) => Promise<void>;
    extraLabels?: string[];
    // Optional for Status.svelte integration
    repo?: any;
    statusEvents?: StatusEvent[];
    actorPubkey?: string;
    // Deprecated: IssueCard now relies on the injected Markdown renderer.
    nip19LinkTemplate?: string;
    assignees?: string[]; // Array of assignee pubkeys
    assigneeCount?: number; // Optional prop for displaying number of assignees
    relays?: string[]; // Relay URLs for EventActions
    onDeleteReaction?: (event: any) => void | Promise<void>;
    onCreateReaction?: (template: { content: string; tags?: string[][] }) => void | Promise<void>;
  }
  // Accept event and optional author (Profile store)
  const {
    event,
    comments,
    status = undefined,
    currentCommenter,
    onCommentCreated,
    extraLabels = [],
    repo,
    statusEvents = [],
    actorPubkey,
    assigneeCount = 0,
    assignees = [],
    relays = [],
    onDeleteReaction,
    onCreateReaction,
  }: Props = $props();

  // Get relay URL from relays prop or repo relays or use a default
  const relayUrl = $derived.by(() => {
    if (relays && relays.length > 0) {
      return relays[0];
    }
    if (repo?.relays && repo.relays.length > 0) {
      return repo.relays[0];
    }
    // Fallback to a default relay if no relays available
    return "wss://relay.sharegap.net/";
  });

  const commentRelays = $derived.by(() => {
    if (relays && relays.length > 0) {
      return relays;
    }
    if (repo?.relays && repo.relays.length > 0) {
      return repo.relays;
    }
    return [];
  });

  const repoAddress = $derived.by(() => getTagValue(event as any, "a") || repo?.address || "");
  const repoOwnerPubkey = $derived.by(() => repo?.repoEvent?.pubkey || repo?.owner || "");

  const parsed = parseIssueEvent(event);

  const { id, subject: title, content: description, labels, createdAt } = parsed;

  // Mirrored issues (from import) have "imported" and "original_date" tags — show original date
  const isMirrored = $derived(
    (event.tags as Array<[string, string]> | undefined)?.some((t) => t[0] === "imported") ?? false
  );
  const originalDateTag = $derived(
    (event.tags as Array<[string, string]> | undefined)?.find((t) => t[0] === "original_date")?.[1]
  );
  const displayDate = $derived.by(() => {
    if (isMirrored && originalDateTag) {
      const sec = parseInt(originalDateTag, 10);
      if (!Number.isNaN(sec)) return new Date(sec * 1000).toISOString();
    }
    return createdAt;
  });

  // Helper functions for label normalization (matching centralized logic)
  function toNaturalLabel(label: string): string {
    if (typeof label !== "string") return "";
    const trimmed = label.trim();
    if (!trimmed) return "";
    const idx = trimmed.lastIndexOf("/");
    if (idx >= 0 && idx < trimmed.length - 1) {
      return trimmed.slice(idx + 1);
    }
    return trimmed.replace(/^#/, "");
  }

  function toNaturalArray(values?: Iterable<string> | null): string[] {
    if (!values) return [];
    const out = new Set<string>();
    for (const val of values) {
      if (typeof val === "string") {
        out.add(toNaturalLabel(val));
      }
    }
    return Array.from(out);
  }

  const displayLabels = $derived.by(() => {
    // First, normalize the extraLabels (which come from the centralized label system)
    const normalizedExtraLabels = toNaturalArray(extraLabels);

    // Also include any labels from the parsed issue event
    const parsedLabels = toNaturalArray(labels);

    // Merge and deduplicate
    const merged = Array.from(new Set([...parsedLabels, ...normalizedExtraLabels]));

    return merged;
  });

  const normalizedAssignees = $derived.by(() => {
    if (!assignees || assignees.length === 0) return [];
    return Array.from(new Set(assignees.filter(Boolean)));
  });

  const assigneeTotal = $derived.by(() => {
    return normalizedAssignees.length > 0 ? normalizedAssignees.length : assigneeCount;
  });

  const assigneePreview = $derived.by(() => normalizedAssignees.slice(0, 3));

  const commentsOnThisIssue = $derived.by(() => {
    const getCommentRootId = (comment: CommentEvent) => {
      const rootTag = (comment.tags || []).find(
        (tag) => tag[0] === "E" || (tag[0] === "e" && tag[3] === "root")
      );

      return (
        rootTag?.[1] || getTagValue(comment as any, "E") || getTagValue(comment as any, "e") || ""
      );
    };

    return comments?.filter((c) => getCommentRootId(c) === id);
  });

  let commentCount = $derived(commentsOnThisIssue?.length ?? 0);

  let isExpanded = $state(false);

  const statusIcon = $derived(getStatusIcon(status?.kind));

  function getStatusIcon(kind: number | undefined) {
    switch (kind) {
      case GIT_STATUS_OPEN:
        return { icon: CircleDot, color: "text-amber-500" };
      case GIT_STATUS_APPLIED:
        return { icon: CircleCheck, color: "text-green-500" };
      case GIT_STATUS_CLOSED:
        return { icon: CircleCheck, color: "text-red-500" };
      case GIT_STATUS_DRAFT:
        return { icon: FileCode, color: "text-muted-foreground" };
      default:
        return { icon: CircleDot, color: "text-amber-500" };
    }
  }

  function toggleExpand() {
    isExpanded = !isExpanded;
  }
</script>

<div in:fly>
  <BaseItemCard clickable={true} href={`issues/${id}`} variant="issue">
    <!-- title -->
    {#snippet slotTitle()}
      {title || "No title"}
    {/snippet}

    <!-- meta row -->
    {#snippet slotMeta()}
      {#if repo && statusEvents}
        <Status
          repo={repo}
          rootId={id}
          rootKind={1621}
          rootAuthor={event.pubkey}
          statusEvents={statusEvents}
          actorPubkey={actorPubkey}
          compact={true}
          isMirrored={isMirrored}
        />
      {:else if statusIcon}
        {@const { icon: IconCmp, color } = statusIcon}
        <IconCmp class={`h-6 w-6 mt-1 ${color}`} />
      {/if}
      <span class="whitespace-nowrap">Opened <TimeAgo date={displayDate} /></span>
      <div class="flex items-center gap-1">
        <span class="whitespace-nowrap">• By </span>
        <NostrAvatar pubkey={event.pubkey} title={title || "Issue author"} />
        <ProfileLink pubkey={event.pubkey} />
      </div>
      {#if isMirrored}
        <span class="whitespace-nowrap">• Imported <TimeAgo date={createdAt} /></span>
      {/if}
      <span class="whitespace-nowrap">• {commentCount} comments</span>
      {#if assigneeTotal > 0}
        <div class="flex items-center gap-1">
          <span class="whitespace-nowrap">• Assignees</span>
          {#if assigneePreview.length > 0}
            <div class="flex items-center -space-x-1">
              {#each assigneePreview as assignee (assignee)}
                <NostrAvatar
                  pubkey={assignee}
                  size={18}
                  class="ring-2 ring-background"
                  title="Assignee"
                />
              {/each}
            </div>
            {#if assigneeTotal > assigneePreview.length}
              <span class="text-xs text-muted-foreground"
                >+{assigneeTotal - assigneePreview.length}</span
              >
            {/if}
          {:else}
            <span class="whitespace-nowrap"
              >{assigneeTotal} assignee{assigneeTotal === 1 ? "" : "s"}</span
            >
          {/if}
        </div>
      {/if}
    {/snippet}

    <!-- body content -->
    <div class="line-clamp-2 prose prose-sm max-w-none">
      {#if Markdown}
        <Markdown
          content={description || ""}
          event={event as any}
          relays={commentRelays}
          variant="comment"
        />
      {:else}
        <p>{description || ""}</p>
      {/if}
    </div>

    <!-- tags -->
    {#snippet slotTags()}
      {#if displayLabels && displayLabels.length}
        {#each displayLabels as label}
          <span class="rounded bg-muted px-2 py-0.5 text-xs max-w-full break-words shrink-0">
            {label}
          </span>
        {/each}
      {/if}
    {/snippet}

    <!-- footer actions (expand) -->
    {#snippet slotFooter()}
      <div class="flex items-center gap-2">
        <ReactionSummary
          event={event}
          url={relayUrl}
          reactionClass="tooltip-left"
          deleteReaction={onDeleteReaction || (() => {})}
          createReaction={onCreateReaction || (() => {})}
          noTooltip={false}
          children={() => {}}
        />
        <EventActions
          event={event}
          url={relayUrl}
          noun="issue"
          relays={commentRelays}
          ownerPubkey={repoOwnerPubkey}
          customActions={undefined}
        />
        <button
          type="button"
          aria-expanded={isExpanded}
          aria-controls="issue-thread"
          onclick={toggleExpand}
        >
          {#if isExpanded}
            <ChevronUp class="h-5 w-5 text-muted-foreground" />
          {:else}
            <ChevronDown class="h-5 w-5 text-muted-foreground" />
          {/if}
        </button>
      </div>
    {/snippet}
  </BaseItemCard>
</div>
{#if isExpanded}
  <Card class="git-card transition-colors">
    <IssueThread
      issueId={id}
      issueKind={"1621"}
      comments={commentsOnThisIssue}
      currentCommenter={currentCommenter}
      onCommentCreated={onCommentCreated}
      relays={commentRelays}
      repoAddress={repoAddress}
      rootEvent={event}
      repoRefs={repoAddress ? [repoAddress] : []}
      relayHint={commentRelays[0]}
      ownerPubkey={repoOwnerPubkey}
    />
  </Card>
{/if}

<style>
  /* Ensure markdown content works with line-clamp */
  :global(.line-clamp-2 > *) {
    display: inline;
  }
  :global(.line-clamp-2 > p) {
    display: inline;
    margin: 0;
  }
  :global(.line-clamp-2 > ul),
  :global(.line-clamp-2 > ol) {
    display: inline;
    list-style: none;
    padding: 0;
    margin: 0;
  }
  :global(.line-clamp-2 > ul > li),
  :global(.line-clamp-2 > ol > li) {
    display: inline;
  }
  :global(.line-clamp-2 > ul > li::before),
  :global(.line-clamp-2 > ol > li::before) {
    content: "• ";
  }
</style>
