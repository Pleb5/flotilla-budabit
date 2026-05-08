<script lang="ts">
  import {
    FileCode,
    Folder,
    Download,
    Copy,
    Info,
    MoreVertical,
    ChevronLeft,
  } from "@lucide/svelte";
  import { tick } from "svelte";
  import { useRegistry } from "../../useRegistry.js";
  const { Button, Spinner } = useRegistry();
  import { toast } from "../../stores/toast.js";
  import { toUserMessage } from "../../utils/gitErrorUi";
  import type { FileEntry, PermalinkEvent } from "@nostr-git/core/types";
  import { GIT_PERMALINK } from "@nostr-git/core/types";
  import type { Repo } from "./Repo.svelte";
  import CodeMirror from "svelte-codemirror-editor";
  import { oneDark } from "@codemirror/theme-one-dark";
  import { detectFileType, type FileTypeInfo } from "../../utils/fileTypeDetection.js";
  import FileMetadataPanel from "./FileMetadataPanel.svelte";
  import {
    ImageViewer,
    PDFViewer,
    VideoViewer,
    AudioViewer,
    BinaryViewer,
  } from "./viewers/index.js";
  import { drawSelection, lineNumbers, EditorView } from "@codemirror/view";
  import { EditorSelection, EditorState } from "@codemirror/state";
  import { nip19 } from "nostr-tools";
  import { normalizeGitRefName } from "./branch-ref";
  import { loadCodeMirrorLanguageExtensions } from "../../utils/codeHighlight";
  import {
    buildSelectionHash,
    replaceSelectionHashWithoutScroll,
    selectedLineField,
    setSelectedLineEffect,
  } from "./file-view-selection";

  const {
    file,
    getFileContent,
    setDirectory,
    repo,
    publish,
    editable,
    autoOpenPath,
    displayMode = "inline",
    onSelectFile,
    onClose,
    showActions = true,
    isActive = false,
  }: {
    file: FileEntry;
    getFileContent: (path: string) => Promise<string>;
    setDirectory: (path: string) => void;
    repo?: Repo;
    publish?: (permalink: PermalinkEvent) => Promise<void>;
    editable?: boolean;
    autoOpenPath?: string;
    displayMode?: "inline" | "list" | "viewer";
    onSelectFile?: (file: FileEntry) => void;
    onClose?: () => void;
    showActions?: boolean;
    isActive?: boolean;
  } = $props();

  const effectiveEditable = $derived.by(() =>
    typeof editable === "boolean" ? editable : (repo?.editable ?? false)
  );

  const pushErrorToast = (title: string, err: unknown, fallback?: string) => {
    const { message, theme } = toUserMessage(err, fallback ?? title);
    toast.push({
      title,
      description: message,
      variant: theme === "warning" ? "default" : "destructive",
    });
  };

  const name = $derived(file.name);
  const type = $derived((file.type ?? "file") as string);
  const path = $derived(file.path);
  const isList = $derived(displayMode === "list");
  const isViewer = $derived(displayMode === "viewer");
  const isInline = $derived(displayMode === "inline");
  const shouldAutoOpen = $derived(!!autoOpenPath && autoOpenPath === path);
  const instanceId = Math.random().toString(36).substring(7);
  let content = $state("");
  let isExpanded = $derived(isViewer);
  let isMetadataPanelOpen = $state(false);
  let isLoading = $state(false);
  let showFileMenu = $state(false);

  let fileTypeInfo = $state<FileTypeInfo | null>(null);
  let metadata = $state<Record<string, string>>({});
  let selectedStart: number | null = $state(null);
  let selectedEnd: number | null = $state(null);
  let cmExtensions: any[] = $state([]);
  let editorHost: HTMLElement | null = $state(null);
  let editorView: EditorView | null = $state(null);
  // Gutter context menu state (positioned near click)
  let showGutterMenu = $state(false);
  let gutterMenuX = $state(0);
  let gutterMenuY = $state(0);
  let ignoreMenuCloseUntil = $state(0);
  let touchIdentifier = $state<number | null>(null);
  let lastInputWasTouch = $state(false);
  let isPointerSelecting = $state(false);
  let pointerStartLine: number | null = $state(null);
  let pointerId: number | null = $state(null);
  let touchLongPressTimer: number | null = $state(null);
  let touchStartX = $state(0);
  let touchStartY = $state(0);
  let touchStartLine: number | null = $state(null);
  let isTouchSelecting = $state(false);
  let selectionScrollParent: HTMLElement | null = $state(null);
  let autoScrollFrame: number | null = null;
  let domHighlightFrame: number | null = null;
  let autoScrollClientY = 0;
  let autoScrollClientX = 0;
  let autoScrollActive = false;

  let hasAutoOpened = $state(false);
  let lastAppliedHash = $state<string | null>(null);

  let hasLoadedOnce = false;
  let fileViewElement: HTMLElement | null = $state(null);
  let lastFilePath = $derived(path);
  const LONG_PRESS_MS = 300;
  const TOUCH_MOVE_THRESHOLD = 8;
  const AUTO_SCROLL_THRESHOLD = 36;
  const AUTO_SCROLL_STEP = 24;
  const MENU_WIDTH = 176;
  const MENU_PADDING = 8;
  const viewerExtensions = [
    oneDark,
    selectedLineField,
    drawSelection(),
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.contentAttributes.of({
      inputmode: "none",
      autocapitalize: "off",
      autocomplete: "off",
      autocorrect: "off",
      spellcheck: "false",
    }),
    EditorView.domEventHandlers({
      beforeinput: (event) => {
        event.preventDefault();
        return true;
      },
      input: (event) => {
        event.preventDefault();
        return true;
      },
      paste: (event) => {
        event.preventDefault();
        return true;
      },
      cut: (event) => {
        event.preventDefault();
        return true;
      },
      drop: (event) => {
        event.preventDefault();
        return true;
      },
      dragstart: (event) => {
        event.preventDefault();
        return true;
      },
      dragover: (event) => {
        event.preventDefault();
        return true;
      },
    }),
    EditorView.updateListener.of((update) => {
      if (update.viewportChanged || update.selectionSet || update.docChanged) {
        queueDomSelectionHighlight();
      }
    }),
  ];

  $effect(() => {
    if (path === lastFilePath) return;
    lastFilePath = path;
    content = "";
    fileTypeInfo = null;
    metadata = {};
    selectedStart = null;
    selectedEnd = null;
    cmExtensions = [];
    showGutterMenu = false;
    showFileMenu = false;
    lastAppliedHash = null;
    hasLoadedOnce = false;
  });

  $effect(() => {
    if (isViewer && !isExpanded) {
      isExpanded = true;
    }
  });

  function handleEditorReady(view: EditorView) {
    editorView = view;
    void applyHashSelection();
  }

  const containerClass = $derived.by(() => {
    if (isList) return "file-view border-b border-border last:border-b-0";
    if (isViewer) return "file-view rounded-lg border border-border";
    return "file-view mb-2 rounded-lg border border-border";
  });

  const headerClass = $derived.by(() => {
    const base =
      "flex items-center justify-between gap-3 px-3 py-2 text-sm sm:text-[0.95rem] transition-colors";
    const interactive = isViewer ? "cursor-default" : "cursor-pointer hover:bg-secondary/30";
    const active = isActive ? "bg-secondary/40" : "";
    return `${base} ${interactive} ${active}`.trim();
  });

  const fileTypeBadge = $derived.by(() => {
    const language = fileTypeInfo?.language;
    if (type === "file" && language && language !== "text") {
      return language;
    }

    return fileTypeInfo?.category || "";
  });

  function handleRowActivate() {
    if (isViewer) return;
    if (type === "directory") {
      if (isList) {
        setDirectory(path);
        return;
      }
    }
    if (type === "file" && isList) {
      onSelectFile?.(file);
      return;
    }
    isExpanded = !isExpanded;
  }

  function handleClose(event?: MouseEvent) {
    event?.stopPropagation();
    onClose?.();
  }

  function toggleFileMenu(event?: MouseEvent) {
    event?.stopPropagation();
    showGutterMenu = false;
    refreshSelectionFromEditor();
    showFileMenu = !showFileMenu;
  }

  $effect(() => {
    if (isExpanded && type === "file") {
      // Clear selection only when FIRST opening a file, not on every re-render
      if (!hasLoadedOnce) {
        console.log(`[${instanceId}:${path}] file expanded for first time, clearing selection`);
        selectedStart = null;
        selectedEnd = null;
        hasLoadedOnce = true;

        // Scroll to the top of this file view
        if (fileViewElement && !isViewer) {
          fileViewElement.scrollIntoView({ behavior: "smooth", block: "start" });
        }
      }

      if (!content) {
        isLoading = true;
        const fileIdentifier = path || name;
        getFileContent(path)
          .then(async (c) => {
            fileTypeInfo = detectFileType(fileIdentifier, c);
            await loadLanguageExtension(fileIdentifier, fileTypeInfo);

            content = c;
            isLoading = false;
          })
          .catch((error) => {
            pushErrorToast("Failed to load file content", error, "Failed to load file content");
          })
          .finally(() => {
            isLoading = false;
          });
      }
    } else if (isExpanded && type === "directory") {
      content = "";
      setDirectory(path);
    }
  });

  $effect(() => {
    if (!shouldAutoOpen || hasAutoOpened || type !== "file") return;
    if (isList) {
      onSelectFile?.(file);
      hasAutoOpened = true;
      return;
    }
    isExpanded = true;
    hasAutoOpened = true;
  });

  function parseLineHash(hash: string): { start: number; end: number } | null {
    const match = hash.match(/^#L(\d+)(?:-L(\d+))?$/);
    if (!match) return null;
    const start = Number.parseInt(match[1], 10);
    const end = match[2] ? Number.parseInt(match[2], 10) : start;
    if (Number.isNaN(start) || Number.isNaN(end)) return null;
    return { start, end };
  }

  const nextFrame = () =>
    new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });

  function canFocusEditor() {
    return !!editorHost && editorHost.getClientRects().length > 0;
  }

  function scrollLineIntoView(lineNumber: number) {
    if (editorView) {
      const maxLine = editorView.state.doc.lines;
      const safeLine = Math.max(1, Math.min(lineNumber, maxLine));
      const line = editorView.state.doc.line(safeLine);
      const scroller = editorView.scrollDOM;
      const scrollLeft = scroller.scrollLeft;

      editorView.dispatch({
        effects: EditorView.scrollIntoView(line.from, { y: "center" }),
      });

      requestAnimationFrame(() => {
        scroller.scrollLeft = scrollLeft;
      });

      return true;
    }

    if (!editorHost) return false;
    const lines = Array.from(editorHost.querySelectorAll(".cm-line")) as HTMLElement[];
    const idx = lineNumber - 1;
    const lineEl = lines[idx];
    if (!lineEl) return false;
    lineEl.scrollIntoView({ block: "center" });
    return true;
  }

  async function revealLineSelection(startLine: number, endLine: number) {
    const start = Math.min(startLine, endLine);
    const end = Math.max(startLine, endLine);
    selectedStart = start;
    selectedEnd = end;

    if (editorView) {
      const maxLine = editorView.state.doc.lines;
      const safeStart = Math.max(1, Math.min(start, maxLine));
      const safeEnd = Math.max(1, Math.min(end, maxLine));
      const startPos = editorView.state.doc.line(safeStart).from;
      const endPos = editorView.state.doc.line(safeEnd).to;
      const scroller = editorView.scrollDOM;
      const scrollLeft = scroller.scrollLeft;

      editorView.dispatch({
        selection: EditorSelection.single(startPos, endPos),
        effects: [
          setSelectedLineEffect.of({ start: safeStart, end: safeEnd }),
          EditorView.scrollIntoView(startPos, { y: "center" }),
        ],
      });

      if (canFocusEditor()) editorView.focus();
      await nextFrame();
      scroller.scrollLeft = scrollLeft;
      queueDomSelectionHighlight();
      await nextFrame();
      if (canFocusEditor()) editorView.focus();
      queueDomSelectionHighlight();
      return true;
    }

    setLineSelection(start, end);
    const didScroll = scrollLineIntoView(start);
    await nextFrame();
    queueDomSelectionHighlight();
    return didScroll;
  }

  async function restorePersistedSelection() {
    if (!editorView || !selectedStart || !selectedEnd) return;
    await tick();
    await nextFrame();
    syncEditorLineHighlight();
    if (canFocusEditor()) editorView.focus();
    await nextFrame();
    queueDomSelectionHighlight();
  }

  $effect(() => {
    const host = editorHost;
    if (!host) return;
    void content;
    const scroller = host.querySelector(".cm-scroller") as HTMLElement | null;
    selectionScrollParent =
      scroller && scroller.scrollHeight > scroller.clientHeight
        ? scroller
        : findSelectionScrollParent(host);
  });

  async function applyHashSelection() {
    if (!shouldAutoOpen || !isExpanded || !editorHost || !content) return;
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!hash || hash === lastAppliedHash) return;
    const parsed = parseLineHash(hash);
    if (!parsed) return;
    await tick();
    if (await revealLineSelection(parsed.start, parsed.end)) {
      lastAppliedHash = hash;
    }
  }

  $effect(() => {
    if (!shouldAutoOpen || !isExpanded || !editorHost || !content) return;
    void editorView;
    void applyHashSelection();
  });

  $effect(() => {
    void cmExtensions;
    void restorePersistedSelection();
  });

  $effect(() => {
    void editorView;
    void selectedStart;
    void selectedEnd;
    syncEditorLineHighlight();
  });

  // Update URL hash from current selection when user selects lines
  function syncHashFromSelection() {
    console.log(
      `[${instanceId}:${path}] syncHash called, start=${selectedStart}, end=${selectedEnd}, current hash=${location.hash}`
    );
    if (selectedStart) {
      const hash = buildSelectionHash(selectedStart, selectedEnd);
      if (location.hash !== hash) {
        console.log(`[${instanceId}:${path}] updating hash from ${location.hash} to ${hash}`);
        replaceSelectionHashWithoutScroll(hash);
        lastAppliedHash = hash;
        console.log(`[${instanceId}:${path}] hash is now ${location.hash}`);
      }
    }
  }

  // Get line numbers from browser's text selection
  function getLinesFromSelection(): { start: number; end: number } | null {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0);
    if (range.collapsed) return null;

    // startContainer/endContainer can be text nodes, so we need to get their parent element
    const getLineElement = (node: Node): HTMLElement | null => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        return (node as HTMLElement).closest(".cm-line");
      } else if (node.parentElement) {
        return node.parentElement.closest(".cm-line");
      }
      return null;
    };

    const startLine = getLineElement(range.startContainer);
    const endLine = getLineElement(range.endContainer);

    if (!startLine || !endLine) return null;

    // Get all lines in the editor
    const allLines = Array.from(editorHost!.querySelectorAll(".cm-line")) as HTMLElement[];
    const startIdx = allLines.indexOf(startLine);
    const endIdx = allLines.indexOf(endLine);

    if (startIdx === -1 || endIdx === -1) return null;

    // Convert to 1-based line numbers
    return {
      start: Math.min(startIdx, endIdx) + 1,
      end: Math.max(startIdx, endIdx) + 1,
    };
  }

  function refreshSelectionFromEditor(): boolean {
    if (!editorHost) return false;
    if (editorView) {
      const selection = editorView.state.selection.main;
      if (!selection || selection.empty) return false;
      const startLine = editorView.state.doc.lineAt(selection.from).number;
      const endLine = editorView.state.doc.lineAt(selection.to).number;
      selectedStart = Math.min(startLine, endLine);
      selectedEnd = Math.max(startLine, endLine);
      syncEditorLineHighlight();
      return true;
    }
    const lines = getLinesFromSelection();
    if (!lines) return false;
    selectedStart = lines.start;
    selectedEnd = lines.end;
    return true;
  }

  function getLineNumberFromPoint(clientX: number, clientY: number): number | null {
    if (editorView) {
      const rect = editorView.dom.getBoundingClientRect();
      const clampedX = Math.min(rect.right - 1, Math.max(rect.left + 1, clientX));
      const clampedY = Math.min(rect.bottom - 1, Math.max(rect.top + 1, clientY));
      const pos = editorView.posAtCoords({ x: clampedX, y: clampedY });
      if (pos != null) {
        return editorView.state.doc.lineAt(pos).number;
      }
    }
    if (!editorHost) return null;
    const content = editorHost.querySelector(".cm-content") as HTMLElement | null;
    const contentRect = content?.getBoundingClientRect();
    const probeX = contentRect
      ? Math.min(contentRect.right - 4, Math.max(contentRect.left + 4, clientX))
      : clientX;
    const target = document.elementFromPoint(probeX, clientY) as HTMLElement | null;
    const lineEl = target?.closest?.(".cm-line") as HTMLElement | null;
    const lines = Array.from(editorHost.querySelectorAll(".cm-line")) as HTMLElement[];
    if (lineEl) {
      const idx = lines.indexOf(lineEl);
      if (idx !== -1) return idx + 1;
    }
    if (lines.length === 0) return null;
    const rect = editorHost.getBoundingClientRect();
    if (clientY < rect.top) return 1;
    if (clientY > rect.bottom) return lines.length;
    return null;
  }

  function pinScroll(fn: () => void) {
    const scroller = editorView?.scrollDOM;
    const left = scroller?.scrollLeft ?? 0;
    const top = scroller?.scrollTop ?? 0;
    fn();
    if (scroller) {
      scroller.scrollLeft = left;
      scroller.scrollTop = top;
      requestAnimationFrame(() => {
        scroller.scrollLeft = left;
        scroller.scrollTop = top;
      });
    }
  }

  function syncEditorLineHighlight() {
    if (!editorView) return;
    const start = selectedStart;
    const end = selectedEnd;
    const hasSelection = start !== null && end !== null;

    if (hasSelection) {
      const maxLine = editorView.state.doc.lines;
      const safeStart = Math.max(1, Math.min(start, maxLine));
      const safeEnd = Math.max(1, Math.min(end, maxLine));
      const startPos = editorView.state.doc.line(safeStart).from;
      const endPos = editorView.state.doc.line(safeEnd).to;
      const scroller = editorView.scrollDOM;
      const scrollLeft = scroller.scrollLeft;
      const scrollTop = scroller.scrollTop;

      editorView.dispatch({
        selection: EditorSelection.single(startPos, endPos),
        scrollIntoView: false,
        effects: setSelectedLineEffect.of({ start: safeStart, end: safeEnd }),
      });

      scroller.scrollLeft = scrollLeft;
      scroller.scrollTop = scrollTop;
      requestAnimationFrame(() => {
        scroller.scrollLeft = scrollLeft;
        scroller.scrollTop = scrollTop;
      });
      queueDomSelectionHighlight();
      return;
    }

    editorView.dispatch({
      effects: setSelectedLineEffect.of(null),
    });
    queueDomSelectionHighlight();
  }

  function getRenderedLineNumbers() {
    if (!editorHost) return [] as Array<number | null>;

    const lineElements = Array.from(editorHost.querySelectorAll(".cm-line")) as HTMLElement[];
    const gutterElements = Array.from(
      editorHost.querySelectorAll(".cm-lineNumbers .cm-gutterElement")
    ) as HTMLElement[];

    if (!editorView) {
      return lineElements.map((_, index) => index + 1);
    }

    return lineElements.map((lineEl, index) => {
      const gutterLineNumber = Number.parseInt(
        gutterElements[index]?.textContent?.trim() || "",
        10
      );
      if (Number.isFinite(gutterLineNumber)) return gutterLineNumber;

      try {
        const domTarget = lineEl.firstChild ?? lineEl;
        const pos = editorView!.posAtDOM(domTarget, 0);
        const lineNumber = editorView!.state.doc.lineAt(pos).number;
        return lineNumber;
      } catch {
        return null;
      }
    });
  }

  function applyDomSelectionHighlight() {
    if (!editorHost) return;

    const range = selectedStart && selectedEnd ? { start: selectedStart, end: selectedEnd } : null;
    const renderedLineNumbers = getRenderedLineNumbers();
    const lineElements = Array.from(editorHost.querySelectorAll(".cm-line")) as HTMLElement[];
    const gutterElements = Array.from(
      editorHost.querySelectorAll(".cm-lineNumbers .cm-gutterElement")
    ) as HTMLElement[];

    lineElements.forEach((lineEl, index) => {
      const lineNumber = renderedLineNumbers[index];
      const isSelected =
        !!range && lineNumber !== null && lineNumber >= range.start && lineNumber <= range.end;

      lineEl.classList.toggle("cm-selected-line-dom", isSelected);
      lineEl.classList.toggle("cm-selected-line-start", isSelected && lineNumber === range?.start);
      lineEl.classList.toggle("cm-selected-line-end", isSelected && lineNumber === range?.end);
    });

    gutterElements.forEach((gutterEl, index) => {
      const fallbackLineNumber = Number.parseInt(gutterEl.textContent?.trim() || "", 10);
      const lineNumber =
        renderedLineNumbers[index] ??
        (Number.isFinite(fallbackLineNumber) ? fallbackLineNumber : null);
      const isSelected =
        !!range && lineNumber !== null && lineNumber >= range.start && lineNumber <= range.end;

      gutterEl.classList.toggle("cm-selected-gutter", isSelected);
      gutterEl.classList.toggle(
        "cm-selected-gutter-start",
        isSelected && lineNumber === range?.start
      );
      gutterEl.classList.toggle("cm-selected-gutter-end", isSelected && lineNumber === range?.end);
    });
  }

  function queueDomSelectionHighlight() {
    if (typeof window === "undefined") return;
    if (domHighlightFrame !== null) {
      window.cancelAnimationFrame(domHighlightFrame);
    }

    domHighlightFrame = window.requestAnimationFrame(() => {
      domHighlightFrame = null;
      applyDomSelectionHighlight();
    });
  }

  function setLineSelection(startLine: number, endLine: number) {
    const start = Math.min(startLine, endLine);
    const end = Math.max(startLine, endLine);
    selectedStart = start;
    selectedEnd = end;
    if (editorView) {
      if (canFocusEditor()) editorView.focus();
      const maxLine = editorView.state.doc.lines;
      const safeStart = Math.max(1, Math.min(start, maxLine));
      const safeEnd = Math.max(1, Math.min(end, maxLine));
      const startPos = editorView.state.doc.line(safeStart).from;
      const endPos = editorView.state.doc.line(safeEnd).to;
      const scroller = editorView.scrollDOM;
      const scrollLeft = scroller.scrollLeft;
      const scrollTop = scroller.scrollTop;
      editorView.dispatch({
        selection: EditorSelection.single(startPos, endPos),
        scrollIntoView: false,
      });
      scroller.scrollLeft = scrollLeft;
      scroller.scrollTop = scrollTop;
      requestAnimationFrame(() => {
        scroller.scrollLeft = scrollLeft;
        scroller.scrollTop = scrollTop;
      });
      syncEditorLineHighlight();
      return;
    }
    selectLinesInEditor(start, end);
  }

  function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
  }

  function getContentRect(): DOMRect | null {
    if (!editorHost) return null;
    const content = editorHost.querySelector(".cm-content") as HTMLElement | null;
    return content?.getBoundingClientRect() ?? editorHost.getBoundingClientRect();
  }

  function getSelectionMenuAnchor(): { x: number; y: number } | null {
    if (typeof window === "undefined") return null;
    const contentRect = getContentRect();
    const hostRect = editorHost?.getBoundingClientRect();
    if (!contentRect || !hostRect) return null;
    const minX = contentRect.left + MENU_PADDING;
    const maxX = Math.max(minX, contentRect.right - MENU_WIDTH - MENU_PADDING);

    if (editorView) {
      const selection = editorView.state.selection.main;
      if (selection && !selection.empty) {
        const anchor = editorView.coordsAtPos(selection.anchor);
        const head = editorView.coordsAtPos(selection.head);
        if (anchor && head) {
          const x = clamp(Math.min(anchor.left, head.left), minX, maxX);
          const y = Math.max(anchor.bottom, head.bottom) + 4;
          return { x, y };
        }
      }
    }

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    const range = selection.getRangeAt(0);
    if (range.collapsed) return null;
    if (
      editorHost &&
      (!editorHost.contains(range.startContainer) || !editorHost.contains(range.endContainer))
    ) {
      return null;
    }
    const rects = Array.from(range.getClientRects());
    if (rects.length > 0) {
      const first = rects[0];
      const last = rects[rects.length - 1];
      return { x: clamp(first.left, minX, maxX), y: last.bottom + 4 };
    }
    const rect = range.getBoundingClientRect();
    return { x: clamp(rect.left, minX, maxX), y: rect.bottom + 4 };
  }

  function autoScrollForSelection(clientY: number) {
    const threshold = AUTO_SCROLL_THRESHOLD;
    const maxStep = AUTO_SCROLL_STEP;
    const scroller = editorHost?.querySelector(".cm-scroller") as HTMLElement | null;
    const scrollParent =
      scroller && scroller.scrollHeight > scroller.clientHeight
        ? scroller
        : selectionScrollParent &&
            selectionScrollParent.scrollHeight > selectionScrollParent.clientHeight
          ? selectionScrollParent
          : editorHost
            ? findSelectionScrollParent(editorHost)
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
      if (isPointerSelecting || isTouchSelecting) {
        const anchorLine = isPointerSelecting ? pointerStartLine : touchStartLine;
        if (anchorLine !== null) {
          const line = getLineNumberFromPoint(autoScrollClientX, autoScrollClientY);
          if (line) {
            setLineSelection(anchorLine, line);
          }
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

  function findSelectionScrollParent(element: HTMLElement | null): HTMLElement | null {
    if (!element || typeof window === "undefined") return null;
    let current: HTMLElement | null = element.parentElement;
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

  function openSelectionMenuAt(clientX: number, clientY: number) {
    if (!editorHost) return;
    const rect = editorHost.getBoundingClientRect();
    const contentRect = getContentRect() ?? rect;
    const minX = contentRect.left - rect.left + MENU_PADDING;
    const maxX = Math.max(minX, contentRect.right - rect.left - MENU_WIDTH - MENU_PADDING);
    gutterMenuX = clamp(clientX - rect.left, minX, maxX);
    gutterMenuY = Math.max(MENU_PADDING, clientY - rect.top);
    showGutterMenu = true;
  }

  function openSelectionMenuFromDomSelection(): boolean {
    const anchor = getSelectionMenuAnchor();
    if (!anchor) return false;
    openSelectionMenuAt(anchor.x, anchor.y);
    return true;
  }

  // Select lines in the CodeMirror editor
  function selectLinesInEditor(startLine: number, endLine: number) {
    if (!editorHost) return;

    const lines = Array.from(editorHost.querySelectorAll(".cm-line")) as HTMLElement[];
    if (lines.length === 0) return;

    // Ensure start <= end
    const start = Math.min(startLine, endLine);
    const end = Math.max(startLine, endLine);

    // Convert to 0-based indices
    const startIdx = start - 1;
    const endIdx = end - 1;

    if (startIdx < 0 || endIdx >= lines.length) return;

    const startLineEl = lines[startIdx];
    const endLineEl = lines[endIdx];

    if (!startLineEl || !endLineEl) return;

    // Create a range and select it
    const range = document.createRange();
    range.setStart(startLineEl, 0);
    range.setEnd(endLineEl, endLineEl.childNodes.length);

    const selection = window.getSelection();
    if (selection) {
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }

  $effect(() => {
    const handler = (e: MouseEvent) => {
      if (Date.now() < ignoreMenuCloseUntil) return;
      const target = e.target as HTMLElement;
      // Check if click is inside any menu popup
      const inMenu =
        target.closest?.(".permalink-menu-popup") || target.closest?.(".file-actions-menu");

      // Close menus if clicking outside
      if (!inMenu) {
        showGutterMenu = false;
        showFileMenu = false;
      }
    };
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  });

  $effect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      lastAppliedHash = null;
      void applyHashSelection();
    };
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  });

  // Watch for text selection changes in the editor
  $effect(() => {
    if (!editorHost) return;
    const editor = editorHost; // Capture for closure

    const handleSelectionChange = () => {
      // Only process if the selection is within our editor
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const startNode = range.startContainer;
      const endNode = range.endContainer;

      // Check if selection is within our editor
      if (!editor.contains(startNode) || !editor.contains(endNode)) return;

      // Get the selected lines
      refreshSelectionFromEditor();
    };

    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  });

  // Capture selection interactions for CodeMirror content (no gutter actions)
  $effect(() => {
    if (!editorHost) return;

    const clearTouchLongPress = () => {
      if (touchLongPressTimer) {
        window.clearTimeout(touchLongPressTimer);
        touchLongPressTimer = null;
      }
    };

    const handleContentContextMenu = (e: MouseEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.(".cm-content")) return;
      if (lastInputWasTouch) {
        e.preventDefault();
        return;
      }

      if (!refreshSelectionFromEditor()) return;
      e.preventDefault();
      syncHashFromSelection();
      openSelectionMenuAt(e.clientX, e.clientY);
    };

    let pointerDragged = false;

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      lastInputWasTouch = false;
      if (e.button !== 0) return;
      const el = e.target as HTMLElement;
      if (!el.closest?.(".cm-content")) return;
      const line = getLineNumberFromPoint(e.clientX, e.clientY);
      if (!line) return;
      pointerId = e.pointerId;
      pointerStartLine = line;
      isPointerSelecting = true;
      pointerDragged = false;
      setLineSelection(line, line);
      editorHost?.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (!isPointerSelecting || pointerId !== e.pointerId) return;
      if (pointerStartLine === null) return;
      const line = getLineNumberFromPoint(e.clientX, e.clientY);
      if (!line) return;
      if (line !== pointerStartLine) pointerDragged = true;
      setLineSelection(pointerStartLine, line);
      autoScrollForSelection(e.clientY);
      e.preventDefault();
    };

    const finishPointerSelection = (clientX: number, clientY: number) => {
      if (!isPointerSelecting) return;
      isPointerSelecting = false;
      stopAutoScroll();
      if (pointerId !== null) {
        editorHost?.releasePointerCapture?.(pointerId);
      }
      pointerId = null;
      const dragged = pointerDragged;
      pointerStartLine = null;
      pointerDragged = false;
      if (!dragged) return;
      if (!refreshSelectionFromEditor()) return;
      ignoreMenuCloseUntil = Date.now() + 300;
      syncHashFromSelection();
      pinScroll(() => {
        if (!openSelectionMenuFromDomSelection()) {
          openSelectionMenuAt(clientX, clientY);
        }
      });
    };

    const handlePointerUp = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      if (e.button !== 0) return;
      finishPointerSelection(e.clientX, e.clientY);
    };

    const handlePointerCancel = () => {
      isPointerSelecting = false;
      if (pointerId !== null) {
        editorHost?.releasePointerCapture?.(pointerId);
      }
      pointerId = null;
      pointerStartLine = null;
      stopAutoScroll();
    };

    const handleTouchStart = (e: TouchEvent) => {
      const el = e.target as HTMLElement;
      if (!el.closest?.(".cm-content")) return;
      if (touchIdentifier !== null) return;

      const touch = e.changedTouches[0];
      if (!touch) return;

      lastInputWasTouch = true;
      touchIdentifier = touch.identifier;
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;
      isTouchSelecting = false;
      touchStartLine = null;
      clearTouchLongPress();
      touchLongPressTimer = window.setTimeout(() => {
        if (touchIdentifier === null) return;
        const line = getLineNumberFromPoint(touchStartX, touchStartY);
        if (!line) return;
        isTouchSelecting = true;
        touchStartLine = line;
        setLineSelection(line, line);
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
        clearTouchLongPress();
        touchIdentifier = null;
        touchStartLine = null;
        stopAutoScroll();
        return;
      }

      if (!isTouchSelecting || touchStartLine === null) return;
      e.preventDefault();
      const line = getLineNumberFromPoint(touch.clientX, touch.clientY);
      if (line) {
        setLineSelection(touchStartLine, line);
      }
      updateAutoScroll(touch.clientX, touch.clientY);
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (touchIdentifier === null) return;
      const touch = Array.from(e.changedTouches).find((t) => t.identifier === touchIdentifier);
      if (!touch) return;
      clearTouchLongPress();
      const shouldOpenMenu = isTouchSelecting;
      touchIdentifier = null;
      isTouchSelecting = false;
      touchStartLine = null;
      stopAutoScroll();

      if (!shouldOpenMenu) return;

      window.setTimeout(() => {
        if (showGutterMenu) return;
        if (!refreshSelectionFromEditor()) return;
        ignoreMenuCloseUntil = Date.now() + 300;
        syncHashFromSelection();
        if (!openSelectionMenuFromDomSelection()) {
          openSelectionMenuAt(touch.clientX, touch.clientY);
        }
        stopAutoScroll();
      }, 0);
    };

    const handleTouchCancel = () => {
      if (touchIdentifier === null) return;
      clearTouchLongPress();
      touchIdentifier = null;
      isTouchSelecting = false;
      touchStartLine = null;
      stopAutoScroll();
    };

    editorHost.addEventListener("contextmenu", handleContentContextMenu, { capture: true } as any);
    editorHost.addEventListener("pointerdown", handlePointerDown, { capture: true } as any);
    editorHost.addEventListener("pointermove", handlePointerMove, { capture: true } as any);
    editorHost.addEventListener("pointerup", handlePointerUp, { capture: true } as any);
    editorHost.addEventListener("pointercancel", handlePointerCancel, { capture: true } as any);
    editorHost.addEventListener("touchstart", handleTouchStart, {
      capture: true,
      passive: true,
    } as any);
    editorHost.addEventListener("touchmove", handleTouchMove, {
      capture: true,
      passive: false,
    } as any);
    editorHost.addEventListener("touchend", handleTouchEnd, { capture: true } as any);
    editorHost.addEventListener("touchcancel", handleTouchCancel, { capture: true } as any);
    return () => {
      editorHost?.removeEventListener("contextmenu", handleContentContextMenu, {
        capture: true,
      } as any);
      editorHost?.removeEventListener("pointerdown", handlePointerDown, { capture: true } as any);
      editorHost?.removeEventListener("pointermove", handlePointerMove, { capture: true } as any);
      editorHost?.removeEventListener("pointerup", handlePointerUp, { capture: true } as any);
      editorHost?.removeEventListener("pointercancel", handlePointerCancel, {
        capture: true,
      } as any);
      editorHost?.removeEventListener("touchstart", handleTouchStart, { capture: true } as any);
      editorHost?.removeEventListener("touchmove", handleTouchMove, { capture: true } as any);
      editorHost?.removeEventListener("touchend", handleTouchEnd, { capture: true } as any);
      editorHost?.removeEventListener("touchcancel", handleTouchCancel, { capture: true } as any);
      stopAutoScroll();
    };
  });

  async function copyContent(event: MouseEvent | undefined) {
    event?.stopPropagation();
    try {
      if (!content) {
        content = await getFileContent(path);
      }

      if (fileTypeInfo?.category === "binary") {
        toast.push({
          title: "Cannot copy binary file",
          description: "Binary files cannot be copied to clipboard. Use download instead.",
          variant: "destructive",
        });
        return;
      }

      navigator.clipboard.writeText(content);
      toast.push({
        title: "Copied to clipboard",
        description: `${name} content has been copied to your clipboard.`,
      });
    } catch (e) {
      pushErrorToast("Failed to copy", e, "Could not copy the content to clipboard.");
    }
  }

  async function downloadFile(event: MouseEvent | undefined) {
    event?.stopPropagation();
    try {
      if (!content) {
        content = await getFileContent(path);
      }

      // Use application/octet-stream for binary files to prevent extension changes
      const mimeType = fileTypeInfo?.mimeType || "application/octet-stream";
      const blob = new Blob([content], { type: mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name; // Use the original filename with its extension
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      pushErrorToast("Download failed", e, "Failed to download file.");
    }
  }

  function parseRepoAddress(address: string) {
    const parts = address.split(":");
    if (parts.length < 3) return null;
    const [kindStr, pubkey, ...identifierParts] = parts;
    const kind = Number.parseInt(kindStr, 10);
    const identifier = identifierParts.join(":");
    if (!kind || !pubkey || !identifier) return null;
    return { kind, pubkey, identifier };
  }

  function deriveRelayFromLocation() {
    if (typeof window === "undefined") return null;
    const match = window.location.pathname.match(/\/spaces\/([^/]+)\//);
    if (!match) return null;
    try {
      return decodeURIComponent(match[1]);
    } catch {
      return match[1];
    }
  }

  function toRelayHint(value: string | null | undefined) {
    if (!value) return "";
    if (value.match(/^wss?:\/\//)) return value;
    return `wss://${value}`;
  }

  function deriveBasePath() {
    if (typeof window === "undefined") return "";
    const repoAddress = repo?.address || "";
    const relayValue = deriveRelayFromLocation();
    let repoNaddr = "";
    if (repoAddress) {
      const parsed = parseRepoAddress(repoAddress);
      if (parsed) {
        const relayHints = Array.from(
          new Set([...(repo?.relays || []), toRelayHint(relayValue)].filter(Boolean))
        );
        try {
          repoNaddr = nip19.naddrEncode({
            kind: parsed.kind,
            pubkey: parsed.pubkey,
            identifier: parsed.identifier,
            relays: relayHints,
          });
        } catch {
          repoNaddr = "";
        }
      }
    }
    if (repoNaddr && relayValue) {
      return `/spaces/${encodeURIComponent(relayValue)}/git/${repoNaddr}`;
    }
    const match = window.location.pathname.match(/\/spaces\/[^/]+\/git\/[^/]+/);
    return match ? match[0] : "";
  }

  function shareLink(event?: MouseEvent) {
    event?.stopPropagation();
    const hash = selectedStart ? `#L${selectedStart}${selectedEnd ? `-L${selectedEnd}` : ""}` : "";
    const basePath = deriveBasePath();
    if (!basePath || !path) {
      toast.push({
        title: "Link unavailable",
        description: "Could not build a permalink for this file.",
        variant: "destructive",
      });
      return;
    }
    const shareUrl = `${location.origin}${basePath}/code?path=${encodeURIComponent(path)}${hash}`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(shareUrl);
      toast.push({
        title: "Link copied",
        description: "Permalink copied to clipboard.",
      });
    } else {
      toast.push({
        title: "Error",
        description: "Clipboard not available",
        variant: "destructive",
      });
    }
  }

  async function showMetadata(event?: MouseEvent) {
    event?.stopPropagation();

    // Ensure fileTypeInfo is populated
    if (!fileTypeInfo) {
      const fileIdentifier = path || name;

      // If content is already loaded, detect type from it
      if (content) {
        fileTypeInfo = detectFileType(fileIdentifier, content);
      } else {
        // Otherwise, detect from filename only
        fileTypeInfo = detectFileType(fileIdentifier, "");
      }
    }

    isMetadataPanelOpen = true;
  }

  async function loadLanguageExtension(filename: string, info: FileTypeInfo | null) {
    try {
      cmExtensions = await loadCodeMirrorLanguageExtensions(filename, info);
    } catch (e) {
      console.warn(`Failed to load language extension for ${filename}`, e);
      cmExtensions = [];
    }
    // Ensure line numbers are shown for code files
    try {
      const hasLineNumbers = (cmExtensions || []).some((e: any) =>
        String(e ?? "").includes("lineNumbers")
      );
      if (!hasLineNumbers) {
        cmExtensions = [...cmExtensions, lineNumbers()];
      }
    } catch {}
  }

  function getSelectedContent(source: string) {
    if (!selectedStart) return source;
    const lines = source.split("\n");
    const start = Math.max(1, selectedStart);
    const end = selectedEnd ? Math.max(start, selectedEnd) : start;
    return lines.slice(start - 1, end).join("\n");
  }

  function buildPermalinkEvent(): PermalinkEvent | null {
    try {
      if (!path) return null;
      if (!repo) return null;
      const tags: string[][] = [];
      // Extract current commit and branch
      let commit = "";
      let branch = "";
      try {
        branch = normalizeGitRefName(repo.selectedBranch || repo.mainBranch || "");
        const hit = (repo.refs || []).find((r) => r.type === "heads" && r.name === branch);
        commit = hit?.commitId || "";
      } catch {}
      if (repo.address) tags.push(["a", repo.address]);
      const repoUrl = (repo.web && repo.web[0]) || (repo.clone && repo.clone[0]) || "";
      if (repoUrl) tags.push(["repo", repoUrl]);
      if (commit) {
        if (branch) tags.push([`refs/heads/${branch}`, commit]);
        tags.push(["commit", commit]);
      }
      tags.push(["file", path]);
      if (selectedStart) {
        if (selectedEnd) tags.push(["lines", String(selectedStart), String(selectedEnd)]);
        else tags.push(["lines", String(selectedStart)]);
      }
      if (fileTypeInfo?.language) tags.push(["l", String(fileTypeInfo.language)]);
      const evt: PermalinkEvent = {
        kind: GIT_PERMALINK,
        content: getSelectedContent(content || ""),
        tags,
        pubkey: "",
        created_at: Math.floor(Date.now() / 1000),
        id: "",
        sig: "",
      };
      return evt;
    } catch (e) {
      console.warn("Failed to build permalink event", e);
      return null;
    }
  }

  async function createPermalink(event?: MouseEvent) {
    event?.stopPropagation();
    refreshSelectionFromEditor();
    showGutterMenu = false;

    const evt = buildPermalinkEvent();
    if (!evt) {
      const missing = !repo ? "repo context" : "file path";
      toast.push({
        title: "Cannot create permalink",
        description: `Missing ${missing}`,
        variant: "destructive",
      });
      return;
    }

    // Show immediate feedback
    toast.push({ title: "Creating permalink...", description: "Publishing to relays" });

    try {
      if (publish) {
        await publish(evt);
        toast.push({
          title: "Permalink published",
          description: "Permalink published successfully",
        });
        console.log("Permalink published successfully", evt);
      } else {
        await navigator.clipboard.writeText(JSON.stringify(evt));
        toast.push({ title: "Permalink copied", description: "JSON copied to clipboard" });
        console.log("Permalink copied to clipboard", evt);
      }
    } catch (e: any) {
      console.error("Failed to create permalink", e);
      pushErrorToast("Permalink failed", e, "Failed to create permalink.");
    }
  }

  function copyLinkToLines(event?: MouseEvent) {
    event?.stopPropagation();
    refreshSelectionFromEditor();
    showGutterMenu = false;
    shareLink();
  }

  function getFileIcon() {
    if (type === "directory") return Folder;
    if (fileTypeInfo?.icon) {
      const iconMap: Record<string, any> = {
        Image: FileCode,
        FileText: FileCode,
        Settings: FileCode,
        Container: FileCode,
        Hammer: FileCode,
        BookOpen: FileCode,
        Scale: FileCode,
        Braces: FileCode,
        Code2: FileCode,
        Terminal: FileCode,
        Binary: FileCode,
        Archive: FileCode,
        Video: FileCode,
        Music: FileCode,
      };
      return iconMap[fileTypeInfo.icon] || FileCode;
    }
    return FileCode;
  }
</script>

<div class={containerClass} bind:this={fileViewElement}>
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    role={isViewer ? "group" : "button"}
    tabindex={!isViewer ? 0 : undefined}
    class={headerClass}
    onclick={handleRowActivate}
    onkeydown={(e) => {
      if (isViewer) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        handleRowActivate();
      }
    }}
    aria-expanded={isInline && type === "file" ? isExpanded : undefined}
  >
    <div class="flex items-center gap-2 min-w-0 flex-1">
      {#if isViewer && onClose}
        <Button variant="ghost" size="sm" class="h-8 w-8 p-0" title="Back" onclick={handleClose}>
          <ChevronLeft class="h-4 w-4" />
        </Button>
      {/if}
      {#if type === "directory"}
        <Folder class="h-4 w-4 flex-shrink-0" style="color: hsl(var(--ng-muted-foreground));" />
      {:else}
        {@const IconComponent = getFileIcon()}
        <IconComponent class="h-4 w-4 flex-shrink-0" style="color: hsl(var(--ng-muted-foreground));" />
      {/if}
      <span class="truncate" title={name}>{name}</span>
      {#if fileTypeInfo && type === "file"}
        <span
          class="ml-2 hidden sm:inline-flex px-2 py-0.5 text-xs bg-muted/50 text-muted-foreground rounded"
        >
          {fileTypeBadge}
        </span>
      {/if}
    </div>
    {#if type === "file" && showActions}
      <div class="hidden sm:flex items-center gap-2">
        <Button variant="ghost" size="sm" class="h-8 w-8 p-0" onclick={showMetadata}>
          <Info class="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" class="h-8 w-8 p-0" onclick={downloadFile}>
          <Download class="h-4 w-4" />
        </Button>
        {#if fileTypeInfo?.canEdit !== false}
          <Button variant="ghost" size="sm" class="h-8 w-8 p-0" onclick={copyContent}>
            <Copy class="h-4 w-4" />
          </Button>
        {/if}
      </div>
      <div class="relative sm:hidden">
        <Button
          variant="ghost"
          size="sm"
          class="h-8 w-8 p-0"
          onclick={toggleFileMenu}
          title="File actions"
        >
          <MoreVertical class="h-4 w-4" />
        </Button>
        {#if showFileMenu}
          <div
            class="file-actions-menu absolute right-0 mt-1 z-10 w-48 rounded border bg-popover text-popover-foreground shadow-md"
            style="border-color: hsl(var(--ng-border));"
          >
            <button
              class="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50"
              onclick={(event) => {
                event.stopPropagation();
                showMetadata(event);
                showFileMenu = false;
              }}
            >
              File info
            </button>
            <button
              class="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50"
              onclick={(event) => {
                event.stopPropagation();
                copyLinkToLines(event);
                showFileMenu = false;
              }}
            >
              Copy link
            </button>
            <button
              class="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50"
              onclick={(event) => {
                event.stopPropagation();
                createPermalink(event);
                showFileMenu = false;
              }}
            >
              Create permalink
            </button>
            <button
              class="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50"
              onclick={(event) => {
                event.stopPropagation();
                downloadFile(event);
                showFileMenu = false;
              }}
            >
              Download
            </button>
            {#if fileTypeInfo?.canEdit !== false}
              <button
                class="w-full text-left px-3 py-2 text-sm hover:bg-secondary/50"
                onclick={(event) => {
                  event.stopPropagation();
                  copyContent(event);
                  showFileMenu = false;
                }}
              >
                Copy contents
              </button>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>

  {#if isExpanded && type === "file" && !isList}
    <div class="border-t" style="border-color: hsl(var(--ng-border));">
      {#if isLoading}
        <div class="p-3 sm:p-4">
          <Spinner>Fetching content...</Spinner>
        </div>
      {:else if content}
        {#if fileTypeInfo?.category === "image"}
          <div class="p-3 sm:p-4">
            <ImageViewer content={content} filename={name} mimeType={fileTypeInfo.mimeType} />
          </div>
        {:else if fileTypeInfo?.category === "pdf"}
          <div class="p-3 sm:p-4">
            <PDFViewer content={content} filename={name} />
          </div>
        {:else if fileTypeInfo?.category === "video"}
          <div class="p-3 sm:p-4">
            <VideoViewer content={content} filename={name} mimeType={fileTypeInfo.mimeType} />
          </div>
        {:else if fileTypeInfo?.category === "audio"}
          <div class="p-3 sm:p-4">
            <AudioViewer content={content} filename={name} mimeType={fileTypeInfo.mimeType} />
          </div>
        {:else if fileTypeInfo?.category === "binary" || fileTypeInfo?.category === "archive"}
          <div class="p-3 sm:p-4">
            <BinaryViewer content={content} filename={name} />
          </div>
        {:else}
          <div class="p-3 sm:p-4 border-t" style="border-color: hsl(var(--ng-border));">
            <div
              class="relative bg-background text-foreground rounded border"
              style="border-color: hsl(var(--ng-border));"
              bind:this={editorHost}
              role="group"
              data-permalink-menu
            >
              <CodeMirror
                bind:value={content}
                editable={false}
                readonly={true}
                extensions={[
                  ...(cmExtensions.length ? cmExtensions : [lineNumbers()]),
                  ...viewerExtensions,
                ]}
                onready={handleEditorReady}
              />
              {#if showGutterMenu}
                <div
                  class="permalink-menu-popup absolute z-20 w-44 rounded border bg-popover text-popover-foreground shadow-md"
                  style="left: {gutterMenuX}px; top: {gutterMenuY}px; border-color: hsl(var(--ng-border));"
                >
                  <button
                    class="w-full text-left px-3 py-2 hover:bg-secondary/50"
                    onclick={copyLinkToLines}
                  >
                    Copy link to {selectedStart
                      ? selectedEnd
                        ? `lines ${selectedStart}-${selectedEnd}`
                        : `line ${selectedStart}`
                      : "file"}
                  </button>
                  <button
                    class="w-full text-left px-3 py-2 hover:bg-secondary/50"
                    onclick={createPermalink}>Create permalink</button
                  >
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {:else}
        <div class="p-3 sm:p-4">
          <div class="text-center text-muted-foreground py-8">No content available</div>
        </div>
      {/if}
    </div>
  {/if}

  <FileMetadataPanel
    bind:isOpen={isMetadataPanelOpen}
    file={file}
    content={content}
    typeInfo={fileTypeInfo}
    metadata={metadata}
  />
</div>

<style>
  /* Ensure CodeMirror has proper contrast */
  :global(.file-view .cm-editor) {
    background-color: hsl(var(--ng-background)) !important;
    color: hsl(var(--ng-foreground)) !important;
    font-size: 0.875rem;
    line-height: 1.5;
    max-width: 100%;
  }

  :global(.file-view .cm-scroller) {
    overflow-x: auto;
  }

  :global(.file-view .cm-gutters) {
    background-color: hsl(var(--ng-secondary) / 0.85) !important;
    color: hsl(var(--ng-muted-foreground) / 0.95) !important;
    border-right: 1px solid hsl(var(--ng-border)) !important;
  }

  :global(.file-view .cm-activeLineGutter) {
    background-color: hsl(var(--ng-primary) / 0.32) !important;
    color: hsl(var(--ng-foreground)) !important;
  }

  :global(.file-view .cm-activeLine) {
    background-color: hsl(var(--ng-secondary) / 0.5) !important;
  }

  :global(.file-view .cm-selected-line),
  :global(.file-view .cm-selected-line-dom) {
    background-color: hsl(var(--ng-primary) / 0.22) !important;
    box-shadow:
      inset 3px 0 0 hsl(var(--ng-primary)),
      inset 0 1px 0 hsl(var(--ng-primary) / 0.36),
      inset 0 -1px 0 hsl(var(--ng-primary) / 0.36),
      inset 0 0 0 1px hsl(var(--ng-primary) / 0.3);
  }

  :global(.file-view .cm-selected-line-text) {
    background-color: hsl(var(--ng-primary) / 0.3) !important;
    color: hsl(var(--ng-foreground)) !important;
    border-radius: 0.125rem;
    box-shadow: inset 0 0 0 1px hsl(var(--ng-primary) / 0.45);
  }

  :global(.file-view .cm-selected-line-text *) {
    color: hsl(var(--ng-foreground)) !important;
  }

  :global(.file-view .cm-selected-gutter) {
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

  :global(.file-view .cm-selected-line-start),
  :global(.file-view .cm-selected-gutter-start) {
    box-shadow:
      inset 3px 0 0 hsl(var(--ng-primary)),
      inset 0 1px 0 hsl(var(--ng-primary) / 0.6),
      inset 0 -1px 0 hsl(var(--ng-primary) / 0.28),
      inset 0 0 0 1px hsl(var(--ng-primary) / 0.28);
  }

  :global(.file-view .cm-selected-gutter-start) {
    box-shadow:
      inset -3px 0 0 rgb(251 191 36 / 1),
      inset 0 1px 0 rgb(254 240 138 / 0.95),
      inset 0 -1px 0 rgb(245 158 11 / 0.45),
      inset 0 0 0 1px rgb(245 158 11 / 0.6);
  }

  :global(.file-view .cm-selected-line-end),
  :global(.file-view .cm-selected-gutter-end) {
    box-shadow:
      inset 3px 0 0 hsl(var(--ng-primary)),
      inset 0 1px 0 hsl(var(--ng-primary) / 0.28),
      inset 0 -1px 0 hsl(var(--ng-primary) / 0.6),
      inset 0 0 0 1px hsl(var(--ng-primary) / 0.28);
  }

  :global(.file-view .cm-selected-gutter-end) {
    box-shadow:
      inset -3px 0 0 rgb(251 191 36 / 1),
      inset 0 1px 0 rgb(245 158 11 / 0.45),
      inset 0 -1px 0 rgb(254 240 138 / 0.95),
      inset 0 0 0 1px rgb(245 158 11 / 0.6);
  }

  :global(.file-view .cm-line) {
    color: hsl(var(--ng-foreground)) !important;
  }

  :global(.file-view .cm-content) {
    caret-color: hsl(var(--ng-foreground)) !important;
    filter: brightness(1.2) saturate(1.08);
    -webkit-user-select: text;
    user-select: text;
    -webkit-user-drag: none;
    -webkit-user-modify: read-only;
  }

  :global(.file-view .cm-selectionBackground) {
    background-color: hsl(var(--ng-primary) / 0.32) !important;
  }

  :global(.file-view .cm-focused .cm-selectionBackground) {
    background-color: hsl(var(--ng-primary) / 0.42) !important;
  }

  :global(.file-view .cm-cursor) {
    display: none !important;
  }

  :global(.file-view .cm-content ::selection) {
    background-color: hsl(var(--ng-primary) / 0.42);
    color: hsl(var(--ng-foreground));
  }

  :global(.file-view .cm-content ::-moz-selection) {
    background-color: hsl(var(--ng-primary) / 0.42);
    color: hsl(var(--ng-foreground));
  }

  @media (min-width: 768px) {
    :global(.file-view .cm-editor) {
      font-size: 0.9rem;
    }
  }
</style>
