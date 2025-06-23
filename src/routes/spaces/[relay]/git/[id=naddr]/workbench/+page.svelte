<script lang="ts">
  import {
    GitMerge,
    GitPullRequest,
    AlertTriangle,
    CheckCircle,
    XCircle,
    Zap,
    ArrowRight,
    Eye,
    Layers,
    Target,
    GitBranch,
  } from "@lucide/svelte"
  import {Button, Repo} from "@nostr-git/ui"
  import {Card, CardContent, CardHeader, CardTitle} from "@nostr-git/ui"
  import {Tabs, TabsContent, TabsList, TabsTrigger} from "@nostr-git/ui"
  import {Badge} from "@nostr-git/ui"
  import {PatchSelector, CommitSelector, MergeAnalyzer, ConflictVisualizer} from "@nostr-git/ui"

  const {data} = $props()
  const {repoClass} = data

  let selectedPatch = $state<any>(null)
  let selectedCommit = $state<any>(null)
  let mergeAnalysis = $state<any>(null)
  let isAnalyzing = $state(false)

  // Simulate merge analysis when both patch and commit are selected
  $effect(() => {
    if ($selectedPatch && $selectedCommit) {
      isAnalyzing = true
      // Simulate analysis delay
      setTimeout(() => {
        mergeAnalysis = {
          compatibility: $selectedPatch.id === "patch-002" ? "conflicts" : "clean",
          conflictCount: $selectedPatch.id === "patch-002" ? 3 : 0,
          affectedFiles:
            selectedPatch.id === "patch-002"
              ? ["src/components/App.tsx", "src/styles/main.css", "src/auth/login.tsx"]
              : ["src/auth/oauth.ts", "src/types/user.ts"],
          similarity: selectedPatch.id === "patch-002" ? 0.65 : 0.92,
          autoMergeable: selectedPatch.id !== "patch-002",
          riskLevel: selectedPatch.id === "patch-002" ? "high" : "low",
        }
        isAnalyzing = false
      }, 1500)
    }
  })

  const getCompatibilityIcon = (compatibility: string) => {
    switch (compatibility) {
      case "clean":
        return {icon: CheckCircle, color: "text-green-500"}
      case "conflicts":
        return {icon: AlertTriangle, color: "text-orange-500"}
      case "error":
        return {icon: XCircle, color: "text-red-500"}
      default:
        return {icon: Zap, color: "text-blue-500"}
    }
  }

  const getCompatibilityColor = (compatibility: string) => {
    switch (compatibility) {
      case "clean":
        return "border-green-200 bg-green-50"
      case "conflicts":
        return "border-orange-200 bg-orange-50"
      case "error":
        return "border-red-200 bg-red-50"
      default:
        return "border-blue-200 bg-blue-50"
    }
  }
</script>

<div>
  <div class="mt-6">
    <div class="mb-6">
      <div class="mb-2 flex items-center gap-3">
        <div class="rounded-lg bg-gradient-to-br from-purple-500 to-blue-600 p-2">
          <Layers class="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 class="text-2xl font-bold">Git Workbench</h1>
          <p class="text-muted-foreground">
            Compare patches to commits and analyze merge compatibility with advanced visual tools
          </p>
        </div>
      </div>
    </div>

    <div class="mb-6 grid grid-cols-2 gap-6">
      <PatchSelector patches={repoClass.patches} selectedPatch={$selectedPatch} onPatchSelect={(patch: any) => selectedPatch = patch} />
      <CommitSelector commits={repoClass.commits} selectedCommit={$selectedCommit} onCommitSelect={(commit: any) => selectedCommit = commit} />
    </div>

    {#if selectedPatch && selectedCommit}
      <div class="mb-6 flex justify-center">
        <div class="flex items-center gap-4 rounded-lg bg-secondary/30 p-4">
          <Badge variant="outline" class="gap-2">
            <GitPullRequest class="h-3 w-3" />
            {$selectedPatch.name}
          </Badge>
          <ArrowRight class="h-6 w-6 animate-pulse text-muted-foreground" />
          <Badge variant="outline" class="gap-2">
            <GitBranch class="h-3 w-3" />
            {$selectedCommit.hash}
          </Badge>
        </div>
      </div>
    {/if}

    {#if mergeAnalysis || isAnalyzing}
      <div class="space-y-6">
        <Card class={mergeAnalysis ? getCompatibilityColor(mergeAnalysis.compatibility) : ""}>
          <CardHeader class="pb-3">
            <CardTitle class="flex items-center gap-2 text-lg">
              {#if isAnalyzing}
                <Zap class="h-5 w-5 animate-spin text-blue-500" />
                Analyzing Merge Compatibility...
              {:else}
                {getCompatibilityIcon(mergeAnalysis.compatibility)}
                Merge Analysis Complete
              {/if}
            </CardTitle>
          </CardHeader>
          {#if mergeAnalysis}
            <CardContent>
              <div class="mb-4 grid grid-cols-4 gap-4">
                <div class="text-center">
                  <div class="text-2xl font-bold text-blue-600">
                    {Math.round(mergeAnalysis.similarity * 100)}%
                  </div>
                  <div class="text-xs text-muted-foreground">Similarity</div>
                </div>
                <div class="text-center">
                  <div class="text-2xl font-bold text-orange-600">
                    {mergeAnalysis.conflictCount}
                  </div>
                  <div class="text-xs text-muted-foreground">Conflicts</div>
                </div>
                <div class="text-center">
                  <div class="text-2xl font-bold text-purple-600">
                    {mergeAnalysis.affectedFiles.length}
                  </div>
                  <div class="text-xs text-muted-foreground">Files</div>
                </div>
                <div class="text-center">
                  <Badge
                    variant={mergeAnalysis.riskLevel === "low" ? "default" : "destructive"}
                    class="text-xs">
                    {mergeAnalysis.riskLevel} risk
                  </Badge>
                </div>
              </div>

              <div class="flex items-center justify-between">
                <div class="flex items-center gap-2">
                  <Target class="h-4 w-4" />
                  <span class="text-sm">
                    {mergeAnalysis.autoMergeable
                      ? "Auto-mergeable"
                      : "Manual intervention required"}
                  </span>
                </div>

                <div class="flex gap-2">
                  <Button size="sm" variant="outline" class="gap-2">
                    <Eye class="h-3 w-3" />
                    Preview Merge
                  </Button>
                  <Button size="sm" class="gap-2" disabled={!mergeAnalysis.autoMergeable}>
                    <GitMerge class="h-3 w-3" />
                    Apply Merge
                  </Button>
                </div>
              </div>
            </CardContent>
          {/if}
        </Card>

        {#if mergeAnalysis}
          <Tabs value="analyzer" class="w-full">
            <TabsList class="grid w-full grid-cols-2">
              <TabsTrigger value="analyzer">Merge Analyzer</TabsTrigger>
              <TabsTrigger value="conflicts">
                Conflict Visualizer
                {#if mergeAnalysis.conflictCount > 0}
                  <Badge variant="destructive" class="ml-2">
                    {mergeAnalysis.conflictCount}
                  </Badge>
                {/if}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="analyzer">
              <MergeAnalyzer
                analysis={mergeAnalysis}
                patch={selectedPatch}
                commit={selectedCommit} />
            </TabsContent>

            <TabsContent value="conflicts">
              <ConflictVisualizer
                conflicts={mergeAnalysis.conflictCount > 0
                  ? [
                      {
                        file: "src/components/App.tsx",
                        lines: "23-31",
                        type: "content",
                        severity: "high",
                      },
                      {
                        file: "src/styles/main.css",
                        lines: "45-48",
                        type: "formatting",
                        severity: "low",
                      },
                      {
                        file: "src/auth/login.tsx",
                        lines: "15-20",
                        type: "structure",
                        severity: "medium",
                      },
                    ]
                  : []}
                analysis={mergeAnalysis} />
            </TabsContent>
          </Tabs>
        {/if}
      </div>

      {#if !selectedPatch || !selectedCommit}
        <Card class="h-96">
          <CardContent class="flex h-full items-center justify-center">
            <div class="text-center text-muted-foreground">
              <Layers class="mx-auto mb-4 h-16 w-16 opacity-50" />
              <h3 class="mb-2 text-xl font-medium">Ready for Analysis</h3>
              <p class="max-w-md text-sm">
                Select a patch and a commit above to begin merge compatibility analysis. The
                workbench will show you exactly what happens when they're combined.
              </p>
            </div>
          </CardContent>
        </Card>
      {/if}
    {/if}
  </div>
</div>
