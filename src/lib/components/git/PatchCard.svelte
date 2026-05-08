<script lang="ts">
  import {
    MessageSquare,
    ChevronDown,
    ChevronUp,
    GitPullRequest,
    Check,
    X,
    FileCode,
    Copy,
    GitCommit,
    Shield,
    User,
  } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  const { Button, Card, EventActions, ReactionSummary, ProfileLink } = useRegistry();
  import { toast } from "../../stores/toast";
  import {
    GIT_STATUS_APPLIED,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    GIT_STATUS_OPEN,
    GIT_PULL_REQUEST,
    type PatchEvent,
    type PullRequestEvent,
    type StatusEvent,
    type CommentEvent,
  } from "@nostr-git/core/events";
  import { parseGitPatchFromEvent } from "@nostr-git/core/git";
  import { parsePullRequestEvent } from "@nostr-git/core/events";
  import IssueThread from "./IssueThread.svelte";
  import Status from "./Status.svelte";
  import { getTagValue, getTags } from "@nostr-git/core/events";
  import BaseItemCard from "../BaseItemCard.svelte";
  import TimeAgo from "../../TimeAgo.svelte";
  import NostrAvatar from "./NostrAvatar.svelte";

  interface Props {
    event: PatchEvent | PullRequestEvent;
    status?: StatusEvent;
    patches?: PatchEvent[];
    comments?: CommentEvent[];
    currentCommenter: string;
    onCommentCreated?: (comment: CommentEvent) => Promise<void>;
    extraLabels?: string[];
    // Optional for Status.svelte integration
    repo?: any;
    statusEvents?: StatusEvent[];
    actorPubkey?: string;
    reviewersCount?: number; // new optional prop
    relays?: string[]; // Relay URLs for EventActions
    isNew?: boolean;
    onDeleteReaction?: (event: any) => void | Promise<void>;
    onCreateReaction?: (template: { content: string; tags?: string[][] }) => void | Promise<void>;
  }

  const {
    event,
    status,
    patches,
    comments = [],
    currentCommenter,
    onCommentCreated,
    extraLabels = [],
    repo,
    statusEvents = [],
    actorPubkey,
    reviewersCount = 0, // default value
    relays = [],
    isNew = false,
    onDeleteReaction,
    onCreateReaction,
  }: Props = $props();

  const isPullRequest = $derived(event.kind === GIT_PULL_REQUEST);

  const { id, title, description, baseBranch, commitCount, createdAt, commitHash, diff, author } =
    $derived.by(() => {
      if (isPullRequest) {
        const parsed = parsePullRequestEvent(event as PullRequestEvent);
        return {
          id: parsed.id,
          title: parsed.subject,
          description: parsed.content,
          baseBranch: parsed.branchName || "",
          commitCount: parsed.tipCommitOid ? 1 : 0,
          createdAt: parsed.createdAt,
          commitHash: parsed.tipCommitOid,
          author: parsed.author as { pubkey: string; name?: string },
        };
      }

      const parsed = parseGitPatchFromEvent(event as PatchEvent);
      return {
        id: parsed.id,
        title: parsed.title,
        description: parsed.description,
        baseBranch: parsed.baseBranch,
        commitCount: parsed.commitCount,
        createdAt: parsed.createdAt,
        commitHash: parsed.commitHash,
        diff: parsed.diff,
        author: parsed.author,
      };
    });

  const displayTitle = $derived(
    title && typeof title === "string" && title.trim().length > 0 ? title.trim() : "Untitled"
  );

  // Create relay URL for EventActions
  const relayUrl = $derived.by(() => {
    if (relays && relays.length > 0) {
      return relays[0];
    }
    if (repo?.relays && repo.relays.length > 0) {
      return repo.relays[0];
    }
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

  function toStringSet(value: unknown): Set<string> {
    if (!value) return new Set<string>();
    if (value instanceof Set) {
      return new Set(Array.from(value).filter((v) => typeof v === "string") as string[]);
    }
    if (Array.isArray(value)) {
      return new Set(value.filter((v) => typeof v === "string") as string[]);
    }
    if (typeof value === "string") {
      return new Set([value]);
    }
    return new Set<string>();
  }

  function normalizeEffectiveLabels(eff?: any | null): {
    flat: Set<string>;
    byNamespace: Record<string, Set<string>>;
  } {
    const flat = toStringSet(eff?.flat);
    const byNamespace: Record<string, Set<string>> = {};

    if (eff && typeof eff.byNamespace === "object") {
      for (const ns of Object.keys(eff.byNamespace)) {
        byNamespace[ns] = toStringSet(eff.byNamespace[ns]);
      }
    }

    return { flat, byNamespace };
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

  function groupLabels(view: { flat: Set<string>; byNamespace: Record<string, Set<string>> }): {
    Status: string[];
    Type: string[];
    Area: string[];
    Tags: string[];
    Other: string[];
  } {
    const groupSets = {
      Status: new Set<string>(),
      Type: new Set<string>(),
      Area: new Set<string>(),
      Tags: new Set<string>(),
      Other: new Set<string>(),
    };

    const namespaceToGroup = (ns: string): keyof typeof groupSets => {
      if (ns === "org.nostr.git.status") return "Status";
      if (ns === "org.nostr.git.type") return "Type";
      if (ns === "org.nostr.git.area") return "Area";
      if (ns === "#t") return "Tags";
      return "Other";
    };

    for (const ns of Object.keys(view.byNamespace)) {
      const group = namespaceToGroup(ns);
      for (const val of view.byNamespace[ns]) {
        groupSets[group].add(toNaturalLabel(val));
      }
    }

    return {
      Status: Array.from(groupSets.Status),
      Type: Array.from(groupSets.Type),
      Area: Array.from(groupSets.Area),
      Tags: Array.from(groupSets.Tags),
      Other: Array.from(groupSets.Other),
    };
  }

  const displayLabels = $derived.by(() => {
    // Normalize the extraLabels (which come from the centralized label system)
    return toNaturalArray(extraLabels);
  });

  let isExpanded = $state(false);

  const noun = $derived(isPullRequest ? "Pull Request" : "Patch");

  // Copy to clipboard function
  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.push({
        message: `${label} copied to clipboard`,
        timeout: 2000,
      });
    } catch (error) {
      console.error("Failed to copy to clipboard:", error);
      toast.push({
        message: `Failed to copy ${label}`,
        timeout: 3000,
        theme: "error",
      });
    }
  };

  const statusIcon = $derived(getStatusIcon(status?.kind));

  function getStatusIcon(kind: number | undefined) {
    switch (kind) {
      case GIT_STATUS_OPEN:
        return { icon: GitPullRequest, color: "text-amber-500" };
      case GIT_STATUS_APPLIED:
        return { icon: Check, color: "text-green-500" };
      case GIT_STATUS_CLOSED:
        return { icon: X, color: "text-red-500" };
      case GIT_STATUS_DRAFT:
        return { icon: FileCode, color: "text-gray-500" };
      default:
        return { icon: GitPullRequest, color: "text-gray-400" };
    }
  }

  function toggleExpand() {
    isExpanded = !isExpanded;
  }
</script>

<div class={isNew ? "border-l-2 border-primary pl-2" : ""}>
  <BaseItemCard clickable={true} href={`patches/${id}`} variant="patch">
    <!-- title -->
    {#snippet slotTitle()}
      {displayTitle}
    {/snippet}

    <!-- actions (chevron) -->
    {#snippet slotActions()}
      <Button
        variant="ghost"
        size="icon"
        aria-expanded={isExpanded}
        aria-controls="patch-description"
        onclick={toggleExpand}
      >
        {#if isExpanded}
          <ChevronUp class="h-5 w-5 text-muted-foreground" />
        {:else}
          <ChevronDown class="h-5 w-5 text-muted-foreground" />
        {/if}
      </Button>
    {/snippet}

    <!-- meta row -->
    {#snippet slotMeta()}
      {#if repo && statusEvents}
        <Status
          repo={repo}
          rootId={id}
          rootKind={event.kind}
          rootAuthor={event.pubkey}
          statusEvents={statusEvents}
          actorPubkey={actorPubkey}
          compact={true}
        />
      {:else if statusIcon}
        {@const { icon: Icon, color } = statusIcon}
        <Icon class={`h-6 w-6 ${color}`} />
      {/if}
      <span class="whitespace-nowrap">Opened <TimeAgo date={createdAt} /></span>
      <span
        class="ml-2 inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground"
      >
        {isPullRequest ? "Pull Request" : "Patch"}
      </span>
      <div class="flex items-center gap-1">
        <span class="whitespace-nowrap">• By </span>
        <NostrAvatar pubkey={event.pubkey} title={displayTitle || "Issue author"} />
        <ProfileLink pubkey={event.pubkey} />
      </div>
      {#if baseBranch}
        <div class="flex items-center gap-1">
          <span class="whitespace-nowrap">• Base: </span>
          <span class="max-w-[120px] inline-block truncate align-bottom" title={baseBranch}
            >{baseBranch}</span
          >
        </div>
      {/if}
      {#if !isPullRequest && commitCount > 0}
        <span class="whitespace-nowrap">• {commitCount + (patches?.length ?? 0)} commits</span>
      {/if}
      {#if comments?.length > 0}
        <span class="whitespace-nowrap">• {comments?.length ?? 0} comments</span>
      {/if}
      {#if reviewersCount > 0}
        <span class="whitespace-nowrap"
          >• {reviewersCount} reviewer{reviewersCount === 1 ? "" : "s"}</span
        >
      {/if}
      {#if commitHash}
        <div class="flex items-center gap-1 whitespace-nowrap">
          <span>•</span>
          <GitCommit class="h-3 w-3" />
          <code class="text-xs font-mono">{commitHash.substring(0, 7)}</code>
          <button
            class="hover:text-foreground transition-colors"
            onclick={() => copyToClipboard(commitHash, "Commit hash")}
          >
            <Copy class="h-3 w-3" />
          </button>
        </div>
      {/if}
      {#if getTagValue(event as any, "commit-pgp-sig")}
        <span>•</span>
        <div class="flex items-center gap-1 text-green-600">
          <Shield class="h-3 w-3" />
          <span class="text-xs">Signed</span>
        </div>
      {/if}
    {/snippet}

    <!-- body content -->
    {#if isExpanded}
      <p class="text-sm text-muted-foreground mt-3 max-w-full break-all sm:break-words">
        {description}
      </p>
      <div class="mt-3 p-3 bg-muted/30 rounded border text-xs">
        <div class="grid grid-cols-2 gap-2">
          {#if commitHash}
            <div class="flex items-center justify-between">
              <span class="text-muted-foreground">Commit:</span>
              <div class="flex items-center gap-1">
                <code class="bg-background px-1 rounded font-mono"
                  >{commitHash.substring(0, 8)}</code
                >
                <button
                  class="hover:text-foreground transition-colors"
                  onclick={() => copyToClipboard(commitHash, "Commit hash")}
                >
                  <Copy class="h-3 w-3" />
                </button>
              </div>
            </div>
          {/if}

          {#if event.tags}
            {@const committerName = getTagValue(event as any, "committer")}
            {#if committerName && author.name && committerName !== author.name}
              <div class="flex items-center justify-between">
                <span class="text-muted-foreground">Committer:</span>
                <div class="flex items-center gap-1 min-w-0">
                  <User class="h-3 w-3 flex-shrink-0" />
                  <span class="truncate" title={committerName}>{committerName}</span>
                </div>
              </div>
            {/if}

            {@const recipients = getTags(event as any, "p")}
            {#if recipients.length > 0}
              <div class="col-span-2 flex items-center justify-between">
                <span class="text-muted-foreground">Reviewers:</span>
                <span>{recipients.length} tagged</span>
              </div>
            {/if}
          {/if}

          {#if diff && diff.length > 0}
            {@const lineStats = diff.reduce(
              (acc: any, file: any) => {
                const content = file.content || "";
                const added = (content.match(/^\+/gm) || []).length;
                const removed = (content.match(/^-/gm) || []).length;
                return { added: acc.added + added, removed: acc.removed + removed };
              },
              { added: 0, removed: 0 }
            )}

            <div class="col-span-2 pt-2 border-t">
              <div class="flex items-center justify-between text-xs">
                <span class="text-muted-foreground">Files:</span>
                <div class="flex items-center gap-3">
                  <span class="flex items-center gap-1">
                    <FileCode class="h-3 w-3" />
                    {diff.length} changed
                  </span>
                  {#if lineStats.added > 0}
                    <span class="text-green-600">+{lineStats.added}</span>
                  {/if}
                  {#if lineStats.removed > 0}
                    <span class="text-red-600">-{lineStats.removed}</span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
        </div>
      </div>
    {:else}
      <p
        class="text-sm text-muted-foreground mt-3 line-clamp-2 max-w-full break-all sm:break-words"
      >
        {description}
      </p>
    {/if}

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

    <!-- footer actions: reactions/actions and counts -->
    {#snippet slotFooter()}
      <div class="flex items-center gap-1">
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
          noun={noun}
          relays={commentRelays}
          customActions={undefined}
        />
        <MessageSquare class="h-4 w-4 text-muted-foreground" />
        <span class="text-sm text-muted-foreground">{comments?.length ?? 0}</span>
      </div>
    {/snippet}
  </BaseItemCard>
</div>

{#if isExpanded}
  <Card class="git-card transition-colors">
    <IssueThread
      issueId={id}
      issueKind={String(event.kind) as "1617" | "1618"}
      comments={comments}
      currentCommenter={currentCommenter}
      onCommentCreated={onCommentCreated}
      relays={commentRelays}
      repoAddress={repoAddress}
      rootEvent={event}
      repoRefs={repoAddress ? [repoAddress] : []}
      relayHint={commentRelays[0]}
    />
  </Card>
{/if}
