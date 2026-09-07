<script lang="ts">
  import TimeAgo from "../../TimeAgo.svelte";
  import ImportedProvenance from "./ImportedProvenance.svelte";
  import { FileCode, MessageSquare } from "@lucide/svelte";
  import { type NostrEvent } from "nostr-tools";
  import {
    createCommentEvent,
    createGitCommentEvent,
    parseCommentEvent,
  } from "@nostr-git/core/events";
  import type { CommentEvent, CommentTag, Profile } from "@nostr-git/core/events";
  import type {
    RichCommentComposerHandle,
    RichComposerContext,
    RichComposerMode,
    RichContentPayload,
  } from "../../types/composer";
  import { useRegistry } from "../../useRegistry";
  import { tick } from "svelte";
  import { slide } from "svelte/transition";
  import RichText from "../RichText.svelte";
  import { toast } from "../../stores/toast";
  import { NOSTR_EVENT_LINK_COPIED } from "../../utils/clipboard";
  import { getEventRelayHints, makeEventNevent } from "../../utils/eventLink";
  const {
    Button,
    Textarea,
    Card,
    ProfileComponent,
    ProfileLink,
    Markdown,
    CommentStatus,
    EventActions,
    ReactionSummary,
    RichCommentComposer,
  } = useRegistry();

  type ReactionTemplate = {
    content: string;
    tags: string[][];
  };

  type ExternalCommentRoot = {
    type: "I";
    value: string;
    kind: string;
  };

  interface Props {
    issueId: string;
    issueKind: string;
    externalRoot?: ExternalCommentRoot;
    currentCommenter: string;
    currentCommenterProfile?: Profile;
    comments?: CommentEvent[] | undefined;
    commenterProfiles?: Profile[] | undefined;
    onCommentCreated?: (comment: CommentEvent) => Promise<void>;
    onLoginRequired?: () => void;
    canEditComment?: (comment: CommentEvent) => boolean;
    onCommentEdited?: (comment: CommentEvent, content: string, tags?: string[][]) => Promise<void>;
    relays?: string[];
    profileRelays?: string[];
    repoAddress?: string;
    rootEvent?: { id: string; kind: number | string; pubkey?: string; tags?: string[][] };
    repoRefs?: string[];
    relayHint?: string;
    ownerPubkey?: string;
    enableReplies?: boolean;
    deleteReaction?: (event: NostrEvent) => void | Promise<void>;
    createReaction?: (comment: CommentEvent, template: ReactionTemplate) => void | Promise<void>;
    onInlineCommentOpen?: (comment: CommentEvent) => void;
    getShareRelays?: (event: CommentEvent) => string[];
    targetReady?: boolean;
  }

  const {
    issueId,
    issueKind = "1621",
    externalRoot,
    comments = [],
    currentCommenter,
    onCommentCreated,
    onLoginRequired,
    canEditComment = () => false,
    onCommentEdited,
    relays = [],
    profileRelays = [],
    repoAddress = "",
    rootEvent,
    repoRefs = [],
    relayHint,
    ownerPubkey = "",
    enableReplies = false,
    deleteReaction,
    createReaction,
    onInlineCommentOpen,
    getShareRelays,
    targetReady = true,
  }: Props = $props();

  let newComment = $state("");
  let isSubmitting = $state(false);
  let replyParent = $state<CommentEvent | null>(null);
  let editingComment = $state<CommentEvent | null>(null);
  let threadElement = $state<HTMLElement | null>(null);
  let composerElement = $state<HTMLElement | null>(null);
  let textareaElement = $state<HTMLTextAreaElement | null>(null);
  let richComposer: RichCommentComposerHandle | undefined;
  let commentHashRequest = $state({ hash: "", request: 0 });
  let commentHashGeneration = 0;
  let completedCommentHashRequest = 0;

  const threadRootId = $derived(externalRoot?.value || issueId);

  const getCommentRootId = (comment: CommentEvent) => {
    if (externalRoot) {
      return comment.tags.find((tag) => tag[0] === externalRoot.type)?.[1] || "";
    }

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
    const parentTag = (comment.tags || []).find(
      (tag) => tag[0] === "e" || (externalRoot && tag[0] === "i")
    );
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
    const eventRelays = getShareRelays?.(event) || [];
    const fallbackRelays = [...relays, relayHint].filter(isRelayHint) as string[];
    return getEventRelayHints(event, eventRelays.length > 0 ? eventRelays : fallbackRelays);
  };

  const getProfileRelayHints = () => (profileRelays.length > 0 ? profileRelays : relays);

  const composerMode = $derived.by((): RichComposerMode => {
    if (editingComment) return "edit";
    if (replyParent) return "reply";
    return "comment";
  });

  const composerPlaceholder = $derived.by(() => {
    if (editingComment) return "Edit your comment...";
    if (replyParent) return "Write a reply...";
    return "Write a comment...";
  });

  const composerContext = $derived.by(
    (): RichComposerContext => ({
      url: relays[0] || relayHint || "",
      relays,
      repoAddress,
      relayHint,
      rootEvent: rootEvent || {
        id: threadRootId,
        kind: externalRoot?.kind || issueKind,
        pubkey: ownerPubkey || undefined,
      },
    })
  );

  const composerKey = $derived.by(
    () => `${composerMode}:${editingComment?.id || replyParent?.id || "root"}`
  );

  const composerInitialContent = $derived.by(() => editingComment?.content || "");

  const clearComposerTarget = () => {
    editingComment = null;
    replyParent = null;
    newComment = "";
  };

  const revealComposer = async () => {
    if (typeof window === "undefined") return;
    const target = composerKey;
    // Target changes remount the rich editor. Wait for its focus handle and the reply preview.
    await tick();
    if (target !== composerKey || !composerElement) return;

    if (RichCommentComposer) {
      await richComposer?.focus({ preventScroll: true });
    } else {
      textareaElement?.focus({ preventScroll: true });
    }

    if (target !== composerKey) return;
    composerElement?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
      block: "center",
    });
  };

  const startReply = (comment: CommentEvent) => {
    editingComment = null;
    newComment = "";
    replyParent = comment;
    void revealComposer();
  };

  const scrollToComment = async (id: string) => {
    if (!id || typeof window === "undefined") return;
    await tick();
    document
      .getElementById(`comment-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    history.replaceState(null, "", `#comment-${id}`);
  };

  const scrollToThreadEnd = async () => {
    if (typeof window === "undefined") return;
    await tick();
    window.requestAnimationFrame(() => {
      threadElement?.scrollIntoView({ behavior: "smooth", block: "end" });
    });
  };

  const commentsParsed = $derived.by(() => {
    const getCommentTimestamp = (comment: CommentEvent) => {
      const originalDate = comment.tags.find((tag) => tag[0] === "original_date")?.[1];
      const originalSeconds = originalDate ? parseInt(originalDate, 10) : NaN;

      return !Number.isNaN(originalSeconds) ? originalSeconds : comment.created_at || 0;
    };

    return comments
      .filter((c) => getCommentRootId(c) === threadRootId)
      .slice()
      .sort((a, b) => getCommentTimestamp(a) - getCommentTimestamp(b))
      .map((c) => parseCommentEvent(c));
  });

  const getEventLink = (event: CommentEvent) => {
    return makeEventNevent(event, getCommentRelayHints(event));
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
        message: NOSTR_EVENT_LINK_COPIED,
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

  $effect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      commentHashRequest = {
        hash: window.location.hash || "",
        request: ++commentHashGeneration,
      };
    };
    handler();
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  });

  $effect(() => {
    const { hash, request } = commentHashRequest;
    const ready = targetReady;
    void commentsParsed.length;
    if (
      !ready ||
      request === 0 ||
      request === completedCommentHashRequest ||
      !hash.startsWith("#comment-")
    ) {
      return;
    }

    const targetId = hash.slice(1);
    void tick().then(() => {
      if (commentHashRequest.request !== request || !targetReady) return;
      const el = document.getElementById(targetId);
      if (!el) return;

      completedCommentHashRequest = request;
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });

  async function submitCommentPayload({ content, tags = [] }: RichContentPayload) {
    const trimmedContent = content.trim();
    if (!trimmedContent || isSubmitting) return;

    if (editingComment) {
      if (!onCommentEdited) return;

      try {
        isSubmitting = true;
        await onCommentEdited(editingComment, trimmedContent, tags);
        newComment = "";
        editingComment = null;
      } catch (error) {
        console.error("Failed to edit comment:", error);
        toast.push({
          message: "Failed to edit comment",
          timeout: 3000,
          theme: "error",
        });
        throw error;
      } finally {
        isSubmitting = false;
      }
      return;
    }

    if (!onCommentCreated) return;

    const commentRepoRefs = repoRefs.length ? repoRefs : repoAddress ? [repoAddress] : [];
    const commentEvent = externalRoot
      ? createCommentEvent({
          content: trimmedContent,
          root: externalRoot,
          parent: replyParent
            ? {
                type: "e",
                value: replyParent.id,
                kind: String(replyParent.kind),
                pubkey: replyParent.pubkey,
                relay: relayHint,
              }
            : {
                type: "i",
                value: externalRoot.value,
                kind: externalRoot.kind,
                relay: relayHint,
              },
          extraTags: [
            ...commentRepoRefs.map(
              (repoRef) => ["q", repoRef, ...(relayHint ? [relayHint] : [])] as CommentTag
            ),
            ...(tags as CommentTag[]),
          ],
        })
      : createGitCommentEvent({
          content: trimmedContent,
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
          repoRefs: commentRepoRefs,
          relayHint,
          extraTags: tags as CommentTag[],
        });

    try {
      isSubmitting = true;
      await onCommentCreated(commentEvent);
      newComment = "";
      replyParent = null;
      void scrollToThreadEnd();
    } catch (error) {
      console.error("Failed to post comment:", error);
      toast.push({
        message: "Failed to post comment",
        timeout: 3000,
        theme: "error",
      });
      throw error;
    } finally {
      isSubmitting = false;
    }
  }

  async function submit(event: Event) {
    event.preventDefault();
    event.stopPropagation();

    try {
      await submitCommentPayload({ content: newComment });
    } catch {
      // submitCommentPayload owns user-facing error reporting.
    }
  }

  function startEditingComment(comment: CommentEvent) {
    replyParent = null;
    editingComment = comment;
    newComment = comment.content || "";
    void revealComposer();
  }
</script>

<div bind:this={threadElement} transition:slide>
  <Card class="p-2 border-none shadow-none">
    <div class="space-y-4">
      {#each commentsParsed as c (c.id)}
        {@const origTag = c.raw.tags.find((t) => t[0] === "original_date")}
        {@const origSec = origTag?.[1] != null ? parseInt(origTag[1], 10) : NaN}
        {@const dateToShow = !Number.isNaN(origSec)
          ? new Date(origSec * 1000).toISOString()
          : c.createdAt}
        {@const parentId = getCommentParentId(c.raw)}
        {@const parentComment =
          parentId && parentId !== threadRootId ? getParsedCommentById(parentId) : undefined}
        {@const inlineLocation = getInlineCommentLocation(c.raw)}
        {@const inlineLocationLabel = getInlineLocationLabel(inlineLocation)}
        {@const isReply = Boolean(parentId && parentId !== threadRootId)}
        {@const eventActionUrl = relays[0] || relayHint || ""}
        {@const commentRelayHints = getCommentRelayHints(c.raw)}
        {@const commentActionRelays = repoAddress ? relays : commentRelayHints}
        {@const commentProfileRelays = getProfileRelayHints()}
        {@const canHideSpam = Boolean(
          ownerPubkey && currentCommenter === ownerPubkey && c.raw.pubkey !== currentCommenter
        )}
        {@const reply =
          enableReplies && currentCommenter && onCommentCreated
            ? () => startReply(c.raw)
            : undefined}
        {@const edit =
          currentCommenter && onCommentEdited && canEditComment(c.raw)
            ? () => startEditingComment(c.raw)
            : undefined}
        <div
          id={`comment-${c.id}`}
          data-event={c.id}
          class="relative w-full scroll-mt-4 flex-col gap-3 group animate-fade-in rounded-lg border border-border/70 bg-card/55 px-3 py-3 shadow-[0_1px_0_rgba(15,23,42,0.03)] {isReply
            ? 'ml-2 border-l-2 border-l-blue-500/35 bg-muted/25 sm:ml-4'
            : ''}"
        >
          <div class="flex w-full items-start justify-between gap-3">
            <div class="flex min-w-0 items-start gap-2">
              <ProfileComponent
                pubkey={c.author.pubkey}
                relays={commentProfileRelays}
                hideDetails={true}
                class="h-8 w-8 shrink-0"
              ></ProfileComponent>
              <div class="min-w-0 pt-0.5">
                <ProfileLink
                  pubkey={c.author.pubkey}
                  relays={commentProfileRelays}
                  class="block max-w-full truncate text-sm font-semibold text-foreground"
                />
              </div>
            </div>
            <div class="shrink-0 text-xs text-muted-foreground">
              <span class="whitespace-nowrap"><TimeAgo date={dateToShow} compact /></span>
            </div>
          </div>
          <div class="w-full flex flex-col gap-y-2 mt-2">
            <ImportedProvenance event={c.raw} />
            {#if inlineLocation}
              <button
                type="button"
                class="flex w-full max-w-full items-center gap-1.5 rounded border border-border bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground disabled:cursor-default disabled:hover:text-muted-foreground sm:w-fit"
                onclick={() => onInlineCommentOpen?.(c.raw)}
                disabled={!onInlineCommentOpen}
                title={inlineLocationLabel}
              >
                <FileCode class="h-3 w-3 shrink-0 text-blue-500/70" />
                <span class="hidden shrink-0 text-muted-foreground/70 sm:inline"
                  >inline code comment on:</span
                >
                <span class="min-w-0 truncate font-mono">{inlineLocationLabel}</span>
              </button>
            {/if}
            {#if enableReplies && parentId && parentId !== threadRootId}
              <button
                type="button"
                class="w-fit rounded border border-border bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground hover:text-foreground"
                onclick={() => scrollToComment(parentId)}
              >
                Replying to {parentComment
                  ? previewText(parentComment.content)
                  : parentId.slice(0, 8)}
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
          <div class="mt-3 flex flex-wrap items-center gap-2">
            <EventActions
              event={c.raw}
              url={eventActionUrl}
              noun="comment"
              relays={commentActionRelays}
              repoAddress={repoAddress}
              strictZapRelays={Boolean(repoAddress)}
              ownerPubkey={canHideSpam ? ownerPubkey : ""}
              showReport={canHideSpam}
              showModeration={false}
              readOnly={!currentCommenter}
              menuOnly
              reply={reply}
              edit={edit}
              infoLabel="Message Info"
              class="text-muted-foreground"
              onShare={() => copyEventLink(c.raw)}
            />
            {#if ReactionSummary && deleteReaction && createReaction}
              <ReactionSummary
                event={c.raw as any}
                url={eventActionUrl}
                relays={commentActionRelays}
                strictZapRelays={Boolean(repoAddress)}
                deleteReaction={(event: NostrEvent) => deleteReaction(event)}
                createReaction={(template: ReactionTemplate) => createReaction(c.raw, template)}
                reactionClass="tooltip-left"
              />
            {/if}
          </div>
          {#if CommentStatus}
            <div class="absolute bottom-0 right-0 flex items-center justify-end">
              <CommentStatus event={c.raw as any} />
            </div>
          {/if}
        </div>
      {/each}

      {#if currentCommenter && (onCommentCreated || onCommentEdited)}
        <div
          bind:this={composerElement}
          class="flex flex-col gap-3 pt-4 border-t"
          role="group"
          aria-label="Comment composer"
        >
          {#if editingComment}
            <div
              class="flex items-center justify-between rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <span class="min-w-0 truncate">Editing comment</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-xs"
                onclick={clearComposerTarget}>Cancel</Button
              >
            </div>
          {:else if enableReplies && replyParent}
            <div
              class="flex items-center justify-between rounded border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
            >
              <button
                type="button"
                class="min-w-0 truncate text-left hover:text-foreground"
                onclick={() => scrollToComment(replyParent?.id || "")}
                >Replying to {previewText(replyParent.content)}</button
              >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                class="h-6 px-2 text-xs"
                onclick={clearComposerTarget}>Cancel</Button
              >
            </div>
          {/if}
          {#if RichCommentComposer}
            <div class="flex gap-2 sm:gap-3">
              <div class="hidden flex-shrink-0 sm:block">
                <ProfileComponent
                  pubkey={currentCommenter}
                  relays={getProfileRelayHints()}
                  hideDetails={true}
                />
              </div>
              <div class="min-w-0 flex-1">
                {#key composerKey}
                  <RichCommentComposer
                    onReady={(handle) => {
                      richComposer = handle;
                    }}
                    autofocus={false}
                    initialContent={composerInitialContent}
                    placeholder={composerPlaceholder}
                    submitLabel={editingComment ? "Save edit" : "Comment"}
                    mode={composerMode}
                    compact={false}
                    submitting={isSubmitting}
                    context={composerContext}
                    onSubmit={submitCommentPayload}
                    onCancel={clearComposerTarget}
                  />
                {/key}
              </div>
            </div>
          {:else}
            <form onsubmit={submit} class="flex flex-col gap-3">
              <div class="flex gap-2 sm:gap-3">
                <div class="hidden flex-shrink-0 sm:block">
                  <ProfileComponent
                    pubkey={currentCommenter}
                    relays={getProfileRelayHints()}
                    hideDetails={true}
                  />
                </div>
                <div class="flex-1">
                  <Textarea
                    bind:ref={textareaElement}
                    bind:value={newComment}
                    placeholder={composerPlaceholder}
                    class="min-h-[64px] resize-none w-full text-sm sm:min-h-[80px]"
                  />
                </div>
              </div>
              <div class="flex justify-end">
                <Button
                  type="submit"
                  class="h-9 gap-2 px-3 text-sm"
                  disabled={!newComment.trim() || isSubmitting}
                >
                  <MessageSquare class="h-4 w-4" />
                  {isSubmitting
                    ? editingComment
                      ? "Editing..."
                      : "Commenting..."
                    : editingComment
                      ? "Save edit"
                      : "Comment"}
                </Button>
              </div>
            </form>
          {/if}
        </div>
      {:else}
        <div class="pt-4 border-t text-center text-sm text-muted-foreground">
          {#if onLoginRequired}
            <Button
              type="button"
              variant="outline"
              size="sm"
              class="gap-2"
              onclick={onLoginRequired}
            >
              Sign in to comment
            </Button>
          {:else}
            Sign in to comment
          {/if}
        </div>
      {/if}
    </div>
  </Card>
</div>
