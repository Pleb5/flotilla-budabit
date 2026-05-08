<script lang="ts">
  import TimeAgo from "../../TimeAgo.svelte";
  import { FileCode, MessageSquare, Reply } from "@lucide/svelte";
  import { nip19 } from "nostr-tools";
  import { createGitCommentEvent, parseCommentEvent } from "@nostr-git/core/events";
  import type { CommentEvent, Profile } from "@nostr-git/core/events";
  import { useRegistry } from "../../useRegistry";
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import RichText from "../RichText.svelte";
  import { toast } from "../../stores/toast";
  const { Button, Textarea, Card, ProfileComponent, Markdown, CommentStatus } = useRegistry();

  interface Props {
    issueId: string;
    issueKind: "1621" | "1617" | "1618";
    currentCommenter: string;
    currentCommenterProfile?: Profile;
    comments?: CommentEvent[] | undefined;
    commenterProfiles?: Profile[] | undefined;
    onCommentCreated?: (comment: CommentEvent) => Promise<void>;
    relays?: string[];
    repoAddress?: string;
    rootEvent?: {id: string; kind: number | string; pubkey?: string; tags?: string[][]};
    repoRefs?: string[];
    relayHint?: string;
    enableReplies?: boolean;
    onInlineCommentOpen?: (comment: CommentEvent) => void;
  }

  const {
    issueId,
    issueKind = "1621",
    comments = [],
    currentCommenter,
    onCommentCreated,
    relays = [],
    repoAddress = "",
    rootEvent,
    repoRefs = [],
    relayHint,
    enableReplies = false,
    onInlineCommentOpen,
  }: Props = $props();

  let newComment = $state("");
  let isSubmitting = $state(false);
  let replyParent = $state<CommentEvent | null>(null);

  const getCommentRootId = (comment: CommentEvent) => {
    const rootTag = (comment.tags || []).find(
      (tag) => tag[0] === "E" || (tag[0] === "e" && tag[3] === "root")
    );

    return (
      rootTag?.[1] ||
      comment.tags.find((tag) => tag[0] === "E")?.[1] ||
      comment.tags.find((tag) => tag[0] === "e")?.[1] ||
      ""
    );
  };

  const getCommentParentId = (comment: CommentEvent) => {
    const parentTag = (comment.tags || []).find((tag) => tag[0] === "e");
    return parentTag?.[1] || "";
  };

  const getTagValue = (comment: CommentEvent, name: string) =>
    (comment.tags || []).find((tag) => tag[0] === name)?.[1] || "";

  const getInlineCommentLocation = (comment: CommentEvent) => {
    const filePath = getTagValue(comment, "f");
    if (!filePath) return null;
    const lineTag = (comment.tags || []).find((tag) => tag[0] === "line");
    const line = lineTag?.[1] || "";
    return {
      filePath,
      line,
      lineSide: lineTag?.[2] === "del" ? "del" : undefined,
    };
  };

  const getInlineLocationLabel = (location: ReturnType<typeof getInlineCommentLocation>) => {
    if (!location) return "";
    return location.line ? `${location.filePath}:${location.line}` : location.filePath;
  };

  const previewText = (content: string) => {
    const normalized = (content || "").replace(/\s+/g, " ").trim();
    return normalized.length > 80 ? `${normalized.slice(0, 77)}...` : normalized;
  };

  const getParsedCommentById = (id: string) => commentsParsed.find((comment) => comment.id === id);

  const isRelayHint = (value: string | undefined) => Boolean(value?.match(/^wss?:\/\//));

  const getCommentRelayHints = (event: CommentEvent) => {
    const hints = new Set<string>();
    for (const relay of [...relays, relayHint].filter(isRelayHint)) {
      hints.add(relay as string);
    }
    return Array.from(hints);
  };

  const scrollToComment = async (id: string) => {
    if (!id || typeof window === "undefined") return;
    await tick();
    document.getElementById(`comment-${id}`)?.scrollIntoView({behavior: "smooth", block: "center"});
    history.replaceState(null, "", `#comment-${id}`);
  };

  const commentsParsed = $derived.by(() => {
    const getCommentTimestamp = (comment: CommentEvent) => {
      const originalDate = comment.tags.find((tag) => tag[0] === "original_date")?.[1];
      const originalSeconds = originalDate ? parseInt(originalDate, 10) : NaN;

      return !Number.isNaN(originalSeconds) ? originalSeconds : comment.created_at || 0;
    };

    return comments
      .filter((c) => getCommentRootId(c) === issueId)
      .slice()
      .sort((a, b) => getCommentTimestamp(a) - getCommentTimestamp(b))
      .map((c) => parseCommentEvent(c));
  });

  const getEventLink = (event: CommentEvent) => {
    try {
      const relayHints = getCommentRelayHints(event);
      return nip19.neventEncode({
        id: event.id,
        relays: relayHints,
        author: event.pubkey,
        kind: event.kind,
      });
    } catch (error) {
      console.warn("Failed to encode event link:", error);
      return "";
    }
  };

  const copyEventLink = async (event: CommentEvent) => {
    if (!event?.id) return;
    const link = getEventLink(event);

    if (!link) {
      toast.push({
        message: "Failed to copy to clipboard",
        timeout: 3000,
        theme: "error",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(link);
      toast.push({
        message: "Event Link Copied!",
        timeout: 2000,
      });
    } catch (error) {
      console.error("Failed to copy event link:", error);
      toast.push({
        message: "Failed to copy to clipboard",
        timeout: 3000,
        theme: "error",
      });
    }
  };

  const scrollToCommentHash = async () => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash || "";
    if (!hash.startsWith("#comment-")) return;
    const targetId = hash.slice(1);
    await tick();
    const el = document.getElementById(targetId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  $effect(() => {
    void commentsParsed.length;
    void scrollToCommentHash();
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    const handler = () => void scrollToCommentHash();
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  });

  async function submit(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!newComment.trim() || !onCommentCreated || isSubmitting) return;

    const commentEvent = createGitCommentEvent({
      content: newComment,
      root: {
        id: rootEvent?.id || issueId,
        kind: rootEvent?.kind || issueKind,
        pubkey: rootEvent?.pubkey,
        relay: relayHint,
      },
      parent: replyParent
        ? {
            id: replyParent.id,
            kind: replyParent.kind,
            pubkey: replyParent.pubkey,
            relay: relayHint,
          }
        : {
            id: rootEvent?.id || issueId,
            kind: rootEvent?.kind || issueKind,
            pubkey: rootEvent?.pubkey,
            relay: relayHint,
          },
      repoRefs: repoRefs.length ? repoRefs : repoAddress ? [repoAddress] : [],
      relayHint,
    });

    try {
      isSubmitting = true;
      await onCommentCreated(commentEvent);
      newComment = "";
      replyParent = null;
    } catch (error) {
      console.error("Failed to post comment:", error);
      toast.push({
        message: "Failed to post comment",
        timeout: 3000,
        theme: "error",
      });
    } finally {
      isSubmitting = false;
    }
  }
</script>

<div transition:slide>
  <Card class="p-2 border-none shadow-none">
    <div class="space-y-4">
      {#each commentsParsed as c (c.id)}
        {@const origTag = c.raw.tags.find((t) => t[0] === "original_date")}
        {@const origSec = origTag?.[1] != null ? parseInt(origTag[1], 10) : NaN}
        {@const dateToShow = !Number.isNaN(origSec)
          ? new Date(origSec * 1000).toISOString()
          : c.createdAt}
        {@const parentId = getCommentParentId(c.raw)}
        {@const parentComment = parentId && parentId !== issueId ? getParsedCommentById(parentId) : undefined}
        {@const inlineLocation = getInlineCommentLocation(c.raw)}
        {@const inlineLocationLabel = getInlineLocationLabel(inlineLocation)}
        <div
          id={`comment-${c.id}`}
          data-event={c.id}
          class="relative w-full mt-4 flex-col gap-3 group animate-fade-in"
        >
          <div class="w-full grid grid-cols-[1fr_auto] items-start gap-2">
            <ProfileComponent pubkey={c.author.pubkey} hideDetails={false}></ProfileComponent>
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              <TimeAgo date={dateToShow} />
              {#if enableReplies && currentCommenter && onCommentCreated}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  class="h-7 w-7 text-muted-foreground hover:text-foreground"
                  onclick={() => {
                    replyParent = c.raw;
                  }}
                  aria-label="Reply to comment"
                  title="Reply"
                >
                  <Reply class="h-4 w-4" />
                </Button>
              {/if}
              <Button
                variant="ghost"
                size="icon"
                class="h-7 w-7 text-muted-foreground hover:text-foreground"
                onclick={() => copyEventLink(c.raw)}
                aria-label="Share comment"
                title="Share"
              >
                <svg
                  class="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M12 9C10.3431 9 9 7.65685 9 6C9 4.34315 10.3431 3 12 3C13.6569 3 15 4.34315 15 6C15 7.65685 13.6569 9 12 9Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  ></path>
                  <path
                    d="M5.5 21C3.84315 21 2.5 19.6569 2.5 18C2.5 16.3431 3.84315 15 5.5 15C7.15685 15 8.5 16.3431 8.5 18C8.5 19.6569 7.15685 21 5.5 21Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  ></path>
                  <path
                    d="M18.5 21C16.8431 21 15.5 19.6569 15.5 18C15.5 16.3431 16.8431 15 18.5 15C20.1569 15 21.5 16.3431 21.5 18C21.5 19.6569 20.1569 21 18.5 21Z"
                    stroke="currentColor"
                    stroke-width="1.5"
                  ></path>
                  <path
                    d="M20 13C20 10.6106 18.9525 8.46589 17.2916 7M4 13C4 10.6106 5.04752 8.46589 6.70838 7M10 20.748C10.6392 20.9125 11.3094 21 12 21C12.6906 21 13.3608 20.9125 14 20.748"
                    stroke="currentColor"
                    stroke-width="1.5"
                    stroke-linecap="round"
                  ></path>
                </svg>
              </Button>
            </div>
          </div>
          <div class="w-full flex flex-col gap-y-2 mt-2">
            {#if inlineLocation}
              <button
                type="button"
                class="flex w-fit max-w-full items-center gap-1.5 rounded border border-border bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground"
                onclick={() => onInlineCommentOpen?.(c.raw)}
                disabled={!onInlineCommentOpen}
                title={inlineLocationLabel}
              >
                <FileCode class="h-3 w-3 shrink-0 text-blue-500/70" />
                <span class="shrink-0 text-muted-foreground/70">inline code comment on:</span>
                <span class="min-w-0 truncate font-mono">{inlineLocationLabel}</span>
              </button>
            {/if}
            {#if enableReplies && parentId && parentId !== issueId}
              <button
                type="button"
                class="w-fit rounded border border-border bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
                onclick={() => scrollToComment(parentId)}
              >
                Replying to {parentComment ? previewText(parentComment.content) : parentId.slice(0, 8)}
              </button>
            {/if}
            <div class="text-muted-foreground text-sm">
              {#if Markdown}
                <Markdown
                  content={c.content}
                  event={c.raw as any}
                  relays={relays}
                  variant="comment"
                />
              {:else}
                <RichText content={c.content} prose={false} />
              {/if}
            </div>
          </div>
          {#if CommentStatus}
            <div class="absolute bottom-0 right-0 flex items-center justify-end">
              <CommentStatus event={c.raw as any} />
            </div>
          {/if}
        </div>
      {/each}

      {#if currentCommenter && onCommentCreated}
        <form onsubmit={submit} class="flex flex-col gap-3 pt-4 border-t">
          {#if enableReplies && replyParent}
            <div class="flex items-center justify-between rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <button type="button" class="min-w-0 truncate text-left hover:text-foreground" onclick={() => scrollToComment(replyParent?.id || "")}>Replying to {previewText(replyParent.content)}</button>
              <Button type="button" variant="ghost" size="sm" class="h-6 px-2 text-xs" onclick={() => (replyParent = null)}>Cancel</Button>
            </div>
          {/if}
          <div class="flex gap-3">
            <div class="flex-shrink-0">
              <ProfileComponent pubkey={currentCommenter} hideDetails={true} />
            </div>
            <div class="flex-1">
              <Textarea
                bind:value={newComment}
                placeholder={replyParent ? "Write a reply..." : "Write a comment..."}
                class="min-h-[80px] resize-none w-full"
              />
            </div>
          </div>
          <div class="flex justify-end">
            <Button type="submit" class="gap-2" disabled={!newComment.trim() || isSubmitting}>
              <MessageSquare class="h-4 w-4" />
              {isSubmitting ? "Commenting..." : "Comment"}
            </Button>
          </div>
        </form>
      {:else}
        <div class="pt-4 border-t text-center text-sm text-muted-foreground">
          Sign in to comment
        </div>
      {/if}
    </div>
  </Card>
</div>
