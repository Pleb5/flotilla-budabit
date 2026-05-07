<script lang="ts">
  import {
    ChevronLeft,
    ChevronRight,
    FileCode,
    GitCommit,
    Info,
    AlertTriangle,
    CheckCircle,
  } from "@lucide/svelte";
  import { Button } from "@nostr-git/ui";
  import type { Patch, PermalinkEvent } from "@nostr-git/core/types";
  import type { Repo } from "./Repo.svelte";

  // Use parse-diff File type from DiffViewer
  type AnyFileChange = import("parse-diff").File;

  interface Props {
    selectedPatch: Patch | null;
    patchSet: Patch[];
    onNavigatePrevious?: () => void;
    onNavigateNext?: () => void;
    showNavigation?: boolean;
    showFileStats?: boolean;
    showPatchInfo?: boolean;
    comments?: any[];
    rootEvent?: any;
    onComment?: (comment: any) => void;
    currentPubkey?: string | null;
    repo?: Repo;
    publish?: (permalink: PermalinkEvent) => Promise<void>;
    enablePermalinks?: boolean;
    diffViewerProps?: {
      showLineNumbers?: boolean;
      expandAll?: boolean;
      enablePermalinks?: boolean;
    };
  }

  const {
    selectedPatch,
    patchSet = [],
    onNavigatePrevious,
    onNavigateNext,
    showNavigation = true,
    showFileStats = true,
    showPatchInfo = true,
    comments = [],
    rootEvent,
    onComment,
    currentPubkey,
    repo,
    publish,
    enablePermalinks = false,
    diffViewerProps = {},
  }: Props = $props();

  // Calculate file statistics
  const fileStats = $derived(selectedPatch?.diff ? calculateFileStats(selectedPatch.diff) : null);

  function getFileIcon(extension: string): string {
    const iconMap: Record<string, string> = {
      js: "🟨",
      ts: "🔷",
      jsx: "⚛️",
      tsx: "⚛️",
      vue: "💚",
      svelte: "🔥",
      py: "🐍",
      java: "☕",
      cpp: "⚙️",
      c: "⚙️",
      cs: "🔷",
      php: "🐘",
      rb: "💎",
      go: "🐹",
      rs: "🦀",
      swift: "🍎",
      kt: "🎯",
      scala: "🔷",
      html: "🌐",
      css: "🎨",
      scss: "🎨",
      sass: "🎨",
      less: "🎨",
      json: "📋",
      xml: "📋",
      yaml: "📋",
      yml: "📋",
      toml: "📋",
      md: "📝",
      txt: "📄",
      sql: "🗃️",
      sh: "💻",
      bash: "💻",
      zsh: "💻",
      fish: "💻",
      dockerfile: "🐳",
      gitignore: "📁",
      env: "🔧",
      config: "⚙️",
      conf: "⚙️",
      lock: "🔒",
      log: "📊",
      test: "🧪",
      spec: "🧪",
      story: "📖",
      svg: "🖼️",
      png: "🖼️",
      jpg: "🖼️",
      jpeg: "🖼️",
      gif: "🖼️",
      ico: "🖼️",
      pdf: "📕",
      zip: "📦",
      tar: "📦",
      gz: "📦",
      unknown: "📄",
    };
    return iconMap[extension.toLowerCase()] || iconMap["unknown"];
  }

  function calculateFileStats(diff: AnyFileChange[]) {
    return diff.reduce(
      (acc, file) => {
        // Accurate calculation using parse-diff structure
        const added = (file.chunks ?? []).reduce((chunkAcc: number, chunk: any) => {
          const adds = chunk.changes?.filter((ch: any) => ch.type === "add").length ?? 0;
          return chunkAcc + adds;
        }, 0);
        const removed = (file.chunks ?? []).reduce((chunkAcc: number, chunk: any) => {
          const dels = chunk.changes?.filter((ch: any) => ch.type === "del").length ?? 0;
          return chunkAcc + dels;
        }, 0);
        return { added: acc.added + added, removed: acc.removed + removed };
      },
      { added: 0, removed: 0 }
    );
  }

  // Navigation state
  const currentIndex = $derived(patchSet.findIndex((p: Patch) => p.id === selectedPatch?.id));
  const hasPrevious = $derived(currentIndex > 0);
  const hasNext = $derived(currentIndex < patchSet.length - 1);

  // Dynamic DiffViewer import to avoid circular dependencies
  let DiffViewer: any = $state(null);

  $effect(() => {
    const loadDiffViewer = async () => {
      try {
        const module = await import("./DiffViewer.svelte");
        DiffViewer = module.default;
      } catch (error) {
        console.error("[PatchViewer] Failed to load DiffViewer:", error);
      }
    };
    loadDiffViewer();
  });
</script>

<div class="patch-viewer space-y-6">
  <!-- File Statistics Section -->
  {#if showFileStats}
    <div class="file-impact-analysis">
      <div class="mb-4 flex items-center justify-between">
        <h3 class="flex items-center gap-2 text-lg font-medium">
          <FileCode class="h-5 w-5" />
          File Impact Analysis
        </h3>
      </div>

      {#if !selectedPatch?.diff || selectedPatch.diff.length === 0}
        <div
          class="rounded-lg border border-sky-200 bg-sky-50 p-4 dark:border-sky-900 dark:bg-sky-950/30"
        >
          <div class="flex items-start gap-3">
            <Info class="mt-0.5 h-5 w-5 flex-shrink-0 text-sky-700 dark:text-sky-300" />
            <div>
              <h4 class="text-sm font-medium text-sky-900 dark:text-sky-200">No File Changes</h4>
              <p class="text-sm text-sky-800 dark:text-sky-300">
                This patch doesn't modify any files.
              </p>
            </div>
          </div>
        </div>
      {:else if fileStats}
        <!-- Impact Summary -->
        <div class="mb-4 rounded-lg border border-muted bg-muted/30 p-4">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-2">
              {#if fileStats.added === 0 && fileStats.removed === 0}
                <AlertTriangle class="h-4 w-4 text-orange-600" />
                <span class="text-sm font-medium text-orange-600">No line changes detected</span>
              {:else if fileStats.added + fileStats.removed < 10}
                <CheckCircle class="h-4 w-4 text-emerald-700 dark:text-emerald-300" />
                <span class="text-sm font-medium text-emerald-700 dark:text-emerald-300"
                  >Minor changes</span
                >
              {:else if fileStats.added + fileStats.removed < 100}
                <Info class="h-4 w-4 text-sky-700 dark:text-sky-300" />
                <span class="text-sm font-medium text-sky-700 dark:text-sky-300"
                  >Moderate changes</span
                >
              {:else}
                <AlertTriangle class="h-4 w-4 text-orange-600" />
                <span class="text-sm font-medium text-orange-600">Significant changes</span>
              {/if}
            </div>
            <span class="text-xs text-muted-foreground">
              {fileStats.added + fileStats.removed} total line{fileStats.added +
                fileStats.removed !==
              1
                ? "s"
                : ""} affected
            </span>
          </div>
          {#if fileStats.added === 0 && fileStats.removed === 0}
            <p class="mt-2 text-xs text-muted-foreground">
              Files may have been renamed or permissions changed without content modifications.
            </p>
          {:else}
            <p class="mt-2 text-xs text-muted-foreground">
              Change ratio: {Math.round(
                (fileStats.added / (fileStats.added + fileStats.removed)) * 100
              )}% additions,
              {Math.round((fileStats.removed / (fileStats.added + fileStats.removed)) * 100)}%
              deletions
            </p>
          {/if}
        </div>

        <!-- Statistics Grid -->
        <div class="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3 sm:gap-4">
          <div class="rounded-lg border bg-muted/20 p-3 text-center">
            <div class="text-2xl font-bold text-primary">{selectedPatch.diff.length}</div>
            <div class="text-sm text-muted-foreground">Files Changed</div>
            <div class="text-xs text-muted-foreground mt-1">
              {selectedPatch.diff.length === 1 ? "Single file" : "Multiple files"}
            </div>
          </div>

          <div
            class="rounded-lg border bg-emerald-50 p-3 text-center dark:border-emerald-900 dark:bg-emerald-950/30"
          >
            <div class="text-2xl font-bold text-emerald-700 dark:text-emerald-300">
              +{fileStats.added}
            </div>
            <div class="text-sm text-muted-foreground">Lines Added</div>
            <div class="text-xs text-muted-foreground mt-1">
              {fileStats.added === 0
                ? "No additions"
                : fileStats.added < 10
                  ? "Few additions"
                  : fileStats.added < 50
                    ? "Moderate additions"
                    : "Many additions"}
            </div>
          </div>

          <div
            class="rounded-lg border bg-rose-50 p-3 text-center dark:border-rose-900 dark:bg-rose-950/30"
          >
            <div class="text-2xl font-bold text-rose-700 dark:text-rose-300">
              -{fileStats.removed}
            </div>
            <div class="text-sm text-muted-foreground">Lines Removed</div>
            <div class="text-xs text-muted-foreground mt-1">
              {fileStats.removed === 0
                ? "No deletions"
                : fileStats.removed < 10
                  ? "Few deletions"
                  : fileStats.removed < 50
                    ? "Moderate deletions"
                    : "Many deletions"}
            </div>
          </div>
        </div>

        <!-- File Type Analysis -->
        <div class="rounded-lg border border-muted bg-muted/30 p-4">
          <h4 class="text-sm font-medium mb-3">File Types</h4>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
            {#each selectedPatch.diff as file}
              {@const extension =
                file.to?.split(".").pop() || file.from?.split(".").pop() || "unknown"}
              {@const fileIcon = getFileIcon(extension)}
              <div class="flex items-center gap-1 p-1 rounded bg-background">
                <span class="text-muted-foreground">{fileIcon}</span>
                <span class="font-mono truncate">{extension}</span>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Changes Section with Navigation -->
  <div class="changes-section">
    <div class="mb-4 flex items-center justify-between">
      <h2 class="text-lg font-medium">Changes</h2>

      <!-- Navigation Controls -->
      {#if showNavigation && patchSet.length > 1}
        <div class="flex items-center gap-2">
          {#key selectedPatch?.id}
            <Button
              variant="outline"
              size="sm"
              disabled={!hasPrevious}
              onclick={onNavigatePrevious}
            >
              <ChevronLeft class="mr-1 h-4 w-4" />
              Previous
            </Button>

            <span class="text-sm text-muted-foreground">
              {currentIndex + 1} of {patchSet.length}
            </span>

            <Button variant="outline" size="sm" disabled={!hasNext} onclick={onNavigateNext}>
              Next
              <ChevronRight class="ml-1 h-4 w-4" />
            </Button>
          {/key}
        </div>
      {/if}
    </div>

    <!-- Patch Set with Preview Info -->
    <div class="mb-6 overflow-hidden rounded-md border border-border">
      {#key selectedPatch?.id}
        <div>
          {#if showPatchInfo && selectedPatch}
            <div
              class="flex w-full items-center gap-3 border-b border-border p-3 text-left last:border-b-0 hover:bg-secondary/20"
            >
              <div class="flex-shrink-0">
                <GitCommit class="h-5 w-5 text-primary" />
              </div>
              <div class="flex-grow min-w-0">
                <div
                  class="line-clamp-2 break-words font-semibold overflow-hidden"
                  title={selectedPatch.title || `Patch ${selectedPatch.id}`}
                >
                  {selectedPatch.title || `Patch ${selectedPatch.id}`}
                </div>
                <div
                  class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm sm:text-base text-muted-foreground"
                >
                  <span>
                    {selectedPatch.author.name || selectedPatch.author.pubkey.slice(0, 8)}
                  </span>
                  <span class="hidden sm:inline">•</span>
                  <span class="break-words"
                    >{new Date(selectedPatch.createdAt).toLocaleString()}</span
                  >
                  {#if selectedPatch.commitHash}
                    <span class="hidden sm:inline">•</span>
                    <span class="font-mono">{selectedPatch.commitHash.slice(0, 8)}</span>
                  {/if}
                </div>
              </div>
            </div>
          {/if}

          <!-- Diff Viewer -->
          {#if selectedPatch?.diff}
            <div class="diff-viewer-container">
              {#if DiffViewer}
                <DiffViewer
                  {...diffViewerProps}
                  diff={selectedPatch.diff}
                  comments={comments}
                  rootEvent={rootEvent}
                  onComment={onComment}
                  currentPubkey={currentPubkey}
                  repo={repo}
                  publish={publish}
                  enablePermalinks={enablePermalinks}
                />
              {:else}
                <div class="p-4 text-center text-muted-foreground">Loading diff viewer...</div>
              {/if}
            </div>
          {:else}
            <div class="p-4 text-center text-muted-foreground">No changes to display.</div>
          {/if}
        </div>
      {/key}
    </div>
  </div>
</div>

<style>
  .diff-viewer-container {
    border-top: 1px solid hsl(var(--ng-border));
  }
</style>
