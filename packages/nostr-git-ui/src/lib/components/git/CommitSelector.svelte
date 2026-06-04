<script lang="ts">
  import { Calendar, GitBranch, GitCommit, User } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  import { formatDistanceToNow } from "date-fns/formatDistanceToNow";
  const {
    Avatar,
    AvatarImage,
    AvatarFallback,
    Card,
    CardHeader,
    CardTitle,
    CardContent,
    ScrollArea,
    Badge,
  } = useRegistry();

  const { commits, selectedCommit, onCommitSelect } = $props();

  const getBranchColor = (branch: string) => {
    switch (branch) {
      case "main":
        return "bg-green-100 text-green-800 border-green-200 dark:bg-green-900/40 dark:text-green-200 dark:border-green-700/60";
      case "develop":
        return "bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/40 dark:text-blue-200 dark:border-blue-700/60";
      default:
        return "bg-purple-100 text-purple-800 border-purple-200 dark:bg-purple-900/40 dark:text-purple-200 dark:border-purple-700/60";
    }
  };

  function truncateHash(hash: string): string {
    return hash.substring(0, 7);
  }

  function formatDate(timestamp: number): string {
    return formatDistanceToNow(new Date(timestamp * 1000), { addSuffix: true });
  }
</script>

<Card>
  <CardHeader class="pb-3">
    <CardTitle class="text-sm flex items-center gap-2">
      <GitCommit class="h-4 w-4" />
      Select Target Commit
    </CardTitle>
  </CardHeader>
  <CardContent class="p-0">
    <ScrollArea class="h-80">
      <div class="p-3 space-y-2">
        {#each commits as commit}
          <button
            class={`w-full text-left p-3 rounded-lg border transition-all focus:outline-none focus:ring-2 focus:ring-primary/50 ${
              selectedCommit?.oid === commit.commit.oid
                ? "border-primary bg-primary/5 shadow-md"
                : "border-gray-200 hover:border-gray-300 dark:border-gray-700 dark:hover:border-gray-600"
            }`}
            onclick={() => onCommitSelect(commit)}
            onkeydown={(e) => (e.key === "Enter" || e.key === " ") && onCommitSelect(commit)}
            aria-pressed={selectedCommit?.oid === commit.commit.oid}
          >
            <div class="flex items-start gap-3">
              <Avatar class="h-6 w-6 mt-0.5">
                <AvatarImage src={commit.commit.author.avatar} alt={commit.commit.author.name} />
              </Avatar>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-1 overflow-hidden">
                  <code class="text-xs font-mono bg-secondary px-1.5 py-0.5 rounded whitespace-nowrap">
                    {truncateHash(commit.oid)}
                  </code>
                  <Badge variant="outline" class={`text-xs whitespace-nowrap ${getBranchColor(commit.branch)}`}>
                    <GitBranch class="h-2.5 w-2.5 mr-1" />
                    <span class="truncate max-w-[80px]" title={commit.branch}>{commit.branch}</span>
                  </Badge>
                </div>

                <p class="text-sm font-medium mb-1 line-clamp-2" title={commit.commit.message}>
                  {commit.commit.message}
                </p>

                <div class="flex items-center justify-between text-xs text-muted-foreground overflow-hidden">
                  <div class="flex items-center gap-2 min-w-0">
                    <User class="h-3 w-3 flex-shrink-0" />
                    <span class="truncate" title={commit.commit.author.name}>{commit.commit.author.name}</span>
                  </div>
                  <div class="flex items-center gap-2 whitespace-nowrap flex-shrink-0">
                    <Calendar class="h-3 w-3" />
                    <span>{formatDate(commit.commit.author.timestamp)}</span>
                  </div>
                </div>

                <div class="text-xs text-muted-foreground mt-1 whitespace-nowrap">
                  {commit.filesChanged} files changed
                </div>
              </div>
            </div>
          </button>
        {/each}
      </div>
    </ScrollArea>
  </CardContent>
</Card>
