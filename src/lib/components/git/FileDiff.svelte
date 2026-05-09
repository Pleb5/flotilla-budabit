<script lang="ts">
  import {
    Plus,
    Minus,
    MessageSquarePlus,
    FileText,
    FilePlus,
    FileX,
    FileIcon,
  } from "@lucide/svelte";
  import type { FileDiff } from "@nostr-git/core/types";
  import {
    getHighlightLanguageForPath,
    highlightCodeLines,
    highlightCodeSnippet,
  } from "../../utils/codeHighlight";

  interface Props {
    fileDiff: FileDiff;
    expanded?: boolean;
    onToggleExpansion?: () => void;
    onSelectFile?: (filePath: string) => void;
    highlightLanguage?: string;
  }

  let {
    fileDiff,
    expanded = false,
    onToggleExpansion,
    onSelectFile,
    highlightLanguage,
  }: Props = $props();

  // Get file extension for syntax highlighting
  const getFileLanguage = (filepath: string): string =>
    getHighlightLanguageForPath(filepath, highlightLanguage);

  // Get status icon and color
  const getStatusInfo = (status: FileDiff["status"]) => {
    switch (status) {
      case "added":
        return {
          icon: FilePlus,
          color: "text-emerald-700 dark:text-emerald-300",
          bg: "bg-emerald-50 dark:bg-emerald-950/30",
          label: "A",
        };
      case "deleted":
        return {
          icon: FileX,
          color: "text-rose-700 dark:text-rose-300",
          bg: "bg-rose-50 dark:bg-rose-950/30",
          label: "D",
        };
      case "modified":
        return {
          icon: FileText,
          color: "text-sky-700 dark:text-sky-300",
          bg: "bg-sky-50 dark:bg-sky-950/30",
          label: "M",
        };
      case "renamed":
        return {
          icon: FileIcon,
          color: "text-violet-700 dark:text-violet-300",
          bg: "bg-violet-50 dark:bg-violet-950/30",
          label: "R",
        };
      default:
        return {
          icon: FileText,
          color: "text-muted-foreground",
          bg: "bg-muted/60",
          label: "?",
        };
    }
  };

  // Calculate line numbers for display
  const calculateLineNumbers = (hunk: FileDiff["diffHunks"][0]) => {
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
        return "border-l-2 border-l-emerald-700 bg-emerald-100/80 text-slate-900 dark:border-l-emerald-500 dark:bg-emerald-900/50 dark:text-slate-100";
      case "-":
        return "border-l-2 border-l-rose-700 bg-rose-100/80 text-slate-900 dark:border-l-rose-500 dark:bg-rose-900/50 dark:text-slate-100";
      default:
        return "bg-background hover:bg-muted/30";
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

  const highlightCode = (content: string, language: string): string =>
    highlightCodeSnippet(content, language);

  // Handle add comment placeholder
  const handleAddComment = (lineNum: number) => {
    console.log("Add comment at line:", lineNum, "in file:", fileDiff.path);
  };

  const statusInfo = $derived(getStatusInfo(fileDiff.status));
  const language = $derived(getFileLanguage(fileDiff.path));
  const totalChanges = $derived(
    fileDiff.diffHunks.reduce(
      (total, hunk) => total + hunk.patches.filter((p) => p.type !== " ").length,
      0
    )
  );
</script>

<div class="file-diff border border-border rounded-md overflow-hidden mb-4">
  <!-- File Header -->
  <button
    type="button"
    class="w-full flex items-center gap-3 p-3 bg-muted/30 hover:bg-muted/50 transition-colors text-left"
    onclick={() => {
      onToggleExpansion?.();
      onSelectFile?.(fileDiff.path);
    }}
    aria-expanded={expanded}
  >
    <!-- Status Icon -->
    <div class="flex items-center gap-2 shrink-0">
      <div class="w-6 h-6 rounded-sm {statusInfo.bg} flex items-center justify-center">
        {#if statusInfo.icon === FilePlus}
          <FilePlus class="h-4 w-4 {statusInfo.color}" />
        {:else if statusInfo.icon === FileX}
          <FileX class="h-4 w-4 {statusInfo.color}" />
        {:else if statusInfo.icon === FileText}
          <FileText class="h-4 w-4 {statusInfo.color}" />
        {:else if statusInfo.icon === FileIcon}
          <FileIcon class="h-4 w-4 {statusInfo.color}" />
        {:else}
          <FileText class="h-4 w-4 {statusInfo.color}" />
        {/if}
      </div>
      <span class="text-xs font-mono font-semibold {statusInfo.color} w-4">
        {statusInfo.label}
      </span>
    </div>

    <!-- File Path -->
    <div class="flex-1 min-w-0">
      <div class="font-mono text-sm truncate" title={fileDiff.path}>
        {fileDiff.path}
      </div>
      {#if totalChanges > 0}
        <div class="text-xs text-muted-foreground">
          {totalChanges} change{totalChanges !== 1 ? "s" : ""}
        </div>
      {/if}
    </div>

    <!-- Expansion Indicator -->
    <div class="shrink-0">
      {#if expanded}
        <svg
          class="h-4 w-4 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"
          ></path>
        </svg>
      {:else}
        <svg
          class="h-4 w-4 text-muted-foreground"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"
          ></path>
        </svg>
      {/if}
    </div>
  </button>

  <!-- File Diff Content -->
  {#if expanded && fileDiff.diffHunks.length > 0}
    <div class="divide-y divide-border">
      {#each fileDiff.diffHunks as hunk, hunkIndex}
        {@const lines = calculateLineNumbers(hunk)}
        {@const highlightedLines = highlightCodeLines(
          lines.map((line) => line.content),
          language
        )}

        <!-- Hunk Header -->
        <div
          class="bg-muted px-4 py-2 text-sm font-mono text-muted-foreground border-b border-border"
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
          <span class="ml-2 text-foreground">{fileDiff.path}</span>
        </div>

        <!-- Diff Lines -->
        <div class="divide-y divide-border">
          {#each lines as line, lineIndex}
            <div class="flex {getLineClass(line.type)} group">
              <!-- Line Numbers -->
              <div class="flex shrink-0">
                <!-- Old Line Number -->
                <div
                  class="w-12 px-2 py-1 text-right text-xs font-mono {getLineNumClass(
                    line.type
                  )} border-r border-border"
                >
                  {line.oldLineNum || ""}
                </div>
                <!-- New Line Number -->
                <div
                  class="w-12 px-2 py-1 text-right text-xs font-mono {getLineNumClass(
                    line.type
                  )} border-r border-border"
                >
                  {line.newLineNum || ""}
                </div>
              </div>

              <!-- Change Indicator -->
              <div
                class="w-6 px-1 py-1 text-center text-xs font-mono {getLineNumClass(
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
              <div class="flex-1 px-2 py-1 font-mono text-sm overflow-x-auto">
                <pre class="whitespace-pre-wrap break-all"><span class="hljs"
                    >{@html highlightedLines[lineIndex] ??
                      highlightCode(line.content, language)}</span
                  ></pre>
              </div>

              <!-- Add Comment Button -->
              <div class="w-8 px-1 py-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onclick={() => handleAddComment(line.newLineNum || line.oldLineNum || 0)}
                  class="w-6 h-6 rounded-sm bg-background border border-border hover:bg-muted flex items-center justify-center"
                  title="Add comment"
                >
                  <MessageSquarePlus class="h-3 w-3 text-muted-foreground" />
                </button>
              </div>
            </div>
          {/each}
        </div>

        <!-- Hunk Separator -->
        {#if hunkIndex < fileDiff.diffHunks.length - 1}
          <div class="h-2 bg-muted border-t border-border"></div>
        {/if}
      {/each}
    </div>
  {:else if expanded && fileDiff.diffHunks.length === 0}
    <div class="p-4 text-center text-muted-foreground">
      {#if fileDiff.status === "deleted"}
        File was deleted
      {:else if fileDiff.status === "added"}
        Empty file was added
      {:else}
        No diff content available
      {/if}
    </div>
  {/if}
</div>

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

  :global(body:not(.dark):not([data-theme="dark"]) .file-diff .hljs span[class]) {
    filter: brightness(0.7) saturate(1.5) contrast(1.2);
  }
</style>
