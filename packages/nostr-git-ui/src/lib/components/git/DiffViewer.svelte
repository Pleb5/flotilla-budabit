<script lang="ts">
  import { MessageSquare, MessageSquarePlus, Loader2, Pencil, X } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  import RichText from "../RichText.svelte";
  import TimeAgo from "../../TimeAgo.svelte";
  const { Avatar, AvatarFallback, AvatarImage, Button, Textarea, Markdown, RichInlineCommentComposer } =
    useRegistry();
  import { tick } from "svelte";
  import parseDiff from "parse-diff";
  import { ChevronDown, ChevronRight, ChevronUp } from "@lucide/svelte";
  import {
    createGitCommentEvent,
    createGitInlineCommentEvent,
    getTagValue,
  } from "@nostr-git/core/events";
  import type { CommentEvent, CommentTag } from "@nostr-git/core/events";
  import type { RichComposerContext, RichContentPayload } from "../../types/composer";
  import { toast } from "../../stores/toast.js";
  import { toUserMessage } from "../../utils/gitErrorUi.js";
  import {
    getHighlightLanguageForPath,
    highlightCodeLines,
    highlightCodeSnippet,
  } from "../../utils/codeHighlight";
  import { canUseInlineComments, type DiffViewerRootEvent } from "./diff-viewer";
  import { GIT_PERMALINK, type PermalinkEvent } from "@nostr-git/core/types";
  import { githubPermalinkDiffId } from "@nostr-git/core/git";
  import type { Repo } from "./Repo.svelte";

  interface Comment {
    id: string;
    lineNumber: number;
    lineStart?: number;
    lineEnd?: number;
    filePath?: string;
    commitId?: string;
    lineSide?: "del";
    content: string;
    rawEvent?: CommentEvent;
    parentId?: string;
    rootInlineId?: string;
    isResolveEvent?: boolean;
    author: {
      name: string;
      avatar: string;
    };
    createdAt: string;
  }

  // Use parse-diff File type
  type AnyFileChange = import("parse-diff").File;

  function getFileLabel(file: AnyFileChange): string {
    // parse-diff: file.from and file.to
    if (file.from && file.to && file.from !== file.to) {
      return `${file.from} → ${file.to}`;
    }
    return file.from || file.to || "unknown";
  }

  function getDiffFilePath(file: AnyFileChange): string {
    return (
      (file.to && file.to !== "/dev/null" ? file.to : undefined) ??
      (file.from && file.from !== "/dev/null" ? file.from : undefined) ??
      file.to ??
      file.from ??
      "unknown"
    );
  }

  function getFileIsBinary(file: AnyFileChange): boolean {
    return (file as any).binary === true;
  }

  const getFileLanguage = (filepath: string): string => getHighlightLanguageForPath(filepath);

  const highlightCode = (content: string, language: string): string =>
    highlightCodeSnippet(content, language);

  const getLineNumClass = (type: "add" | "del" | "normal") => {
    switch (type) {
      case "add":
        return "bg-emerald-300 text-emerald-950 dark:bg-emerald-800/70 dark:text-emerald-100";
      case "del":
        return "bg-rose-300 text-rose-950 dark:bg-rose-800/70 dark:text-rose-100";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const {
    diff = undefined,
    showLineNumbers = true,
    expandAll = false,
    comments = [],
    rootEvent,
    parentEvent,
    onComment,
    canEditComment = () => false,
    onCommentEdited,
    currentPubkey,
    repo,
    repoRefs,
    relayHint,
    publish,
    enablePermalinks = true,
    showFileHeaders = true,
    compact = false,
    framed = true,
    showFileAnchors = true,
    enableHashNavigation = true,
    scrollTarget = null,
  }: {
    diff: AnyFileChange[] | string | undefined;
    showLineNumbers?: boolean;
    expandAll?: boolean;
    comments?: Comment[];
    rootEvent?: DiffViewerRootEvent;
    parentEvent?: DiffViewerRootEvent;
    onComment?: (comment: Omit<CommentEvent, "id" | "pubkey" | "sig">) => void;
    canEditComment?: (comment: CommentEvent) => boolean;
    onCommentEdited?: (comment: CommentEvent, content: string, tags?: string[][]) => Promise<void> | void;
    currentPubkey?: string | null;
    repo?: Repo;
    repoRefs?: string[];
    relayHint?: string;
    publish?: (permalink: PermalinkEvent) => Promise<void | boolean>;
    enablePermalinks?: boolean;
    showFileHeaders?: boolean;
    compact?: boolean;
    framed?: boolean;
    showFileAnchors?: boolean;
    enableHashNavigation?: boolean;
    scrollTarget?: {
      id: string | null;
      line?: number | null;
      side?: "del";
      request?: number;
    } | null;
  } = $props();

  const canComment = $derived(canUseInlineComments({ rootEvent, onComment, currentPubkey }));
  const canSelectDiffLines = $derived(enablePermalinks || canComment);
  const activeParentEvent = $derived(parentEvent || rootEvent);
  const inlineComposerContext = $derived.by(
    (): RichComposerContext => ({
      url: relayHint || "",
      relays: relayHint ? [relayHint] : [],
      repoAddress: repo?.address,
      relayHint,
      rootEvent: rootEvent
        ? {
            id: rootEvent.id,
            kind: rootEvent.kind || "",
            pubkey: rootEvent.pubkey,
            tags: rootEvent.tags,
          }
        : undefined,
    })
  );

  let selectedLine = $state<number | null>(null);
  let selectedFileIdx = $state<number | null>(null);
  let selectedChunkIdx = $state<number | null>(null);
  let selectedCommentLineRange = $state<string | null>(null);
  let selectedCommentLineSide = $state<"del" | undefined>(undefined);
  let newComment = $state("");
  let replyThreadRootId = $state<string | null>(null);
  let replyContent = $state("");
  let editingCommentEvent = $state<CommentEvent | null>(null);
  let resolvingThreadRootId = $state<string | null>(null);
  let inlineThreadOpenById = $state<Record<string, boolean>>({});
  let expandedFiles = $state(new Set<string>());
  let isSubmitting = $state(false);
  let selectedFilePath = $state<string | null>(null);
  let selectedStartIndex = $state<number | null>(null);
  let selectedEndIndex = $state<number | null>(null);
  let isPointerSelecting = $state(false);
  let pointerStartIndex = $state<number | null>(null);
  let pointerStartFilePath = $state<string | null>(null);
  let pointerId = $state<number | null>(null);
  let touchTimer: number | null = $state(null);
  let touchStartX = $state(0);
  let touchStartY = $state(0);
  let touchMoved = $state(false);
  let touchIdentifier = $state<number | null>(null);
  let touchLongPress = $state(false);
  let lastInputWasTouch = $state(false);
  let isTouchSelecting = $state(false);
  let touchStartIndex = $state<number | null>(null);
  let touchStartFilePath = $state<string | null>(null);
  let selectionScrollParent = $state<HTMLElement | null>(null);
  let autoScrollFrame: number | null = $state(null);
  let autoScrollClientX = 0;
  let autoScrollClientY = 0;
  let autoScrollActive = false;
  let ignoreMenuCloseUntil = $state(0);
  let showPermalinkMenu = $state(false);
  let permalinkMenuX = $state(0);
  let permalinkMenuY = $state(0);
  let diffContainer: HTMLElement | null = $state(null);
  let diffAnchors = $state<Record<string, string>>({});
  const LONG_PRESS_MS = 300;
  const TOUCH_MOVE_THRESHOLD = 8;
  const AUTO_SCROLL_THRESHOLD = 36;
  const AUTO_SCROLL_STEP = 24;
  const MENU_WIDTH = 192;
  const MENU_PADDING = 8;

  const fileChunkOffsets = $derived.by(() => {
    return parsed.map((file) => {
      let offset = 0;
      const chunks = file.chunks || [];
      return chunks.map((chunk) => {
        const start = offset;
        if ("changes" in chunk && Array.isArray(chunk.changes)) {
          offset += chunk.changes.length;
        }
        return start;
      });
    });
  });

  const pushErrorToast = (title: string, err: unknown, fallback?: string) => {
    const { message, theme } = toUserMessage(err, fallback ?? title);
    toast.push({
      title,
      description: message,
      variant: theme === "warning" ? "default" : "destructive",
    });
  };

  function getCommentOffsetClass() {
    return showLineNumbers ? "ml-0 sm:ml-24" : "ml-0";
  }

  function getLineNumberCellClass(
    type: "add" | "del" | "normal",
    filePath?: string,
    lineIndex?: number,
    lineNumber?: number | null
  ) {
    const densityClass = compact ? "py-px" : "py-0.5";
    const selectionClass =
      filePath !== undefined && lineIndex !== undefined
        ? getSelectedGutterClass(filePath, lineIndex, lineNumber ?? null)
        : "";
    return `w-10 shrink-0 px-1 text-right text-[10px] font-mono sm:w-12 sm:px-2 sm:text-xs border-r border-border flex items-center justify-end ${densityClass} ${getLineNumClass(
      type
    )} ${selectionClass}`.trim();
  }

  function getLineContentClass() {
    const densityClass = compact ? "py-px" : "py-0.5";
    return `flex flex-1 items-center px-1 font-mono text-[13px] leading-4 whitespace-nowrap sm:px-2 ${densityClass}`;
  }

  function getCommentButtonClass(forceVisible = false) {
    const sizeClass = compact
      ? "h-5 w-5 rounded-sm p-0 sm:h-6 sm:w-6"
      : "h-6 w-6 rounded-sm p-0 sm:h-7 sm:w-7";
    const visibilityClass = forceVisible
      ? "opacity-100"
      : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
    return `diff-comment-trigger ${sizeClass} ${visibilityClass} bg-background/90 text-muted-foreground shadow-sm transition-opacity hover:text-blue-500`;
  }

  function getCommentThreadClass() {
    return `w-full max-w-none overflow-hidden rounded-b-md border border-t-0 border-blue-500/30 bg-background shadow-sm`;
  }

  function getCommentComposerClass() {
    return `diff-comment-composer w-full max-w-none overflow-hidden rounded-b-md border border-t-0 border-blue-500/30 bg-background shadow-sm`;
  }

  // Accept both AST and raw string for dev ergonomics
  let parsed = $state<AnyFileChange[]>([]);
  $effect(() => {
    let initialExpanded = new Set<string>();
    if (typeof diff === "string") {
      try {
        parsed = parseDiff(diff);
      } catch (e) {
        parsed = [];
      }
    } else if (diff && Array.isArray(diff)) {
      // If diff is already the correct, fully-typed object
      parsed = diff;
    } else {
      parsed = [];
    }
    // Initially expand all files
    if (expandAll) {
      parsed.forEach((file) => initialExpanded.add(getFileLabel(file)));
    }
    expandedFiles = initialExpanded;
  });

  $effect(() => {
    const paths = Array.from(new Set(parsed.map(getDiffFilePath).filter(Boolean)));
    if (paths.length === 0) {
      diffAnchors = {};
      return;
    }
    let cancelled = false;
    Promise.all(paths.map(async (path) => [path, await githubPermalinkDiffId(path)] as const))
      .then((entries) => {
        if (!cancelled) diffAnchors = Object.fromEntries(entries);
      })
      .catch(() => {
        if (!cancelled) diffAnchors = {};
      });
    return () => {
      cancelled = true;
    };
  });

  const getDiffAnchorFromLocation = () => {
    if (typeof window === "undefined") return null;
    const hash = window.location.hash || "";
    if (!hash.startsWith("#diff-")) return null;
    return hash.slice(1);
  };

  const parseDiffLineAnchor = (anchor: string) => {
    const match = anchor.match(/^diff-([a-f0-9]+)([LR])(\d+)(?:-[LR](\d+))?/i);
    if (!match) return null;
    const start = Number.parseInt(match[3], 10);
    const end = match[4] ? Number.parseInt(match[4], 10) : null;
    if (Number.isNaN(start)) return null;
    return {
      hash: match[1],
      side: match[2] as "L" | "R",
      start,
      end: end && !Number.isNaN(end) ? end : null,
    };
  };

  const findFilePathByHash = (hash: string) => {
    for (const [filePath, value] of Object.entries(diffAnchors)) {
      if (value === hash) return filePath;
    }
    return null;
  };

  const nextFrame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

  const waitMs = (ms: number) =>
    new Promise<void>((resolve) => {
      window.setTimeout(() => resolve(), ms);
    });

  const scrollElementIntoView = (el: HTMLElement, align: "start" | "center" = "center") => {
    const scrollParent = diffContainer?.closest(".scroll-container") as HTMLElement | null;
    if (!scrollParent) {
      el.scrollIntoView({ block: align });
      return;
    }
    const parentRect = scrollParent.getBoundingClientRect();
    const elRect = el.getBoundingClientRect();
    const offset = elRect.top - parentRect.top + scrollParent.scrollTop;
    const target = align === "center" ? offset - scrollParent.clientHeight / 2 : offset;
    scrollParent.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
  };

  const getDiffLineTarget = (anchor: string) => {
    const lineEl = document.getElementById(anchor) as HTMLElement | null;
    const lineRow = lineEl?.closest("[data-diff-index]") as HTMLElement | null;

    return {
      lineEl,
      lineRow,
      scrollTarget: lineRow || lineEl,
    };
  };

  const waitForDiffLineTarget = async (anchor: string) => {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const target = getDiffLineTarget(anchor);
      if (target.scrollTarget) return target;
      await tick();
      await nextFrame();
    }

    return getDiffLineTarget(anchor);
  };

  const stabilizeScrollToTarget = async (
    getTarget: () => HTMLElement | null,
    align: "start" | "center"
  ) => {
    let didScroll = false;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const target = getTarget();
      if (target) {
        scrollElementIntoView(target, align);
        didScroll = true;
      }
      await nextFrame();
    }

    if (didScroll) {
      await waitMs(120);
      const target = getTarget();
      if (target) scrollElementIntoView(target, align);
    }

    return didScroll;
  };

  const ensureFileExpandedByPath = (filePath: string) => {
    const file = parsed.find((entry) => getDiffFilePath(entry) === filePath);
    if (!file) return;
    const fileId = getFileLabel(file);
    if (expandedFiles.has(fileId)) return;
    const next = new Set(expandedFiles);
    next.add(fileId);
    expandedFiles = next;
  };

  const scrollToDiffHash = async () => {
    if (!diffContainer) return;
    const anchor = getDiffAnchorFromLocation();
    if (!anchor) return;
    const lineAnchor = parseDiffLineAnchor(anchor);
    if (lineAnchor) {
      const filePath = findFilePathByHash(lineAnchor.hash);
      if (filePath) ensureFileExpandedByPath(filePath);
      await tick();
      const lineTarget = await waitForDiffLineTarget(
        `diff-${lineAnchor.hash}${lineAnchor.side}${lineAnchor.start}`
      );
      if (lineTarget.scrollTarget) {
        await stabilizeScrollToTarget(
          () =>
            getDiffLineTarget(`diff-${lineAnchor.hash}${lineAnchor.side}${lineAnchor.start}`)
              .scrollTarget,
          "center"
        );
        const startIndex = Number(lineTarget.lineRow?.dataset.diffIndex || "");
        const startPath = lineTarget.lineRow?.dataset.filePath || filePath || null;
        let endIndex = startIndex;
        if (lineAnchor.end) {
          const endTarget = await waitForDiffLineTarget(
            `diff-${lineAnchor.hash}${lineAnchor.side}${lineAnchor.end}`
          );
          const parsedEnd = Number(endTarget.lineRow?.dataset.diffIndex || "");
          if (Number.isFinite(parsedEnd)) {
            endIndex = parsedEnd;
          }
        }
        if (startPath && Number.isFinite(startIndex)) {
          selectedFilePath = startPath;
          selectedStartIndex = Math.min(startIndex, endIndex);
          selectedEndIndex = Math.max(startIndex, endIndex);
        }
        return;
      }
    }
    await tick();
    await nextFrame();
    const hashMatch = anchor.match(/^diff-([a-f0-9]+)/i);
    const fileHash = hashMatch ? hashMatch[1] : null;
    if (!fileHash) return;
    const el = document.getElementById(`diff-${fileHash}`);
    if (el) {
      await stabilizeScrollToTarget(
        () => document.getElementById(`diff-${fileHash}`) as HTMLElement | null,
        "start"
      );
    }
  };

  const scrollToCommentHash = async () => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash || "";
    if (!hash.startsWith("#comment-")) return;
    await tick();
    const el = document.getElementById(hash.slice(1));
    if (el) {
      el.scrollIntoView({ block: "center" });
      el.classList.remove("diff-comment-blip");
      void el.offsetWidth;
      el.classList.add("diff-comment-blip");
      window.setTimeout(() => el.classList.remove("diff-comment-blip"), 1800);
    }
  };

  const getScopedTargetById = (id: string) => {
    if (!diffContainer) return null;
    const lineEl = diffContainer.querySelector(`#${CSS.escape(id)}`) as HTMLElement | null;
    return (lineEl?.closest("[data-diff-index]") as HTMLElement | null) || lineEl;
  };

  const getScopedTargetByLine = (line?: number | null, side?: "del") => {
    if (!diffContainer || !line) return null;
    const attr = side === "del" ? "data-line-left" : "data-line-right";
    return diffContainer.querySelector(`[${attr}="${line}"]`) as HTMLElement | null;
  };

  const scrollToExplicitTarget = async (target: NonNullable<typeof scrollTarget>) => {
    if (!diffContainer) return;
    let didScroll = false;

    for (let attempt = 0; attempt < 60; attempt += 1) {
      const el = target.id ? getScopedTargetById(target.id) : null;
      const fallback = getScopedTargetByLine(target.line, target.side);
      const resolved = el || fallback || (!target.id && !target.line ? diffContainer : null);
      if (resolved) {
        scrollElementIntoView(resolved, target.id || target.line ? "center" : "start");
        resolved.classList.remove("diff-comment-blip");
        void resolved.offsetWidth;
        resolved.classList.add("diff-comment-blip");
        window.setTimeout(() => resolved.classList.remove("diff-comment-blip"), 1800);
        didScroll = true;
        break;
      }
      await tick();
      await nextFrame();
    }

    if (didScroll) {
      await waitMs(120);
      const el = target.id ? getScopedTargetById(target.id) : null;
      const fallback = getScopedTargetByLine(target.line, target.side);
      const resolved = el || fallback;
      if (resolved) scrollElementIntoView(resolved, "center");
    }
  };

  function closeCommentComposer() {
    selectedLine = null;
    selectedFileIdx = null;
    selectedChunkIdx = null;
    selectedCommentLineRange = null;
    selectedCommentLineSide = undefined;
    newComment = "";
  }

  function closeInlineReplyComposer() {
    replyThreadRootId = null;
    replyContent = "";
    editingCommentEvent = null;
  }

  $effect(() => {
    const handler = (e: MouseEvent) => {
      if (Date.now() < ignoreMenuCloseUntil) return;
      const target = e.target as HTMLElement;
      const inMenu = target.closest?.(".permalink-menu-popup");
      if (!inMenu) {
        showPermalinkMenu = false;
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  });

  $effect(() => {
    if (selectedLine === null) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (
        target.closest(
          ".diff-comment-composer, .diff-comment-trigger, [data-tippy-root], .tippy-box"
        )
      ) {
        return;
      }
      closeCommentComposer();
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  });

  $effect(() => {
    const anchors = diffAnchors;
    if (!enableHashNavigation) return;
    if (!diffContainer || Object.keys(anchors).length === 0) return;
    void scrollToDiffHash();
  });

  $effect(() => {
    comments?.length;
    void scrollToCommentHash();
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      if (enableHashNavigation) void scrollToDiffHash();
      void scrollToCommentHash();
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  });

  $effect(() => {
    if (!scrollTarget) return;
    void scrollToExplicitTarget(scrollTarget);
  });

  $effect(() => {
    const container = diffContainer;
    if (!container || typeof window === "undefined") return;
    const handleSelectionChange = () => {
      if (!enablePermalinks) return;
      if (isPointerSelecting) return;
      if (isTouchSelecting) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      const startNode = range.startContainer;
      const endNode = range.endContainer;
      if (!container.contains(startNode) || !container.contains(endNode)) return;
      setSelectionFromDom();
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  });

  $effect(() => {
    const container = diffContainer;
    if (!container) return;

    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!container.contains(target)) return;
      if (!canSelectDiffLines) return;
      if (lastInputWasTouch) {
        e.preventDefault();
        return;
      }
      const selection = setSelectionFromDom() ?? getSelectionRange();
      if (!selection) return;
      e.preventDefault();
      openPermalinkMenuAt(e.clientX, e.clientY);
    };

    let pointerDragged = false;
    let pointerSelectionStartedInGutter = false;
    let touchSelectionStartedInGutter = false;

    const handlePointerDown = (e: PointerEvent) => {
      lastInputWasTouch = e.pointerType === "touch";
      if (e.pointerType === "touch") return;
      if (!canSelectDiffLines) return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!container.contains(target)) return;
      const startedInGutter = !!target.closest(".diff-line-gutter");
      if (shouldIgnoreSelectionTarget(target, startedInGutter)) return;
      if (!enablePermalinks && !startedInGutter) return;
      const hit = getLineFromPoint(e.clientX, e.clientY);
      if (!hit) return;
      showPermalinkMenu = false;
      clearDomSelection();
      selectedLine = null;
      selectedFileIdx = null;
      selectedChunkIdx = null;
      selectedCommentLineRange = null;
      selectedCommentLineSide = undefined;
      pointerId = e.pointerId;
      pointerStartFilePath = hit.filePath;
      pointerStartIndex = hit.index;
      pointerSelectionStartedInGutter = startedInGutter;
      isPointerSelecting = true;
      pointerDragged = false;
      setDiffSelection(hit.filePath, hit.index, hit.index);
      container.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!canSelectDiffLines) return;
      if (!isPointerSelecting || pointerId !== e.pointerId) return;
      if (!pointerStartFilePath || pointerStartIndex === null) return;

      const hit = getLineFromPoint(e.clientX, e.clientY);
      if (hit && hit.filePath === pointerStartFilePath) {
        if (hit.index !== pointerStartIndex) pointerDragged = true;
        setDiffSelection(pointerStartFilePath, pointerStartIndex, hit.index);
      }

      updateAutoScroll(e.clientX, e.clientY);
      e.preventDefault();
    };

    const finishPointerSelection = (clientX: number, clientY: number) => {
      if (!isPointerSelecting) return;
      isPointerSelecting = false;
      stopAutoScroll();
      if (pointerId !== null) {
        container.releasePointerCapture?.(pointerId);
      }

      const dragged = pointerDragged;
      pointerDragged = false;
      pointerId = null;
      pointerStartFilePath = null;
      pointerStartIndex = null;

      if (!dragged) {
        pointerSelectionStartedInGutter = false;
        return;
      }
      ignoreMenuCloseUntil = Date.now() + 300;
      pointerSelectionStartedInGutter = false;
      if (!openPermalinkMenuFromSelection()) {
        openPermalinkMenuAt(clientX, clientY);
      }
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button !== 0) return;
      finishPointerSelection(e.clientX, e.clientY);
    };

    const handlePointerCancel = () => {
      isPointerSelecting = false;
      if (pointerId !== null) {
        container.releasePointerCapture?.(pointerId);
      }
      pointerId = null;
      pointerStartFilePath = null;
      pointerStartIndex = null;
      pointerSelectionStartedInGutter = false;
      pointerDragged = false;
      stopAutoScroll();
    };

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!container.contains(target)) return;
      if (!canSelectDiffLines) return;
      const startedInGutter = !!target.closest(".diff-line-gutter");
      if (shouldIgnoreSelectionTarget(target, startedInGutter)) return;
      if (!enablePermalinks && !startedInGutter) return;
      if (touchIdentifier !== null) return;
      const touch = e.changedTouches[0];
      if (!touch) return;
      lastInputWasTouch = true;
      touchIdentifier = touch.identifier;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      touchMoved = false;
      touchLongPress = false;
      isTouchSelecting = false;
      touchStartIndex = null;
      touchStartFilePath = null;
      touchSelectionStartedInGutter = startedInGutter;
      clearTouchTimer();
      touchTimer = window.setTimeout(() => {
        touchLongPress = true;
        const hit = getLineFromPoint(touchStartX, touchStartY);
        if (!hit) return;
        showPermalinkMenu = false;
        clearDomSelection();
        selectedLine = null;
        selectedFileIdx = null;
        selectedChunkIdx = null;
        selectedCommentLineRange = null;
        selectedCommentLineSide = undefined;
        isTouchSelecting = true;
        touchStartFilePath = hit.filePath;
        touchStartIndex = hit.index;
        setDiffSelection(hit.filePath, hit.index, hit.index);
        updateAutoScroll(touchStartX, touchStartY);
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!canSelectDiffLines) return;
      if (touchIdentifier === null) return;
      const touch = Array.from(e.changedTouches).find((t) => t.identifier === touchIdentifier);
      if (!touch) return;
      const dx = touch.clientX - touchStartX;
      const dy = touch.clientY - touchStartY;
      if (!isTouchSelecting && Math.hypot(dx, dy) > TOUCH_MOVE_THRESHOLD) {
        touchMoved = true;
        clearTouchTimer();
        touchIdentifier = null;
        touchStartFilePath = null;
        touchStartIndex = null;
        stopAutoScroll();
        return;
      }

      if (!isTouchSelecting || !touchStartFilePath || touchStartIndex === null) return;
      e.preventDefault();
      const hit = getLineFromPoint(touch.clientX, touch.clientY);
      if (hit && hit.filePath === touchStartFilePath) {
        setDiffSelection(touchStartFilePath, touchStartIndex, hit.index);
      }
      updateAutoScroll(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (!canSelectDiffLines) return;
      if (touchIdentifier === null) return;
      const touch = Array.from(e.changedTouches).find((t) => t.identifier === touchIdentifier);
      if (!touch) return;
      clearTouchTimer();
      touchIdentifier = null;
      stopAutoScroll();
      if (!isTouchSelecting) return;

      ignoreMenuCloseUntil = Date.now() + 300;
      if (!openPermalinkMenuFromSelection()) {
        openPermalinkMenuAt(touch.clientX, touch.clientY);
      }

      touchLongPress = false;
      isTouchSelecting = false;
      touchStartFilePath = null;
      touchStartIndex = null;
      touchSelectionStartedInGutter = false;
    };

    const handleTouchCancel = () => {
      clearTouchTimer();
      touchIdentifier = null;
      touchLongPress = false;
      touchMoved = false;
      isTouchSelecting = false;
      touchStartFilePath = null;
      touchStartIndex = null;
      touchSelectionStartedInGutter = false;
      stopAutoScroll();
    };

    container.addEventListener("contextmenu", handleContextMenu, { capture: true } as any);
    container.addEventListener("pointerdown", handlePointerDown, { capture: true } as any);
    container.addEventListener("pointermove", handlePointerMove, { capture: true } as any);
    container.addEventListener("pointerup", handlePointerUp, { capture: true } as any);
    container.addEventListener("pointercancel", handlePointerCancel, { capture: true } as any);
    container.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: true,
    } as any);
    container.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    } as any);
    container.addEventListener("touchend", handleTouchEnd, { capture: true } as any);
    container.addEventListener("touchcancel", handleTouchCancel, { capture: true } as any);
    return () => {
      container.removeEventListener("contextmenu", handleContextMenu, { capture: true } as any);
      container.removeEventListener("pointerdown", handlePointerDown, { capture: true } as any);
      container.removeEventListener("pointermove", handlePointerMove, { capture: true } as any);
      container.removeEventListener("pointerup", handlePointerUp, { capture: true } as any);
      container.removeEventListener("pointercancel", handlePointerCancel, {
        capture: true,
      } as any);
      container.removeEventListener("touchstart", handleTouchStart, { capture: true } as any);
      container.removeEventListener("touchmove", handleTouchMove, { capture: true } as any);
      container.removeEventListener("touchend", handleTouchEnd, { capture: true } as any);
      container.removeEventListener("touchcancel", handleTouchCancel, { capture: true } as any);
      stopAutoScroll();
    };
  });

  // Comments by file/hunk/line
  // Match comments based on actual line numbers from the change object and file path
  function getLineNumberToMatch(change: import("parse-diff").Change): number | null {
    if (change.type === "add") return change.ln ?? null;
    if (change.type === "del") return change.ln ?? null;
    return change.ln2 ?? change.ln1 ?? null;
  }

  function commentMatchesFileAndSide(
    c: Comment,
    change: import("parse-diff").Change,
    filePath: string
  ) {
    if (c.lineSide === "del" && change.type !== "del") {
      return false;
    }
    if (c.lineSide !== "del" && change.type === "del") {
      return false;
    }
    // If comment has a filePath, it must match; if comment doesn't have filePath (legacy), allow it
    // This provides backward compatibility with old comments that don't have file paths
    if (c.filePath !== undefined && c.filePath !== "") {
      return c.filePath === filePath;
    }
    // Legacy comments without filePath are allowed (backward compatibility)
    return true;
  }

  function isRootInlineComment(c: Comment) {
    return !c.isResolveEvent && (!c.rootInlineId || c.rootInlineId === c.id);
  }

  function getCommentRootsCoveringLine(
    change: import("parse-diff").Change,
    filePath: string
  ): Comment[] {
    const lineNumberToMatch = getLineNumberToMatch(change);
    if (lineNumberToMatch === null) return [];

    return comments.filter((c) => {
      if (!isRootInlineComment(c)) return false;
      const start = c.lineStart || c.lineNumber;
      const end = c.lineEnd || c.lineNumber;
      if (lineNumberToMatch < Math.min(start, end) || lineNumberToMatch > Math.max(start, end))
        return false;
      return commentMatchesFileAndSide(c, change, filePath);
    });
  }

  function getCommentsForLine(change: import("parse-diff").Change, filePath: string): Comment[] {
    const lineNumberToMatch = getLineNumberToMatch(change);
    if (lineNumberToMatch === null) return [];
    const endingRoots = getCommentRootsCoveringLine(change, filePath).filter((c) => {
      const end = c.lineEnd || c.lineNumber;
      return end === lineNumberToMatch;
    });
    if (endingRoots.length === 0) return [];
    const rootIds = new Set(endingRoots.map((root) => root.id));
    return comments
      .filter((c) => rootIds.has(c.rootInlineId || c.id))
      .sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
          a.id.localeCompare(b.id)
      );
  }

  function getVisibleComments(thread: Comment[]) {
    return thread.filter((comment) => !comment.isResolveEvent);
  }

  function isThreadResolved(thread: Comment[]) {
    return thread.some((comment) => comment.isResolveEvent);
  }

  function getThreadRoot(thread: Comment[]) {
    return thread.find(isRootInlineComment) || thread[0];
  }

  function isInlineThreadOpen(thread: Comment[]) {
    const root = getThreadRoot(thread);
    if (!root?.id) return true;
    return inlineThreadOpenById[root.id] ?? !isThreadResolved(thread);
  }

  function toggleInlineThread(thread: Comment[]) {
    const root = getThreadRoot(thread);
    if (!root?.id) return;
    inlineThreadOpenById = {
      ...inlineThreadOpenById,
      [root.id]: !isInlineThreadOpen(thread),
    };
  }

  function getThreadLineLabel(thread: Comment[]) {
    const root = getThreadRoot(thread);
    if (!root) return "line";
    const start = root.lineStart || root.lineNumber;
    const end = root.lineEnd || root.lineNumber;
    return start !== end ? `lines ${start}-${end}` : `line ${end}`;
  }

  type DiffSelection = { filePath: string; start: number; end: number };

  function getLineElementFromNode(node: Node): HTMLElement | null {
    if (node instanceof HTMLElement) return node.closest("[data-diff-index]");
    if (node.parentElement) return node.parentElement.closest("[data-diff-index]");
    return null;
  }

  function getSelectionRangeFromDom(): DiffSelection | null {
    if (typeof window === "undefined") return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;
    const startEl = getLineElementFromNode(range.startContainer);
    const endEl = getLineElementFromNode(range.endContainer);
    if (!startEl || !endEl) return null;
    const startPath = startEl.dataset.filePath;
    const endPath = endEl.dataset.filePath;
    if (!startPath || startPath !== endPath) return null;
    const startIndex = Number(startEl.dataset.diffIndex || "");
    const endIndex = Number(endEl.dataset.diffIndex || "");
    if (!Number.isFinite(startIndex) || !Number.isFinite(endIndex)) return null;
    return {
      filePath: startPath,
      start: Math.min(startIndex, endIndex),
      end: Math.max(startIndex, endIndex),
    };
  }

  function setSelectionFromDom(): DiffSelection | null {
    const selection = getSelectionRangeFromDom();
    if (!selection) return null;
    selectedFilePath = selection.filePath;
    selectedStartIndex = selection.start;
    selectedEndIndex = selection.end;
    return selection;
  }

  function clearDomSelection() {
    if (typeof window === "undefined") return;
    const selection = window.getSelection();
    if (selection && selection.rangeCount > 0) {
      selection.removeAllRanges();
    }
  }

  function shouldIgnoreSelectionTarget(target: HTMLElement | null, allowGutterSelection = false) {
    if (!target) return true;
    if (target.closest(".permalink-menu-popup")) return true;
    if (
      target.closest(
        "button, a, input, textarea, select, option, summary, [role='button'], [contenteditable='true']"
      )
    ) {
      return true;
    }
    if (allowGutterSelection && target.closest(".diff-line-gutter")) return false;
    return false;
  }

  function clearTouchTimer() {
    if (touchTimer) {
      window.clearTimeout(touchTimer);
      touchTimer = null;
    }
  }

  function findSelectionScrollParent(element: HTMLElement | null): HTMLElement | null {
    if (!element || typeof window === "undefined") return null;
    let current: HTMLElement | null = element;
    while (current) {
      const style = window.getComputedStyle(current);
      const overflowY = style.overflowY;
      if (
        (overflowY === "auto" || overflowY === "scroll") &&
        current.scrollHeight > current.clientHeight
      ) {
        return current;
      }
      current = current.parentElement;
    }
    return null;
  }

  function autoScrollForSelection(clientY: number) {
    const threshold = AUTO_SCROLL_THRESHOLD;
    const maxStep = AUTO_SCROLL_STEP;
    const scrollParent =
      selectionScrollParent &&
      selectionScrollParent.scrollHeight > selectionScrollParent.clientHeight
        ? selectionScrollParent
        : diffContainer
          ? findSelectionScrollParent(diffContainer)
          : null;

    if (scrollParent) {
      if (scrollParent !== selectionScrollParent) {
        selectionScrollParent = scrollParent;
      }
      const rect = scrollParent.getBoundingClientRect();
      if (clientY < rect.top + threshold) {
        const delta = Math.min(maxStep, rect.top + threshold - clientY);
        scrollParent.scrollTop -= delta;
      } else if (clientY > rect.bottom - threshold) {
        const delta = Math.min(maxStep, clientY - (rect.bottom - threshold));
        scrollParent.scrollTop += delta;
      }
      return;
    }

    if (clientY < threshold) {
      window.scrollBy({ top: -maxStep });
    } else if (clientY > window.innerHeight - threshold) {
      window.scrollBy({ top: maxStep });
    }
  }

  function startAutoScroll() {
    if (autoScrollFrame !== null) return;
    const tick = () => {
      if (!autoScrollActive) {
        autoScrollFrame = null;
        return;
      }
      autoScrollForSelection(autoScrollClientY);
      if (isPointerSelecting && pointerStartFilePath && pointerStartIndex !== null) {
        const hit = getLineFromPoint(autoScrollClientX, autoScrollClientY);
        if (hit && hit.filePath === pointerStartFilePath) {
          setDiffSelection(pointerStartFilePath, pointerStartIndex, hit.index);
        }
      }
      if (isTouchSelecting && touchStartFilePath && touchStartIndex !== null) {
        const hit = getLineFromPoint(autoScrollClientX, autoScrollClientY);
        if (hit && hit.filePath === touchStartFilePath) {
          setDiffSelection(touchStartFilePath, touchStartIndex, hit.index);
        }
      }
      autoScrollFrame = window.requestAnimationFrame(tick);
    };
    autoScrollFrame = window.requestAnimationFrame(tick);
  }

  function updateAutoScroll(clientX: number, clientY: number) {
    autoScrollClientX = clientX;
    autoScrollClientY = clientY;
    if (!autoScrollActive) {
      autoScrollActive = true;
      startAutoScroll();
    }
  }

  function stopAutoScroll() {
    autoScrollActive = false;
    if (autoScrollFrame !== null) {
      window.cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
  }

  function getLineFromPoint(clientX: number, clientY: number) {
    if (!diffContainer || typeof document === "undefined") return null;
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const lineEl = target?.closest?.("[data-diff-index]") as HTMLElement | null;
    if (!lineEl || !diffContainer.contains(lineEl)) return null;
    const filePath = lineEl.dataset.filePath;
    const index = Number(lineEl.dataset.diffIndex || "");
    if (!filePath || !Number.isFinite(index)) return null;
    return { filePath, index, element: lineEl };
  }

  function setDiffSelection(filePath: string, startIndex: number, endIndex: number) {
    selectedFilePath = filePath;
    selectedStartIndex = Math.min(startIndex, endIndex);
    selectedEndIndex = Math.max(startIndex, endIndex);
  }

  function getSelectionAnchorRect(selection: DiffSelection | null): DOMRect | null {
    if (!selection || !diffContainer) return null;
    const lineEl = diffContainer.querySelector(
      `[data-file-path="${CSS.escape(selection.filePath)}"][data-diff-index="${selection.end}"]`
    ) as HTMLElement | null;
    if (lineEl) return lineEl.getBoundingClientRect();
    return null;
  }

  function getSelectionRect(): DOMRect | null {
    if (typeof window === "undefined") return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;
    const rects = Array.from(range.getClientRects());
    if (rects.length > 0) return rects[0];
    return range.getBoundingClientRect();
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function openPermalinkMenuAt(clientX: number, clientY: number) {
    if (!enablePermalinks) return;
    if (!diffContainer) return;
    const rect = diffContainer.getBoundingClientRect();
    const minX = diffContainer.scrollLeft + MENU_PADDING;
    const maxX = Math.max(
      minX,
      diffContainer.scrollLeft + diffContainer.clientWidth - MENU_WIDTH - MENU_PADDING
    );
    const desiredX = clientX - rect.left + diffContainer.scrollLeft;
    permalinkMenuX = clamp(desiredX, minX, maxX);
    permalinkMenuY = Math.max(MENU_PADDING, clientY - rect.top + diffContainer.scrollTop);
    showPermalinkMenu = true;
  }

  function openPermalinkMenuFromSelection(selection: DiffSelection | null = getSelectionRange()) {
    const rect = getSelectionAnchorRect(selection) ?? getSelectionRect();
    if (!rect) return false;
    openPermalinkMenuAt(rect.left + MENU_PADDING, rect.bottom + 4);
    return true;
  }

  function getSelectionRange(): DiffSelection | null {
    if (!selectedFilePath || selectedStartIndex === null) return null;
    const endValue = selectedEndIndex ?? selectedStartIndex;
    const start = Math.min(selectedStartIndex, endValue);
    const end = Math.max(selectedStartIndex, endValue);
    return { filePath: selectedFilePath, start, end };
  }

  function isLineWithinSelection(filePath: string, lineIndex: number) {
    const selection = getSelectionRange();
    if (!selection) return false;
    if (selection.filePath !== filePath) return false;
    return lineIndex >= selection.start && lineIndex <= selection.end;
  }

  function isSelectionEndLine(filePath: string, lineIndex: number) {
    const selection = getSelectionRange();
    return !!selection && selection.filePath === filePath && lineIndex === selection.end;
  }

  function getSelectedGutterClass(filePath: string, lineIndex: number, lineNumber: number | null) {
    const selection = getSelectionRange();
    if (!selection || lineNumber === null || !isLineWithinSelection(filePath, lineIndex)) {
      return "";
    }

    const classes = ["diff-selected-gutter"];
    if (lineIndex === selection.start) classes.push("diff-selected-gutter-start");
    if (lineIndex === selection.end) classes.push("diff-selected-gutter-end");
    return classes.join(" ");
  }

  function getLineNumberForSide(change: import("parse-diff").Change, side: "L" | "R") {
    if (side === "L") {
      if (change.type === "add") return null;
      if (change.type === "del") return change.ln ?? null;
      return change.ln1 ?? null;
    }
    if (change.type === "del") return null;
    if (change.type === "add") return change.ln ?? null;
    return change.ln2 ?? null;
  }

  function getSelectionContent(selection: DiffSelection): string {
    const file = parsed.find((f) => (f.to || f.from || "unknown") === selection.filePath);
    if (!file || !file.chunks) return "";
    const lines: string[] = [];
    let index = 0;
    for (const chunk of file.chunks) {
      if (!("changes" in chunk)) continue;
      for (const change of chunk.changes) {
        if (index >= selection.start && index <= selection.end) {
          lines.push(change.content);
        }
        index += 1;
      }
    }
    return lines.join("\n");
  }

  function getPreferredCommentLine(change: import("parse-diff").Change): number | null {
    if (change.type === "add") return change.ln ?? null;
    if (change.type === "del") return change.ln ?? null;
    return change.ln2 ?? change.ln1 ?? null;
  }

  function getCommentLineSide(change: import("parse-diff").Change): "del" | undefined {
    return change.type === "del" ? "del" : undefined;
  }

  function getLineInfoForIndex(filePath: string, targetIndex: number) {
    const fileIdx = parsed.findIndex((f) => (f.to || f.from || "unknown") === filePath);
    if (fileIdx === -1) return null;
    const file = parsed[fileIdx];
    if (!file?.chunks) return null;
    let index = 0;
    for (let chunkIdx = 0; chunkIdx < file.chunks.length; chunkIdx += 1) {
      const chunk = file.chunks[chunkIdx];
      if (!("changes" in chunk)) continue;
      for (let changeIdx = 0; changeIdx < chunk.changes.length; changeIdx += 1) {
        const change = chunk.changes[changeIdx];
        if (index === targetIndex) {
          return {
            fileIdx,
            chunkIdx,
            line: changeIdx + 1,
            change,
            lineNumber: getPreferredCommentLine(change),
            lineSide: getCommentLineSide(change),
          };
        }
        index += 1;
      }
    }
    return null;
  }

  function getCommentLineRangeForSelection(selection: DiffSelection) {
    const endInfo = getLineInfoForIndex(selection.filePath, selection.end);
    if (!endInfo) return null;
    const side: "L" | "R" = endInfo.lineSide === "del" ? "L" : "R";
    const file = parsed[endInfo.fileIdx];
    if (!file?.chunks) return null;

    const lineNumbers: number[] = [];
    let index = 0;
    for (const chunk of file.chunks) {
      if (!("changes" in chunk)) continue;
      for (const change of chunk.changes) {
        if (index >= selection.start && index <= selection.end) {
          const lineNumber = getLineNumberForSide(change, side);
          if (lineNumber !== null) lineNumbers.push(lineNumber);
        }
        index += 1;
      }
    }

    if (lineNumbers.length === 0) return null;
    const start = lineNumbers[0];
    const end = lineNumbers[lineNumbers.length - 1];
    return start === end ? String(start) : `${start}-${end}`;
  }

  function openCommentBoxFromSelection(selection: DiffSelection | null = getSelectionRange()) {
    if (!canComment || !selection) return false;
    const endInfo = getLineInfoForIndex(selection.filePath, selection.end);
    if (!endInfo || endInfo.lineNumber === null) return false;
    selectedLine = endInfo.line;
    selectedFileIdx = endInfo.fileIdx;
    selectedChunkIdx = endInfo.chunkIdx;
    selectedCommentLineRange =
      getCommentLineRangeForSelection(selection) ?? String(endInfo.lineNumber);
    selectedCommentLineSide = endInfo.lineSide;
    showPermalinkMenu = false;
    newComment = "";
    return true;
  }

  function getRightAnchorRange(selection: DiffSelection): { start: number; end: number } | null {
    const file = parsed.find((f) => (f.to || f.from || "unknown") === selection.filePath);
    if (!file || !file.chunks) return null;
    const rightLines: number[] = [];
    let index = 0;
    for (const chunk of file.chunks) {
      if (!("changes" in chunk)) continue;
      for (const change of chunk.changes) {
        if (index >= selection.start && index <= selection.end) {
          const lineNumber = getLineNumberForSide(change, "R");
          if (lineNumber) rightLines.push(lineNumber);
        }
        index += 1;
      }
    }
    if (rightLines.length === 0) return null;
    return {
      start: Math.min(...rightLines),
      end: Math.max(...rightLines),
    };
  }

  function buildPermalinkEvent(): PermalinkEvent | null {
    const selection = getSelectionRange();
    if (!selection) return null;
    if (!repo) return null;

    const tags: string[][] = [];
    if (repo.address) tags.push(["a", repo.address]);
    const repoUrl = (repo.web && repo.web[0]) || (repo.clone && repo.clone[0]) || "";
    if (repoUrl) tags.push(["repo", repoUrl]);

    const commitTag = (rootEvent as any)?.tags ? getTagValue(rootEvent as any, "commit") : "";
    const parentCommitTag = (rootEvent as any)?.tags
      ? getTagValue(rootEvent as any, "parent-commit")
      : "";

    if (commitTag) {
      tags.push(["commit", commitTag]);
      const ref = (repo.refs || []).find((r) => r.type === "heads" && r.commitId === commitTag);
      if (ref?.name) tags.push([`refs/heads/${ref.name}`, commitTag]);
    }
    if (parentCommitTag) tags.push(["parent-commit", parentCommitTag]);

    tags.push(["file", selection.filePath]);
    const anchorRange = getRightAnchorRange(selection);
    if (anchorRange) {
      if (anchorRange.end !== anchorRange.start)
        tags.push(["lines", String(anchorRange.start), String(anchorRange.end)]);
      else tags.push(["lines", String(anchorRange.start)]);
    }

    const language = getFileLanguage(selection.filePath);
    if (language) tags.push(["l", language]);

    return {
      kind: GIT_PERMALINK,
      content: getSelectionContent(selection),
      tags,
      pubkey: "",
      created_at: Math.floor(Date.now() / 1000),
      id: "",
      sig: "",
    };
  }

  async function createPermalink(event?: MouseEvent) {
    event?.stopPropagation();
    showPermalinkMenu = false;
    const evt = buildPermalinkEvent();
    if (!evt) {
      const missing = !repo ? "repo context" : "selected diff lines";
      toast.push({
        title: "Cannot create permalink",
        description: `Missing ${missing}`,
        variant: "destructive",
      });
      return;
    }
    if (!evt.content) {
      toast.push({
        title: "Cannot create permalink",
        description: "No diff content found for the selected lines",
        variant: "destructive",
      });
      return;
    }

    try {
      if (publish) {
        const published = await publish(evt);
        if (published === false) return;
        toast.push({
          title: "Permalink published",
          description: "Permalink published successfully",
        });
      } else {
        await navigator.clipboard.writeText(JSON.stringify(evt));
        toast.push({ title: "Permalink copied", description: "JSON copied to clipboard" });
      }
    } catch (e: any) {
      pushErrorToast("Permalink failed", e, "Failed to create permalink.");
    }
  }

  async function copyLinkToLines(event?: MouseEvent) {
    event?.stopPropagation();
    showPermalinkMenu = false;
    const selection = getSelectionRange();
    if (!selection) {
      toast.push({
        title: "Select diff lines",
        description: "Choose diff lines to copy a link.",
        variant: "destructive",
      });
      return;
    }
    try {
      const hash = await githubPermalinkDiffId(selection.filePath);
      const anchorRange = getRightAnchorRange(selection);
      const range =
        anchorRange && anchorRange.end !== anchorRange.start ? `-R${anchorRange.end}` : "";
      const anchor = anchorRange ? `#diff-${hash}R${anchorRange.start}${range}` : `#diff-${hash}`;
      const base = location.href.split("#")[0];
      await navigator.clipboard.writeText(`${base}${anchor}`);
      toast.push({ title: "Link copied", description: "Permalink copied to clipboard." });
    } catch (e) {
      pushErrorToast("Failed to copy", e, "Could not copy the link to clipboard.");
    }
  }

  function toggleCommentBox(line: number, fileIdx: number, chunkIdx: number) {
    if (!canComment) return;
    if (selectedLine === line && selectedFileIdx === fileIdx && selectedChunkIdx === chunkIdx) {
      selectedLine = null;
      selectedFileIdx = null;
      selectedChunkIdx = null;
      selectedCommentLineRange = null;
      selectedCommentLineSide = undefined;
    } else {
      selectedLine = line;
      selectedFileIdx = fileIdx;
      selectedChunkIdx = chunkIdx;
      const filePath = parsed[fileIdx]?.to || parsed[fileIdx]?.from || "unknown";
      const lineIndex = (fileChunkOffsets[fileIdx]?.[chunkIdx] ?? 0) + line - 1;
      const lineInfo = getLineInfoForIndex(filePath, lineIndex);
      selectedCommentLineRange = lineInfo?.lineNumber != null ? String(lineInfo.lineNumber) : null;
      selectedCommentLineSide = lineInfo?.lineSide;
    }
    newComment = "";
  }

  async function submitCommentPayload(
    payload: RichContentPayload,
    line: number,
    fileIdx: number,
    chunkIdx: number,
    filePath: string
  ) {
    const commentContent = payload.content.trim();
    if (!commentContent || !rootEvent || !onComment || !currentPubkey) {
      console.warn("[DiffViewer] Cannot submit comment: missing required props");
      return;
    }

    if (isSubmitting) return;

    isSubmitting = true;
    try {
      // Get the actual line number from the change
      const file = parsed[fileIdx];
      if (!file || !file.chunks) {
        throw new Error("Invalid file or chunk");
      }

      const chunk = file.chunks[chunkIdx];
      if (!chunk || !("changes" in chunk)) {
        throw new Error("Invalid chunk");
      }

      // Find the change at this line index
      const change = chunk.changes[line - 1];
      if (!change) {
        throw new Error("Invalid change");
      }

      // Determine the actual line number based on change type
      let actualLineNumber: number | null = null;
      if (change.type === "add") {
        actualLineNumber = (change as any).ln ?? null;
      } else if (change.type === "del") {
        actualLineNumber = (change as any).ln ?? null;
      } else if (change.type === "normal") {
        // For normal changes, prefer the new line number (ln2)
        actualLineNumber = (change as any).ln2 ?? (change as any).ln1 ?? null;
      }

      const commitId = (rootEvent as any)?.tags ? getTagValue(rootEvent as any, "commit") : "";
      const defaultRepoRef =
        repo?.address || ((rootEvent as any)?.tags ? getTagValue(rootEvent as any, "a") : "");
      const commentEvent = createGitInlineCommentEvent({
        content: commentContent,
        root: {
          id: rootEvent.id,
          kind: rootEvent.kind?.toString() || "",
          pubkey: rootEvent.pubkey,
          relay: relayHint,
        },
        parent: activeParentEvent
          ? {
              id: activeParentEvent.id,
              kind: activeParentEvent.kind?.toString() || "",
              pubkey: activeParentEvent.pubkey,
              relay: relayHint,
            }
          : undefined,
        authorPubkey: currentPubkey,
        repoRefs: repoRefs?.length ? repoRefs : defaultRepoRef ? [defaultRepoRef] : [],
        relayHint,
        filePath,
        commitId,
        line:
          selectedCommentLineRange ??
          (actualLineNumber !== null ? String(actualLineNumber) : undefined),
        lineSide: selectedCommentLineSide ?? (change.type === "del" ? "del" : undefined),
        extraTags: (payload.tags || []) as CommentTag[],
      });

      // Publish the comment
      onComment(commentEvent);

      // Reset state
      closeCommentComposer();
    } catch (error) {
      console.error("[DiffViewer] Failed to submit comment:", error);
      throw error;
    } finally {
      isSubmitting = false;
    }
  }

  async function submitComment(line: number, fileIdx: number, chunkIdx: number, filePath: string) {
    try {
      await submitCommentPayload({ content: newComment }, line, fileIdx, chunkIdx, filePath);
    } catch {
      // submitCommentPayload owns diagnostics; keep textarea content for retry.
    }
  }

  function makeCommentReplyEvent(parentComment: Comment, content: string, extraTags: CommentTag[] = []) {
    if (!rootEvent || !onComment || !currentPubkey || !parentComment.rawEvent) return null;
    const defaultRepoRef =
      repo?.address || ((rootEvent as any)?.tags ? getTagValue(rootEvent as any, "a") : "");
    return createGitCommentEvent({
      content,
      root: {
        id: rootEvent.id,
        kind: rootEvent.kind?.toString() || "",
        pubkey: rootEvent.pubkey,
        relay: relayHint,
      },
      parent: {
        id: parentComment.rawEvent.id,
        kind: parentComment.rawEvent.kind?.toString() || "1111",
        pubkey: parentComment.rawEvent.pubkey,
        relay: relayHint,
      },
      authorPubkey: currentPubkey,
      repoRefs: repoRefs?.length ? repoRefs : defaultRepoRef ? [defaultRepoRef] : [],
      relayHint,
      extraTags,
    });
  }

  async function submitReplyPayload(parentComment: Comment, payload: RichContentPayload) {
    const content = payload.content.trim();
    if (!content || isSubmitting) return;
    const replyEvent = makeCommentReplyEvent(parentComment, content, (payload.tags || []) as CommentTag[]);
    if (!replyEvent || !onComment) throw new Error("Cannot submit inline reply: missing required props");
    isSubmitting = true;
    try {
      onComment(replyEvent);
      closeInlineReplyComposer();
    } finally {
      isSubmitting = false;
    }
  }

  async function submitReply(parentComment: Comment) {
    try {
      await submitReplyPayload(parentComment, { content: replyContent });
    } catch (error) {
      console.error("[DiffViewer] Failed to submit inline reply:", error);
    }
  }

  async function submitEditedInlineCommentPayload(payload: RichContentPayload) {
    const content = payload.content.trim();
    if (!content || !editingCommentEvent || !onCommentEdited || isSubmitting) return;

    isSubmitting = true;
    try {
      await onCommentEdited(editingCommentEvent, content, payload.tags);
      closeInlineReplyComposer();
    } finally {
      isSubmitting = false;
    }
  }

  async function submitEditedInlineComment() {
    try {
      await submitEditedInlineCommentPayload({ content: replyContent });
    } catch (error) {
      console.error("[DiffViewer] Failed to edit inline comment:", error);
    }
  }

  function startEditingInlineComment(comment: Comment, rootComment: Comment) {
    if (!comment.rawEvent) return;

    editingCommentEvent = comment.rawEvent;
    replyThreadRootId = rootComment.id;
    replyContent = comment.rawEvent.content || comment.content || "";
  }

  async function resolveThread(rootComment: Comment) {
    if (resolvingThreadRootId || !rootComment.id) return;
    const resolveEvent = makeCommentReplyEvent(rootComment, "Resolved", [["l", "resolved"] as CommentTag]);
    if (!resolveEvent || !onComment) return;
    resolvingThreadRootId = rootComment.id;
    try {
      onComment(resolveEvent);
    } finally {
      resolvingThreadRootId = null;
    }
  }
</script>

<div
  class={framed
    ? "git-diff-view relative rounded-md border border-border"
    : "git-diff-view relative"}
  class:select-none={enablePermalinks && (isPointerSelecting || isTouchSelecting)}
  style="border-color: hsl(var(--ng-border));"
  bind:this={diffContainer}
>
  {#if parsed.length === 0}
    <div class="text-muted-foreground italic">No diff to display.</div>
  {/if}
  {#each parsed as file, fileIdx (getFileLabel(file))}
    {@const fileId = getFileLabel(file)}
    {@const filePath = getDiffFilePath(file)}
    {@const isExpanded = showFileHeaders ? expandedFiles.has(fileId) : true}
    <div
      class={showFileHeaders ? (compact ? "mb-3" : "mb-4") : ""}
      id={showFileAnchors && diffAnchors[filePath] ? `diff-${diffAnchors[filePath]}` : undefined}
    >
      {#if showFileHeaders}
        <button
          type="button"
          class={compact
            ? "mb-1 flex w-full items-center rounded px-1.5 py-1 text-left text-sm font-medium hover:bg-muted/50"
            : "font-bold mb-1 flex items-center w-full text-left hover:bg-muted/50 p-1 rounded"}
          onclick={() => {
            const newSet = new Set(expandedFiles);
            if (isExpanded) {
              newSet.delete(fileId);
            } else {
              newSet.add(fileId);
            }
            expandedFiles = newSet;
          }}
          aria-expanded={isExpanded}
          aria-controls={`file-diff-${fileIdx}`}
        >
          {#if isExpanded}
            <ChevronUp class="mr-2 h-4 w-4 shrink-0" />
          {:else}
            <ChevronDown class="mr-2 h-4 w-4 shrink-0" />
          {/if}
          <span>{fileId}</span>
          {#if getFileIsBinary(file)}
            <span class="ml-2 shrink-0 text-xs text-orange-400">[binary]</span>
          {/if}
        </button>
      {/if}
      {#if isExpanded && file.chunks}
        <div id={`file-diff-${fileIdx}`}>
          {#each file.chunks as chunk, chunkIdx}
            <div class={compact ? "mb-1.5" : "mb-2"}>
              {#if "changes" in chunk}
                {@const highlightedChunkLines = highlightCodeLines(
                  chunk.changes.map((change) => change.content),
                  getFileLanguage(filePath)
                )}
                <div
                  class={compact
                    ? "mb-1 px-2 text-[11px] leading-4 text-muted-foreground"
                    : "mb-1 text-xs text-muted-foreground"}
                >
                  {chunk.content}
                </div>
                <div class="divide-y divide-border/60">
                  {#each chunk.changes as change, i}
                    {@const ln = i + 1}
                    {@const currentFilePath = filePath}
                    {@const lineComments = getCommentsForLine(change, currentFilePath)}
                    {@const hasComments = lineComments.length > 0}
                    {@const coveringCommentRoots = getCommentRootsCoveringLine(
                      change,
                      currentFilePath
                    )}
                    {@const coveringCommentCount = coveringCommentRoots.reduce(
                      (count, root) =>
                        count +
                        comments.filter(
                          (comment) =>
                            !comment.isResolveEvent &&
                            (comment.rootInlineId || comment.id) === root.id
                        ).length,
                      0
                    )}
                    {@const isAdd = change.type === "add"}
                    {@const isDel = change.type === "del"}
                    {@const isNormal = change.type === "normal"}
                    {@const language = getFileLanguage(currentFilePath)}
                    {@const leftLine = isDel
                      ? (change.ln ?? null)
                      : isNormal
                        ? (change.ln1 ?? null)
                        : null}
                    {@const rightLine = isAdd
                      ? (change.ln ?? null)
                      : isNormal
                        ? (change.ln2 ?? null)
                        : null}
                    {@const chunkOffset = fileChunkOffsets[fileIdx]?.[chunkIdx] ?? 0}
                    {@const lineIndex = chunkOffset + i}
                    {@const isSelectedLine = isLineWithinSelection(currentFilePath, lineIndex)}
                    {@const isCommentActionLine = isSelectionEndLine(currentFilePath, lineIndex)}
                    {@const isCommentRangeLine = coveringCommentRoots.length > 0}
                    {@const bgClass = isAdd
                      ? compact
                        ? "border-l-2 border-emerald-700 bg-emerald-100/80 text-slate-900 dark:border-emerald-500 dark:bg-emerald-900/50 dark:text-slate-100"
                        : "border-l-4 border-emerald-700 bg-emerald-100/80 text-slate-900 dark:border-emerald-500 dark:bg-emerald-900/50 dark:text-slate-100"
                      : isDel
                        ? compact
                          ? "border-l-2 border-rose-700 bg-rose-100/80 text-slate-900 dark:border-rose-500 dark:bg-rose-900/50 dark:text-slate-100"
                          : "border-l-4 border-rose-700 bg-rose-100/80 text-slate-900 dark:border-rose-500 dark:bg-rose-900/50 dark:text-slate-100"
                        : "hover:bg-secondary/50"}

                    <div class="w-full">
                      <div
                        class={`flex group ${bgClass} ${isSelectedLine ? "diff-selected-row" : ""} ${isCommentRangeLine ? "diff-comment-range-row" : ""} w-full`}
                        style="min-width: max-content;"
                        data-diff-index={lineIndex}
                        data-file-path={currentFilePath}
                        data-line-left={leftLine ?? ""}
                        data-line-right={rightLine ?? ""}
                      >
                        <div class="diff-line-gutter flex shrink-0 text-foreground select-none">
                          {#if canComment}
                            <div class="flex w-5 shrink-0 items-center justify-center sm:w-6">
                              {#if hasComments && coveringCommentCount > 0}
                                <span
                                  class="flex h-4 min-w-4 items-center justify-center gap-0.5 rounded-full bg-blue-500/15 px-1 text-[10px] font-medium text-blue-700 dark:text-blue-300"
                                >
                                  <MessageSquare class="h-2.5 w-2.5" />
                                  {coveringCommentCount}
                                </span>
                              {:else if isCommentRangeLine}
                                <span
                                  class="h-full min-h-5 w-1.5 rounded-full bg-blue-500/55"
                                  aria-hidden="true"
                                ></span>
                              {:else}
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  class={getCommentButtonClass(isCommentActionLine)}
                                  title="Add inline comment"
                                  aria-label="Add inline comment"
                                  onclick={(event) => {
                                    event.stopPropagation();
                                    if (
                                      isSelectedLine &&
                                      getSelectionRange()?.filePath === currentFilePath
                                    ) {
                                      openCommentBoxFromSelection();
                                    } else {
                                      setDiffSelection(currentFilePath, lineIndex, lineIndex);
                                      toggleCommentBox(ln, fileIdx, chunkIdx);
                                    }
                                  }}
                                >
                                  <MessageSquarePlus class={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
                                </Button>
                              {/if}
                            </div>
                          {/if}
                          {#if showLineNumbers}
                            <div
                              class={getLineNumberCellClass(
                                change.type,
                                currentFilePath,
                                lineIndex,
                                leftLine
                              )}
                            >
                              <span
                                class="block cursor-pointer"
                                style="touch-action: none;"
                                id={diffAnchors[currentFilePath] && leftLine
                                  ? `diff-${diffAnchors[currentFilePath]}L${leftLine}`
                                  : undefined}
                              >
                                {leftLine ?? ""}
                              </span>
                            </div>
                            <div
                              class={getLineNumberCellClass(
                                change.type,
                                currentFilePath,
                                lineIndex,
                                rightLine
                              )}
                            >
                              <span
                                class="block cursor-pointer"
                                style="touch-action: none;"
                                id={diffAnchors[currentFilePath] && rightLine
                                  ? `diff-${diffAnchors[currentFilePath]}R${rightLine}`
                                  : undefined}
                              >
                                {rightLine ?? ""}
                              </span>
                            </div>
                          {/if}
                        </div>
                        <div class={getLineContentClass()}>
                          <pre class="whitespace-pre m-0 inline-block align-middle"><span
                              class="hljs"
                              >{@html highlightedChunkLines[i] ??
                                highlightCode(change.content, language)}</span
                            ></pre>
                        </div>
                      </div>

                      {#if hasComments}
                        {@const visibleComments = getVisibleComments(lineComments)}
                        {@const rootComment = getThreadRoot(lineComments)}
                        {@const resolved = isThreadResolved(lineComments)}
                        {@const threadOpen = isInlineThreadOpen(lineComments)}
                        <div
                          class="{getCommentThreadClass()} {resolved ? 'border-green-500/35' : ''}"
                        >
                          <button
                            type="button"
                            class="flex w-full items-center gap-2 border-b border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-left text-xs text-muted-foreground hover:text-foreground {resolved
                              ? 'border-green-500/20 bg-green-500/5'
                              : ''}"
                            onclick={() => toggleInlineThread(lineComments)}
                            aria-expanded={threadOpen}
                          >
                            {#if threadOpen}
                              <ChevronDown
                                class="h-3.5 w-3.5 shrink-0 {resolved
                                  ? 'text-green-500/70'
                                  : 'text-blue-500/70'}"
                              />
                            {:else}
                              <ChevronRight
                                class="h-3.5 w-3.5 shrink-0 {resolved
                                  ? 'text-green-500/70'
                                  : 'text-blue-500/70'}"
                              />
                            {/if}
                            <MessageSquare
                              class="h-3.5 w-3.5 shrink-0 {resolved
                                ? 'text-green-500/70'
                                : 'text-blue-500/70'}"
                            />
                            <span class="min-w-0 flex-1 truncate">
                              {visibleComments.length} comment{visibleComments.length === 1
                                ? ""
                                : "s"} on {getThreadLineLabel(lineComments)}{resolved
                                ? " · resolved"
                                : ""}
                            </span>
                          </button>
                          {#if threadOpen}
                            <div class="space-y-3 px-2 py-3 sm:px-3">
                              {#each visibleComments as c}
                                <div
                                  id={`comment-${c.id}`}
                                  data-event={c.id}
                                  class="flex gap-2 {c.id !== rootComment?.id
                                    ? 'border-l border-blue-500/35 pl-2 sm:ml-3'
                                    : ''}"
                                >
                                  <Avatar class="h-7 w-7 sm:h-8 sm:w-8">
                                    <AvatarImage src={c.author.avatar} alt={c.author.name} />
                                    <AvatarFallback
                                      >{c.author.name.slice(0, 2).toUpperCase()}</AvatarFallback
                                    >
                                  </Avatar>
                                  <div class="min-w-0 flex-1">
                                    <div class="flex min-w-0 items-center gap-1.5 text-xs sm:gap-2">
                                      <span class="truncate font-medium sm:text-sm"
                                        >{c.author.name}</span
                                      >
                                      <span
                                        class="shrink-0 whitespace-nowrap"
                                        style="color: hsl(var(--ng-muted-foreground));"
                                      >
                                        <TimeAgo date={c.createdAt} compact />
                                      </span>
                                      {#if currentPubkey && onCommentEdited && c.rawEvent && canEditComment(c.rawEvent)}
                                        <button
                                          type="button"
                                          class="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                                          onclick={() =>
                                            startEditingInlineComment(c, rootComment || c)}
                                          aria-label="Edit comment"
                                          title="Edit"
                                        >
                                          <Pencil class="h-3.5 w-3.5" />
                                        </button>
                                      {/if}
                                    </div>
                                    <div
                                      class="inline-comment-body mt-1 min-w-0 text-muted-foreground"
                                    >
                                      {#if Markdown}
                                        <Markdown
                                          content={c.content}
                                          event={c.rawEvent as any}
                                          variant="inline"
                                        />
                                      {:else}
                                        <RichText content={c.content} prose={false} />
                                      {/if}
                                    </div>
                                  </div>
                                </div>
                              {/each}
                            </div>
                            {#if (!resolved || editingCommentEvent) && rootComment}
                              {#if replyThreadRootId === rootComment.id}
                                <div class="border-t border-border/40 px-2 py-2 sm:px-3">
                                  {#if RichInlineCommentComposer}
                                    {#key `${editingCommentEvent ? "edit" : "reply"}:${editingCommentEvent?.id || rootComment.id}`}
                                      <RichInlineCommentComposer
                                        initialContent={editingCommentEvent ? replyContent : ""}
                                        placeholder={editingCommentEvent
                                          ? "Edit your comment..."
                                          : "Write a reply..."}
                                        submitLabel={editingCommentEvent ? "Save edit" : "Reply"}
                                        mode={editingCommentEvent ? "edit" : "reply"}
                                        compact={true}
                                        submitting={isSubmitting}
                                        context={inlineComposerContext}
                                        onSubmit={(payload) =>
                                          editingCommentEvent
                                            ? submitEditedInlineCommentPayload(payload)
                                            : submitReplyPayload(
                                                visibleComments[visibleComments.length - 1] ||
                                                  rootComment,
                                                payload
                                              )}
                                        onCancel={closeInlineReplyComposer}
                                        onEscape={closeInlineReplyComposer}
                                      />
                                    {/key}
                                    <div class="mt-2 flex justify-end">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        class="h-8 px-2 text-xs"
                                        onclick={closeInlineReplyComposer}
                                        disabled={isSubmitting}>Cancel</Button
                                      >
                                    </div>
                                  {:else}
                                    <Textarea
                                      bind:value={replyContent}
                                      placeholder={editingCommentEvent
                                        ? "Edit your comment..."
                                        : "Write a reply..."}
                                      class="min-h-[48px] resize-none px-2 py-1.5 text-xs sm:min-h-[60px] sm:text-sm"
                                      disabled={isSubmitting}
                                    />
                                    <div class="mt-2 flex justify-end gap-2">
                                      <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        class="h-8 px-2 text-xs"
                                        onclick={closeInlineReplyComposer}
                                        disabled={isSubmitting}>Cancel</Button
                                      >
                                      <Button
                                        type="button"
                                        size="sm"
                                        class="h-8 px-2 text-xs"
                                        onclick={() =>
                                          editingCommentEvent
                                            ? submitEditedInlineComment()
                                            : submitReply(
                                                visibleComments[visibleComments.length - 1] ||
                                                  rootComment
                                              )}
                                        disabled={!replyContent.trim() || isSubmitting}
                                        >{editingCommentEvent ? "Save edit" : "Reply"}</Button
                                      >
                                    </div>
                                  {/if}
                                </div>
                              {:else}
                                <div
                                  class="flex items-center gap-3 border-t border-border/40 px-3 py-2 text-xs text-muted-foreground"
                                >
                                  <button
                                    type="button"
                                    class="flex items-center gap-1.5 hover:text-foreground"
                                    onclick={() => {
                                      replyThreadRootId = rootComment.id;
                                      editingCommentEvent = null;
                                      replyContent = "";
                                    }}
                                  >
                                    ↩ Reply
                                  </button>
                                  <button
                                    type="button"
                                    class="ml-auto flex items-center gap-1.5 hover:text-green-600 dark:hover:text-green-400"
                                    onclick={() => resolveThread(rootComment)}
                                    disabled={resolvingThreadRootId === rootComment.id}
                                  >
                                    {#if resolvingThreadRootId === rootComment.id}<Loader2
                                        class="h-3.5 w-3.5 animate-spin"
                                      />{:else}✓{/if}
                                    Resolve
                                  </button>
                                </div>
                              {/if}
                            {/if}
                          {/if}
                        </div>
                      {/if}
                      {#if canComment && selectedLine === ln && selectedFileIdx === fileIdx && selectedChunkIdx === chunkIdx}
                        <div class={getCommentComposerClass()}>
                          <div
                            class="flex items-center gap-2 border-b border-blue-500/20 bg-blue-500/5 px-3 py-1.5 text-xs text-muted-foreground"
                          >
                            <ChevronDown class="h-3.5 w-3.5 shrink-0 text-blue-500/70" />
                            <MessageSquare class="h-3.5 w-3.5 shrink-0 text-blue-500/70" />
                            <span class="min-w-0 flex-1 truncate">
                              New comment on {selectedCommentLineRange?.includes("-")
                                ? "lines"
                                : "line"}
                              {selectedCommentLineRange ?? ""}
                            </span>
                            <button
                              type="button"
                              class="text-muted-foreground/50 transition-colors hover:text-muted-foreground"
                              aria-label="Close comment composer"
                              onclick={closeCommentComposer}
                            >
                              <X class="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <div class="px-2 py-2 sm:px-3 sm:py-3">
                            {#if RichInlineCommentComposer}
                              {#key `inline:${currentFilePath}:${selectedCommentLineRange ?? ln}`}
                                <RichInlineCommentComposer
                                  initialContent=""
                                  placeholder="Add a comment..."
                                  submitLabel="Comment"
                                  mode="inline"
                                  compact={true}
                                  submitting={isSubmitting}
                                  context={inlineComposerContext}
                                  onSubmit={(payload) =>
                                    submitCommentPayload(payload, ln, fileIdx, chunkIdx, currentFilePath)}
                                  onCancel={closeCommentComposer}
                                  onEscape={closeCommentComposer}
                                />
                              {/key}
                              <div class="mt-2 flex justify-end">
                                <Button
                                  variant="outline"
                                  size="sm"
                                  class="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
                                  onclick={closeCommentComposer}
                                  disabled={isSubmitting}
                                >
                                  Cancel
                                </Button>
                              </div>
                            {:else}
                              <div class="flex gap-2">
                                <Avatar class="hidden h-8 w-8 sm:flex">
                                  <AvatarFallback>ME</AvatarFallback>
                                </Avatar>
                                <div class="min-w-0 flex-1 space-y-2">
                                  <Textarea
                                    bind:value={newComment}
                                    placeholder="Add a comment..."
                                    class={compact
                                      ? "min-h-[44px] resize-none px-2 py-1.5 text-xs sm:text-sm"
                                      : "min-h-[48px] resize-none px-2 py-1.5 text-xs sm:min-h-[60px] sm:text-sm"}
                                    disabled={isSubmitting}
                                  />
                                  <div class="flex justify-end gap-1.5 sm:gap-2">
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      class="h-8 px-2 text-xs sm:h-9 sm:px-3 sm:text-sm"
                                      onclick={closeCommentComposer}
                                      disabled={isSubmitting}
                                    >
                                      Cancel
                                    </Button>
                                    <Button
                                      size="sm"
                                      class="h-8 gap-1 bg-git px-2 text-xs hover:bg-git-hover sm:h-9 sm:px-3 sm:text-sm"
                                      disabled={!newComment.trim() ||
                                        isSubmitting ||
                                        !rootEvent ||
                                        !onComment ||
                                        !currentPubkey}
                                      onclick={() =>
                                        submitComment(ln, fileIdx, chunkIdx, currentFilePath)}
                                    >
                                      {#if isSubmitting}
                                        <Loader2 class="h-3 w-3 animate-spin sm:h-3.5 sm:w-3.5" />
                                      {:else}
                                        <MessageSquare class="h-3 w-3 sm:h-3.5 sm:w-3.5" />
                                      {/if}
                                      Comment
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              {:else}
                <div class="text-xs text-muted-foreground italic">(Non-text chunk)</div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/each}
  {#if enablePermalinks && showPermalinkMenu}
    {@const selection = getSelectionRange()}
    {@const anchorRange = selection ? getRightAnchorRange(selection) : null}
    <div
      class="permalink-menu-popup absolute z-20 w-48 rounded border bg-popover text-popover-foreground shadow-md"
      style="left: {permalinkMenuX}px; top: {permalinkMenuY}px; border-color: hsl(var(--ng-border));"
    >
      <button class="w-full text-left px-3 py-2 hover:bg-secondary/50" onclick={copyLinkToLines}>
        Copy link to {anchorRange
          ? anchorRange.start === anchorRange.end
            ? `line ${anchorRange.start}`
            : `lines ${anchorRange.start}-${anchorRange.end}`
          : "file"}
      </button>
      <button class="w-full text-left px-3 py-2 hover:bg-secondary/50" onclick={createPermalink}>
        Create permalink
      </button>
    </div>
  {/if}
</div>

<style>
  pre {
    margin: 0;
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  }

  .inline-comment-body {
    max-width: 100%;
    overflow-wrap: anywhere;
    word-break: normal;
    font-size: 0.75rem;
    line-height: 1.35;
  }

  .inline-comment-body :global(*) {
    max-width: 100%;
    overflow-wrap: anywhere;
  }

  @media (min-width: 640px) {
    .inline-comment-body {
      font-size: 0.875rem;
      line-height: 1.5;
    }
  }

  :global(.diff-selected-row) {
    outline: 1px solid rgb(37 99 235 / 0.18);
    outline-offset: -1px;
    box-shadow: inset 0 0 0 9999px rgb(59 130 246 / 0.035);
  }

  :global(.diff-comment-range-row) {
    outline: 1px solid rgb(59 130 246 / 0.3);
    outline-offset: -1px;
  }

  :global(.diff-selected-gutter) {
    background: linear-gradient(
      90deg,
      rgb(37 99 235 / 0.14) 0%,
      rgb(59 130 246 / 0.07) 100%
    ) !important;
    color: rgb(37 99 235) !important;
    font-weight: 700;
    box-shadow:
      inset -2px 0 0 rgb(37 99 235 / 0.42),
      inset 0 1px 0 rgb(96 165 250 / 0.24),
      inset 0 -1px 0 rgb(37 99 235 / 0.14);
  }

  :global(.diff-selected-gutter-start) {
    box-shadow:
      inset -2px 0 0 rgb(59 130 246 / 0.85),
      inset 0 1px 0 rgb(147 197 253 / 0.42),
      inset 0 -1px 0 rgb(37 99 235 / 0.14);
  }

  :global(.diff-selected-gutter-end) {
    box-shadow:
      inset -2px 0 0 rgb(59 130 246 / 0.85),
      inset 0 1px 0 rgb(37 99 235 / 0.14),
      inset 0 -1px 0 rgb(147 197 253 / 0.42);
  }

  :global(body:not(.dark):not([data-theme="dark"]) .git-diff-view .hljs span[class]) {
    filter: brightness(0.7) saturate(1.5) contrast(1.2);
  }

  :global(.diff-comment-blip) {
    animation: diff-comment-blip 1.55s ease-in-out 2;
  }

  @keyframes diff-comment-blip {
    0%,
    100% {
      box-shadow: none;
    }
    35% {
      box-shadow:
        0 0 0 2px rgb(59 130 246 / 0.5),
        0 0 0 8px rgb(59 130 246 / 0.16);
    }
  }

  @media (pointer: coarse) {
    :global(.git-diff-view) {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
  }
</style>
