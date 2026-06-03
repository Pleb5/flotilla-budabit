<script lang="ts">
  import { Plus, Minus } from "@lucide/svelte";
  import { toast } from "../../stores/toast.js";
  import { tick } from "svelte";
  import { toUserMessage } from "../../utils/gitErrorUi.js";
  import {
    getHighlightLanguageForPath,
    highlightCodeLines,
    highlightCodeSnippet,
  } from "../../utils/codeHighlight";
  import { GIT_PERMALINK, type PermalinkEvent } from "@nostr-git/core/types";
  import { githubPermalinkDiffId } from "@nostr-git/core/git";
  import type { Repo } from "./Repo.svelte";

  interface Hunk {
    oldStart: number;
    oldLines: number;
    newStart: number;
    newLines: number;
    patches: Array<{ line: string; type: "+" | "-" | " " }>;
  }

  interface Props {
    hunks: Hunk[];
    filepath?: string;
    repo?: Repo;
    publish?: (permalink: PermalinkEvent) => Promise<void | boolean>;
    commitSha?: string;
    parentSha?: string;
  }

  let { hunks, filepath, repo, publish, commitSha, parentSha }: Props = $props();

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
  const LONG_PRESS_MS = 300;
  const TOUCH_MOVE_THRESHOLD = 8;
  const AUTO_SCROLL_THRESHOLD = 36;
  const AUTO_SCROLL_STEP = 24;
  const MENU_WIDTH = 192;
  const MENU_PADDING = 8;
  let diffAnchor = $state("");

  const pushErrorToast = (title: string, err: unknown, fallback?: string) => {
    const { message, theme } = toUserMessage(err, fallback ?? title);
    toast.push({
      title,
      description: message,
      variant: theme === "warning" ? "default" : "destructive",
    });
  };

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
    const path = filepath;
    if (!path) {
      diffAnchor = "";
      return;
    }
    let cancelled = false;
    githubPermalinkDiffId(path)
      .then((hash) => {
        if (!cancelled) diffAnchor = hash;
      })
      .catch(() => {
        if (!cancelled) diffAnchor = "";
      });
    return () => {
      cancelled = true;
    };
  });

  const hunkOffsets = $derived.by(() => {
    let offset = 0;
    return hunks.map((hunk) => {
      const start = offset;
      offset += hunk.patches.length;
      return start;
    });
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
      el.scrollIntoView({ block: align, behavior: "smooth" });
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

  const scrollToDiffAnchor = async () => {
    if (!diffContainer || !diffAnchor) return;
    const anchor = getDiffAnchorFromLocation();
    if (!anchor) return;
    const lineAnchor = parseDiffLineAnchor(anchor);
    if (lineAnchor && lineAnchor.hash === diffAnchor) {
      await tick();
      const lineTarget = await waitForDiffLineTarget(
        `diff-${diffAnchor}${lineAnchor.side}${lineAnchor.start}`
      );
      if (lineTarget.scrollTarget) {
        await stabilizeScrollToTarget(
          () =>
            getDiffLineTarget(`diff-${diffAnchor}${lineAnchor.side}${lineAnchor.start}`)
              .scrollTarget,
          "center"
        );
        const startIndex = Number(lineTarget.lineRow?.dataset.diffIndex || "");
        const startPath = lineTarget.lineRow?.dataset.filePath || filepath || null;
        let endIndex = startIndex;
        if (lineAnchor.end) {
          const endTarget = await waitForDiffLineTarget(
            `diff-${diffAnchor}${lineAnchor.side}${lineAnchor.end}`
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
    const el = document.getElementById(`diff-${diffAnchor}`);
    if (el) {
      await stabilizeScrollToTarget(
        () => document.getElementById(`diff-${diffAnchor}`) as HTMLElement | null,
        "start"
      );
    }
  };

  $effect(() => {
    const anchor = diffAnchor;
    const container = diffContainer;
    hunks.length;
    if (!anchor || !container) return;
    void scrollToDiffAnchor();
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    const handler = () => void scrollToDiffAnchor();
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  });

  $effect(() => {
    const container = diffContainer;
    if (!container || typeof window === "undefined") return;
    const handleSelectionChange = () => {
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

    const handlePointerDown = (e: PointerEvent) => {
      lastInputWasTouch = e.pointerType === "touch";
      if (e.pointerType === "touch") return;
      if (e.button !== 0) return;
      const target = e.target as HTMLElement;
      if (!container.contains(target) || shouldIgnoreSelectionTarget(target)) return;
      const hit = getLineFromPoint(e.clientX, e.clientY);
      if (!hit) return;
      showPermalinkMenu = false;
      clearDomSelection();
      pointerId = e.pointerId;
      pointerStartFilePath = hit.filePath;
      pointerStartIndex = hit.index;
      isPointerSelecting = true;
      pointerDragged = false;
      setDiffSelection(hit.filePath, hit.index, hit.index);
      container.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
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

      if (!dragged) return;
      ignoreMenuCloseUntil = Date.now() + 300;
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
      pointerDragged = false;
      stopAutoScroll();
    };

    const handleTouchStart = (e: TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!container.contains(target) || shouldIgnoreSelectionTarget(target)) return;
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
      clearTouchTimer();
      touchTimer = window.setTimeout(() => {
        touchLongPress = true;
        const hit = getLineFromPoint(touchStartX, touchStartY);
        if (!hit) return;
        showPermalinkMenu = false;
        clearDomSelection();
        isTouchSelecting = true;
        touchStartFilePath = hit.filePath;
        touchStartIndex = hit.index;
        setDiffSelection(hit.filePath, hit.index, hit.index);
        updateAutoScroll(touchStartX, touchStartY);
      }, LONG_PRESS_MS);
    };

    const handleTouchMove = (e: TouchEvent) => {
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
    };

    const handleTouchCancel = () => {
      clearTouchTimer();
      touchIdentifier = null;
      touchLongPress = false;
      touchMoved = false;
      isTouchSelecting = false;
      touchStartFilePath = null;
      touchStartIndex = null;
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

  // Calculate line numbers for display
  const calculateLineNumbers = (hunk: Hunk) => {
    const lines: Array<{
      oldLineNum: number | null;
      newLineNum: number | null;
      content: string;
      type: "+" | "-" | " ";
    }> = [];

    let oldLineNum = hunk.oldStart;
    let newLineNum = hunk.newStart;

    for (const patch of hunk.patches) {
      if (patch.type === "+") {
        lines.push({
          oldLineNum: null,
          newLineNum: newLineNum,
          content: patch.line,
          type: patch.type,
        });
        newLineNum++;
      } else if (patch.type === "-") {
        lines.push({
          oldLineNum: oldLineNum,
          newLineNum: null,
          content: patch.line,
          type: patch.type,
        });
        oldLineNum++;
      } else {
        lines.push({
          oldLineNum: oldLineNum,
          newLineNum: newLineNum,
          content: patch.line,
          type: patch.type,
        });
        oldLineNum++;
        newLineNum++;
      }
    }

    return lines;
  };

  // Get line type styling
  const getLineClass = (type: "+" | "-" | " ") => {
    switch (type) {
      case "+":
        return "bg-emerald-200/70 border-l-2 border-l-emerald-600 dark:bg-emerald-900/50";
      case "-":
        return "bg-rose-200/70 border-l-2 border-l-rose-600 dark:bg-rose-900/50";
      default:
        return "bg-background";
    }
  };

  // Get line number styling
  const getLineNumClass = (type: "+" | "-" | " ") => {
    switch (type) {
      case "+":
        return "bg-emerald-300 text-emerald-950 dark:bg-emerald-800/70 dark:text-emerald-100";
      case "-":
        return "bg-rose-300 text-rose-950 dark:bg-rose-800/70 dark:text-rose-100";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getLineNumberCellClass = (
    type: "+" | "-" | " ",
    filePath: string,
    lineIndex: number,
    lineNumber: number | null
  ) =>
    `w-10 px-1 py-1 text-right text-[10px] font-mono sm:w-12 sm:px-2 sm:text-xs border-r border-border ${getLineNumClass(
      type
    )} ${getSelectedGutterClass(filePath, lineIndex, lineNumber)}`.trim();

  const getFileLanguage = (path: string): string => getHighlightLanguageForPath(path);

  const highlightCode = (content: string, language: string): string =>
    highlightCodeSnippet(content, language);

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

  function shouldIgnoreSelectionTarget(target: HTMLElement | null) {
    if (!target) return true;
    return !!target.closest(
      ".permalink-menu-popup, button, a, input, textarea, select, option, summary, [role='button'], [contenteditable='true']"
    );
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

  function getSelectionContent(selection: DiffSelection): string {
    const lines: string[] = [];
    let index = 0;
    for (const hunk of hunks) {
      const hunkLines = calculateLineNumbers(hunk);
      for (const line of hunkLines) {
        if (index >= selection.start && index <= selection.end) {
          const prefix = line.type === " " ? " " : line.type;
          lines.push(`${prefix}${line.content}`);
        }
        index += 1;
      }
    }
    return lines.join("\n");
  }

  function getRightAnchorRange(selection: DiffSelection): { start: number; end: number } | null {
    const rightLines: number[] = [];
    let index = 0;
    for (const hunk of hunks) {
      const hunkLines = calculateLineNumbers(hunk);
      for (const line of hunkLines) {
        if (index >= selection.start && index <= selection.end) {
          const lineNumber = line.newLineNum;
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

    const commitTag = commitSha || "";
    const parentCommitTag = parentSha || "";

    if (commitTag) {
      tags.push(["commit", commitTag]);
      const ref = (repo.refs || []).find((r) => r.type === "heads" && r.commitId === commitTag);
      if (ref?.name) tags.push([`refs/heads/${ref.name}`, commitTag]);
    }
    if (parentCommitTag) tags.push(["parent-commit", parentCommitTag]);

    if (selection.filePath) tags.push(["file", selection.filePath]);
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
    } catch (e) {
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
</script>

{#if hunks.length === 0}
  <div class="p-4 text-center text-muted-foreground">No changes to display</div>
{:else}
  <div
    class="split-diff-view min-w-fit rounded-md border border-border relative"
    class:select-none={isPointerSelecting || isTouchSelecting}
    bind:this={diffContainer}
    id={diffAnchor ? `diff-${diffAnchor}` : undefined}
  >
    {#each hunks as hunk, hunkIndex}
      {@const lines = calculateLineNumbers(hunk)}
      {@const language = getFileLanguage(filepath || "")}
      {@const highlightedLines = highlightCodeLines(
        lines.map((line) => line.content),
        language
      )}

      <!-- Hunk Header -->
      <div
        class="bg-muted px-4 py-2 text-sm font-mono text-muted-foreground border-b border-border whitespace-nowrap"
      >
        @@
        {#if hunk.oldLines > 0}
          -{hunk.oldStart},{hunk.oldLines}
        {:else}
          -{hunk.oldStart}
        {/if}
        {#if hunk.newLines > 0}
          +{hunk.newStart},{hunk.newLines}
        {:else}
          +{hunk.newStart}
        {/if}
        @@
        {#if filepath}
          <span class="ml-2 text-foreground">{filepath}</span>
        {/if}
      </div>

      <!-- Diff Lines -->
      <div class="divide-y divide-border">
        {#each lines as line, lineIndex}
          {@const hunkOffset = hunkOffsets[hunkIndex] ?? 0}
          {@const globalIndex = hunkOffset + lineIndex}
          <div
            class={`flex ${getLineClass(line.type)}`}
            data-diff-index={globalIndex}
            data-file-path={filepath || "unknown"}
            data-line-left={line.oldLineNum ?? ""}
            data-line-right={line.newLineNum ?? ""}
          >
            <!-- Line Numbers -->
            <div class="flex shrink-0">
              <!-- Old Line Number -->
              <div
                class={getLineNumberCellClass(
                  line.type,
                  filepath || "unknown",
                  globalIndex,
                  line.oldLineNum
                )}
              >
                <span
                  class="block cursor-pointer"
                  style="touch-action: none;"
                  id={diffAnchor && line.oldLineNum
                    ? `diff-${diffAnchor}L${line.oldLineNum}`
                    : undefined}
                >
                  {line.oldLineNum || ""}
                </span>
              </div>
              <!-- New Line Number -->
              <div
                class={getLineNumberCellClass(
                  line.type,
                  filepath || "unknown",
                  globalIndex,
                  line.newLineNum
                )}
              >
                <span
                  class="block cursor-pointer"
                  style="touch-action: none;"
                  id={diffAnchor && line.newLineNum
                    ? `diff-${diffAnchor}R${line.newLineNum}`
                    : undefined}
                >
                  {line.newLineNum || ""}
                </span>
              </div>
            </div>

            <!-- Change Indicator -->
            <div
              class="hidden w-6 px-1 py-1 text-center text-xs font-mono shrink-0 sm:block {getLineNumClass(
                line.type
              )} border-r border-border"
            >
              {#if line.type === "+"}
                <Plus class="h-3 w-3 mx-auto text-emerald-700 dark:text-emerald-300" />
              {:else if line.type === "-"}
                <Minus class="h-3 w-3 mx-auto text-rose-700 dark:text-rose-300" />
              {:else}
                <span class="text-muted-foreground"> </span>
              {/if}
            </div>

            <!-- Line Content -->
            <div class="flex-1 px-1 py-1 font-mono text-sm whitespace-nowrap sm:px-2">
              <pre class="whitespace-pre m-0 inline"><span class="hljs"
                  >{@html highlightedLines[lineIndex] ??
                    highlightCode(line.content, language)}</span
                ></pre>
            </div>
          </div>
        {/each}
      </div>

      <!-- Hunk Separator -->
      {#if hunkIndex < hunks.length - 1}
        <div class="h-2 bg-muted border-t border-border"></div>
      {/if}
    {/each}
    {#if showPermalinkMenu}
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
{/if}

<style>
  /* Ensure code content doesn't break layout */
  pre {
    margin: 0;
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  }

  /* Custom scrollbar for horizontal overflow */
  .overflow-x-auto::-webkit-scrollbar {
    height: 6px;
  }

  .overflow-x-auto::-webkit-scrollbar-track {
    background: transparent;
  }

  .overflow-x-auto::-webkit-scrollbar-thumb {
    background-color: hsl(var(--ng-muted-foreground) / 0.35);
    border-radius: 3px;
  }

  .overflow-x-auto::-webkit-scrollbar-thumb:hover {
    background-color: hsl(var(--ng-muted-foreground) / 0.55);
  }

  :global(.diff-selected-gutter) {
    background: linear-gradient(
      90deg,
      rgb(245 158 11 / 0.52) 0%,
      rgb(251 191 36 / 0.3) 100%
    ) !important;
    color: rgb(255 251 235) !important;
    font-weight: 700;
    text-shadow: 0 0 10px rgb(251 191 36 / 0.28);
    box-shadow:
      inset -3px 0 0 rgb(251 191 36 / 0.98),
      inset 0 1px 0 rgb(253 224 71 / 0.55),
      inset 0 -1px 0 rgb(245 158 11 / 0.45),
      inset 0 0 0 1px rgb(245 158 11 / 0.55);
  }

  :global(.diff-selected-gutter-start) {
    box-shadow:
      inset -3px 0 0 rgb(251 191 36 / 1),
      inset 0 1px 0 rgb(254 240 138 / 0.95),
      inset 0 -1px 0 rgb(245 158 11 / 0.45),
      inset 0 0 0 1px rgb(245 158 11 / 0.6);
  }

  :global(.diff-selected-gutter-end) {
    box-shadow:
      inset -3px 0 0 rgb(251 191 36 / 1),
      inset 0 1px 0 rgb(245 158 11 / 0.45),
      inset 0 -1px 0 rgb(254 240 138 / 0.95),
      inset 0 0 0 1px rgb(245 158 11 / 0.6);
  }

  @media (pointer: coarse) {
    :global(.split-diff-view) {
      -webkit-user-select: none;
      user-select: none;
      -webkit-touch-callout: none;
    }
  }
</style>
