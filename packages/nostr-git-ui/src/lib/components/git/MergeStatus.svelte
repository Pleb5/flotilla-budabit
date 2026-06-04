<script lang="ts">
  import {
    CheckCircle,
    AlertTriangle,
    XCircle,
    GitMerge,
    Clock,
    Info,
    FileText,
    ChevronDown,
    ChevronRight,
  } from "@lucide/svelte";
  import {
    Collapsible,
    CollapsibleContent,
    CollapsibleTrigger,
  } from "../../components";
  import { useRegistry } from "../../useRegistry";
  import type { MergeAnalysisResult } from "@nostr-git/core/git";

  const { Card, CardHeader, CardTitle, CardContent, Badge } = useRegistry();

  // Extend core result type with optional fields used by UI
  type ExtendedMergeAnalysisResult = MergeAnalysisResult & {
    conflictFiles?: string[];
    conflictDetails?: Array<{
      file: string;
      type?: string;
      conflictMarkers?: Array<{ start: number; end: number; type: string }>;
    }>;
    patchCommits?: string[];
    targetCommit?: string;
    remoteCommit?: string;
    mergeBase?: string;
  };

  interface Props {
    result: ExtendedMergeAnalysisResult | null;
    loading?: boolean;
    targetBranch?: string;
  }

  const { result, loading = false, targetBranch = "" }: Props = $props();

  let conflictingFilesOpen = $state(false);

  const getConflictCount = (result: ExtendedMergeAnalysisResult): number => {
    const fileCount = result.conflictFiles?.length ?? 0;
    return fileCount > 0 ? fileCount : (result.conflictDetails?.length ?? 0);
  };

  const getConflictRows = (result: ExtendedMergeAnalysisResult) => {
    const detailsByFile = new Map(
      (result.conflictDetails ?? []).map((detail) => [detail.file, detail]),
    );
    const files =
      (result.conflictFiles?.length ?? 0) > 0
        ? (result.conflictFiles ?? [])
        : (result.conflictDetails ?? []).map((detail) => detail.file);

    return Array.from(new Set(files)).map((file) => ({
      file,
      ...detailsByFile.get(file),
    }));
  };

  const formatConflictType = (type?: string) => type?.replace(/-/g, " ") || "unknown";

  const getStatusIcon = (analysis: string) => {
    switch (analysis) {
      case "clean":
        return { icon: CheckCircle, color: "text-emerald-600 dark:text-emerald-300" };
      case "conflicts":
        return { icon: AlertTriangle, color: "text-amber-600 dark:text-amber-300" };
      case "up-to-date":
        return { icon: Info, color: "text-sky-600 dark:text-sky-300" };
      case "diverged":
        return { icon: AlertTriangle, color: "text-yellow-600 dark:text-yellow-300" };
      case "error":
        return { icon: XCircle, color: "text-rose-600 dark:text-rose-300" };
      default:
        return { icon: Clock, color: "text-muted-foreground" };
    }
  };

  const getStatusColor = (analysis: string) => {
    switch (analysis) {
      case "clean":
        return "border-emerald-200 bg-emerald-50/50 dark:border-emerald-900 dark:bg-emerald-950/20";
      case "conflicts":
        return "border-amber-200 bg-amber-50/50 dark:border-amber-900 dark:bg-amber-950/20";
      case "up-to-date":
        return "border-sky-200 bg-sky-50/50 dark:border-sky-900 dark:bg-sky-950/20";
      case "diverged":
        return "border-yellow-200 bg-yellow-50/50 dark:border-yellow-900 dark:bg-yellow-950/20";
      case "error":
        return "border-rose-200 bg-rose-50/50 dark:border-rose-900 dark:bg-rose-950/20";
      default:
        return "border-border bg-card";
    }
  };

  const getStatusMessage = (result: ExtendedMergeAnalysisResult): string => {
    switch (result.analysis) {
      case "clean":
        return result.fastForward
          ? "This PR can be fast-forward merged without conflicts."
          : "This PR can be merged cleanly without conflicts.";
      case "conflicts":
        return `This PR has merge conflicts in ${result.conflictFiles?.length ?? 0} file(s) that need to be resolved.`;
      case "up-to-date":
        return "This PR has already been merged to the target branch.";
      case "diverged":
        return 'The target branch has diverged from remote. Use "Reset Repo" to sync with remote before merging.';
      case "error":
        return `Unable to analyze merge: ${result.errorMessage || "Unknown error"}`;
      default:
        return "Merge analysis pending...";
    }
  };
</script>

<Card class={result ? getStatusColor(result.analysis) : "border-border"}>
  <CardHeader>
    <CardTitle class="flex items-center gap-2 text-md">
      <GitMerge class="h-4 w-4" />
      Merge Status
      {#if targetBranch}
        <span class="text-xs text-muted-foreground">→ {targetBranch}</span>
      {/if}
      <Badge variant="outline" class="ml-auto">
        {#if loading}
          Analyzing...
        {:else if result}
          {result.analysis}
        {:else}
          Pending
        {/if}
      </Badge>
    </CardTitle>
  </CardHeader>

  <CardContent>
    {#if loading}
      <div class="flex items-center gap-2 text-sm text-muted-foreground">
        <Clock class="h-4 w-4 animate-spin" />
        Analyzing PR mergeability...
      </div>
    {:else if result}
      {#if result.analysis === "clean"}
        <div class="space-y-2">
          <div class="flex items-center gap-2 text-sm">
            <CheckCircle class="h-4 w-4 text-emerald-600 dark:text-emerald-300" />
            <span class="font-medium">Ready to merge</span>
          </div>
          {#if result.fastForward}
            <p class="text-xs text-muted-foreground">
              This is a fast-forward merge - no merge commit will be created.
            </p>
          {:else}
            <p class="text-xs text-muted-foreground">
              A merge commit will be created to combine the changes.
            </p>
          {/if}
        </div>
      {/if}

      {#if result.analysis === "conflicts"}
        <div class="space-y-3">
          <div class="space-y-1">
            <div class="flex items-center gap-2 text-sm">
              <AlertTriangle class="h-4 w-4 text-amber-600 dark:text-amber-300" />
              <span class="font-medium">Cannot merge automatically</span>
            </div>
            <p class="text-xs text-muted-foreground">
              This PR has conflicts that must be resolved before merging. Commits and file changes
              can still be reviewed below.
            </p>
          </div>

          <Collapsible
            bind:open={conflictingFilesOpen}
            class="overflow-hidden rounded-md border border-amber-200 bg-background/60 dark:border-amber-900"
          >
            <CollapsibleTrigger class="w-full">
              <div
                class="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-amber-100/50 dark:hover:bg-amber-950/30"
              >
                <div class="flex min-w-0 items-center gap-2">
                  {#if conflictingFilesOpen}
                    <ChevronDown class="h-4 w-4 shrink-0 text-muted-foreground" />
                  {:else}
                    <ChevronRight class="h-4 w-4 shrink-0 text-muted-foreground" />
                  {/if}
                  <FileText class="h-4 w-4 shrink-0" />
                  <span class="truncate text-sm font-medium">Conflicting files</span>
                </div>
                <Badge variant="outline" class="shrink-0 text-xs">
                  {getConflictCount(result)} file{getConflictCount(result) === 1 ? "" : "s"}
                </Badge>
              </div>
            </CollapsibleTrigger>

            <CollapsibleContent>
              <div class="space-y-2 border-t border-amber-200 p-3 dark:border-amber-900">
                {#each getConflictRows(result) as conflict (conflict.file)}
                  <Card class="min-w-0 overflow-hidden border-amber-200 dark:border-amber-900">
                    <CardContent class="min-w-0 p-3">
                      <div class="mb-2 flex min-w-0 items-center justify-between gap-2">
                        <span class="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-sm">
                          {conflict.file}
                        </span>
                        {#if conflict.type === "content" && conflict.conflictMarkers && conflict.conflictMarkers.length > 0}
                          <Badge variant="destructive" class="shrink-0 text-xs">
                            {conflict.conflictMarkers.length} conflicts
                          </Badge>
                        {/if}
                      </div>

                      <div class="text-xs text-muted-foreground">
                        Type: {formatConflictType(conflict.type)}
                      </div>

                      {#if (conflict.conflictMarkers?.length ?? 0) > 0}
                        <div class="mt-2 space-y-1">
                          {#each conflict.conflictMarkers ?? [] as marker (marker.start)}
                            <div class="text-xs bg-secondary/50 p-2 rounded">
                              <div class="text-muted-foreground mb-1">
                                Lines {marker.start}-{marker.end}: {marker.type.replace(/-/g, " ")}
                              </div>
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </CardContent>
                  </Card>
                {:else}
                  <p class="text-sm text-muted-foreground">
                    Conflict file details were not returned by the merge analysis.
                  </p>
                {/each}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      {/if}

      {#if result.analysis === "diverged"}
        <div class="space-y-3">
          <div class="flex items-center gap-2 text-sm">
            <AlertTriangle class="h-4 w-4 text-yellow-600 dark:text-yellow-300" />
            <span class="font-medium">Branch Divergence Detected</span>
          </div>
          <div class="text-sm text-muted-foreground space-y-2">
            <p>The local branch has diverged from the remote repository.</p>
            <div
              class="rounded-md border border-yellow-200 bg-yellow-50 p-3 dark:border-yellow-900 dark:bg-yellow-950/30"
            >
              <p class="mb-2 font-medium text-yellow-800 dark:text-yellow-200">
                Recommended Actions:
              </p>
              <ul class="space-y-1 text-sm text-yellow-700 dark:text-yellow-300">
                <li>• Use the "Reset Repo" button to sync with remote (discards local changes)</li>
              </ul>
            </div>
            {#if result.targetCommit}
              <div class="text-xs text-muted-foreground">
                <span class="font-medium">Local:</span>
                {result.targetCommit.slice(0, 8)}<br />
                {#if result.remoteCommit}
                  <span class="font-medium">Remote:</span> {result.remoteCommit.slice(0, 8)}
                {:else}
                  <span class="font-medium">Remote:</span>
                  <span class="text-muted-foreground">unknown</span>
                {/if}
              </div>
            {/if}
          </div>
        </div>
      {/if}

      {#if (result.patchCommits?.length ?? 0) > 0}
        <div class="text-xs text-muted-foreground">
          <span class="font-medium">PR commits:</span>
          {result.patchCommits.length}
          {#if result.targetCommit}
            <br />
            <span class="font-medium">Target:</span>
            {result.targetCommit.slice(0, 8)}
          {/if}
          {#if result.mergeBase}
            <br />
            <span class="font-medium">Merge base:</span>
            {result.mergeBase.slice(0, 8)}
          {/if}
        </div>
      {/if}
    {:else}
      <div class="text-sm text-muted-foreground">
        Click "Analyze Merge" to check if this PR can be merged cleanly.
      </div>
    {/if}
  </CardContent>
</Card>
