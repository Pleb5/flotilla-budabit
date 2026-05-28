<script lang="ts">
  import type { Repo } from "./Repo.svelte";
  import type { StatusEvent } from "@nostr-git/core/events";
  import {
    GIT_STATUS_OPEN,
    GIT_STATUS_DRAFT,
    GIT_STATUS_CLOSED,
    GIT_STATUS_APPLIED,
    isStatusAuthorized,
    resolveStatus,
  } from "@nostr-git/core/events";
  import { CircleCheck, CircleDot, Clock, AlertCircle, X } from "@lucide/svelte";
  import { Button } from "../ui/button";
  import { Textarea } from "../ui/textarea";
  import { Label } from "../ui/label";
  import { Input } from "../ui/input";
  import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
  import { Badge } from "../ui/badge";
  import { Separator } from "../ui/separator";
  import { ProfileLink } from "../ui/profile";

  type StatusState = "open" | "draft" | "closed" | "applied" | "resolved";

  interface StatusProps {
    repo: Repo;
    rootId: string;
    rootKind: 1621 | 1618;
    rootAuthor: string;
    statusEvents?: StatusEvent[];
    actorPubkey?: string;
    compact?: boolean;
    onPublish?: (event: StatusEvent) => Promise<any>;
    ProfileComponent?: any;
    isMirrored?: boolean;
  }

  const {
    repo,
    rootId,
    rootKind,
    rootAuthor,
    statusEvents = [],
    actorPubkey,
    compact = false,
    onPublish,
    ProfileComponent = ProfileLink,
    isMirrored = false,
  }: StatusProps = $props();

  // Determine current status
  const maintainerPubkeys = $derived.by(() => {
    const maintainers = repo.maintainers || [];
    return new Set(maintainers.filter(Boolean));
  });

  const repoOwner = $derived.by(() => (repo as any).repoEvent?.pubkey || (repo as any).owner || "");

  // Authority check
  const isAuthorized = $derived.by(() => {
    if (!actorPubkey) return false;
    if (repoOwner && actorPubkey === repoOwner) return true;
    if (maintainerPubkeys.has(actorPubkey)) return true;
    return !isMirrored && actorPubkey === rootAuthor;
  });

  const authorizedEvents = $derived.by(() => {
    return statusEvents.filter((status) =>
      isStatusAuthorized({
        status,
        rootAuthor,
        maintainers: maintainerPubkeys,
        repoOwner,
        importedRoot: isMirrored,
      })
    );
  });

  const suggestedEvents = $derived.by(() => {
    return statusEvents.filter(
      (status) =>
        !isStatusAuthorized({
          status,
          rootAuthor,
          maintainers: maintainerPubkeys,
          repoOwner,
          importedRoot: isMirrored,
        })
    );
  });

  const currentStatusEvent = $derived.by(() => {
    return resolveStatus({
      statuses: statusEvents as any,
      rootAuthor,
      maintainers: maintainerPubkeys,
      repoOwner,
      importedRoot: isMirrored,
    }).final as StatusEvent | undefined;
  });

  const currentState = $derived.by((): StatusState => {
    if (!currentStatusEvent) return "open";
    switch (currentStatusEvent.kind) {
      case GIT_STATUS_OPEN:
        return "open";
      case GIT_STATUS_DRAFT:
        return "draft";
      case GIT_STATUS_CLOSED:
        return "closed";
      case GIT_STATUS_APPLIED:
        return rootKind === 1621 ? "resolved" : "applied";
      default:
        return "open";
    }
  });

  // History sorted by recency
  const history = $derived.by(() => {
    return [...authorizedEvents].sort((a, b) => b.created_at - a.created_at);
  });

  const suggestions = $derived.by(() => {
    return [...suggestedEvents].sort((a, b) => b.created_at - a.created_at);
  });

  // UI state
  let showEditor = $state(false);
  let selectedState = $state<StatusState>("open");
  let statusNote = $state("");
  let mergeCommit = $state("");
  let appliedCommits = $state("");
  let isPublishing = $state(false);
  let publishError = $state("");

  // UI: show/hide history
  let showHistory = $state(false);
  const pastCount = $derived.by(() => Math.max(history.length - 1, 0));

  // Reset form when editor is closed
  $effect(() => {
    if (!showEditor) {
      selectedState = currentState;
      statusNote = "";
      mergeCommit = "";
      appliedCommits = "";
      publishError = "";
    }
  });

  const getStateIcon = (state: StatusState) => {
    switch (state) {
      case "open":
        return {
          icon: CircleDot,
          color: "text-emerald-700 dark:text-emerald-300",
          bg: "bg-emerald-50 dark:bg-emerald-950/30",
          border: "border-emerald-200 dark:border-emerald-900",
        };
      case "draft":
        return {
          icon: Clock,
          color: "text-amber-700 dark:text-amber-300",
          bg: "bg-amber-50 dark:bg-amber-950/30",
          border: "border-amber-200 dark:border-amber-900",
        };
      case "closed":
        return {
          icon: X,
          color: "text-rose-700 dark:text-rose-300",
          bg: "bg-rose-50 dark:bg-rose-950/30",
          border: "border-rose-200 dark:border-rose-900",
        };
      case "applied":
        return {
          icon: CircleCheck,
          color: "text-sky-700 dark:text-sky-300",
          bg: "bg-sky-50 dark:bg-sky-950/30",
          border: "border-sky-200 dark:border-sky-900",
        };
      case "resolved":
        return {
          icon: CircleCheck,
          color: "text-sky-700 dark:text-sky-300",
          bg: "bg-sky-50 dark:bg-sky-950/30",
          border: "border-sky-200 dark:border-sky-900",
        };
    }
  };

  const stateToKind = (state: StatusState): number => {
    switch (state) {
      case "open":
        return GIT_STATUS_OPEN;
      case "draft":
        return GIT_STATUS_DRAFT;
      case "closed":
        return GIT_STATUS_CLOSED;
      case "applied":
      case "resolved":
        return GIT_STATUS_APPLIED;
    }
  };

  const kindToState = (kind: number): StatusState => {
    switch (kind) {
      case GIT_STATUS_OPEN:
        return "open";
      case GIT_STATUS_DRAFT:
        return "draft";
      case GIT_STATUS_CLOSED:
        return "closed";
      case GIT_STATUS_APPLIED:
        return rootKind === 1621 ? "resolved" : "applied";
      default:
      return "open";
    }
  };

  const getStateLabel = (state: StatusState) => {
    if (state === "applied") return "Merged";
    return state.charAt(0).toUpperCase() + state.slice(1);
  };

  /** For mirrored status events (from import): get original_date and whether to show "imported by" */
  function getStatusDisplayInfo(event: StatusEvent): {
    isMirrored: boolean;
    displayDate: Date;
  } {
    console.log("[Status] getStatusDisplayInfo", event);

    const tags = (event.tags || []) as Array<[string, string]>;
    const hasImported = tags.some((t) => t[0] === "imported");
    const originalDateTag = tags.find((t) => t[0] === "original_date")?.[1];
    const isMirrored = !!(hasImported && originalDateTag);
    const sec = originalDateTag ? parseInt(originalDateTag, 10) : NaN;
    const displayDate =
      isMirrored && !Number.isNaN(sec)
        ? new Date(sec * 1000)
        : new Date((event.created_at ?? 0) * 1000);
    return {
      isMirrored,
      displayDate,
    };
  }

  const getDefaultCommit = async (): Promise<string> => {
    try {
      const result = await repo.getCommitHistory({ depth: 1 });
      const history = Array.isArray(result)
        ? result
        : Array.isArray(result?.commits)
          ? result.commits
          : [];
      return history?.[0]?.oid || "";
    } catch (e) {
      console.error("Failed to get default commit:", e);
      return "";
    }
  };

  const handlePublish = async () => {
    if (isPublishing) return;

    console.log("[Status] Publishing status", { selectedState, rootId, rootKind });

    isPublishing = true;
    publishError = "";

    try {
      const kind = stateToKind(selectedState);
      const repoEvent = (repo as any).repoEvent;
      const repoAddr = repoEvent
        ? `${repoEvent.kind}:${repoEvent.pubkey}:${repoEvent.tags.find((t: string[]) => t[0] === "d")?.[1] || ""}`
        : "";
      const relays = repo.relays || [];
      const repoEuc = repoEvent?.tags?.find((t: string[]) => t[0] === "r" && t[2] === "euc")?.[1];

      // Build tags
      const tags: string[][] = [["e", rootId, "", "root"]];

      if (repoAddr) {
        const relayHint = relays[0] || "";
        tags.push(["a", repoAddr, relayHint]);
      }

      if (repoEuc) {
        tags.push(["r", repoEuc]);
      }

      // Add merge metadata for 1631 (applied/resolved)
      if (kind === GIT_STATUS_APPLIED) {
        let commitSha = mergeCommit.trim();
        if (!commitSha) {
          commitSha = await getDefaultCommit();
        }

        if (commitSha) {
          tags.push(["merge-commit", commitSha]);
          tags.push(["r", commitSha]);
        }

        const commits = appliedCommits
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

        if (commits.length > 0) {
          tags.push(["applied-as-commits", ...commits]);
          commits.forEach((c) => tags.push(["r", c]));
        } else if (commitSha) {
          // Default to merge commit if no applied commits specified
          tags.push(["applied-as-commits", commitSha]);
        }
      }

      // Add recipients
      const recipients = [actorPubkey, rootAuthor, repoEvent?.pubkey].filter(Boolean) as string[];
      recipients.forEach((p) => tags.push(["p", p]));

      const statusEvent: any = {
        kind,
        content: statusNote.trim(),
        tags: tags as any,
        created_at: Math.floor(Date.now() / 1000),
        pubkey: actorPubkey!,
        id: "",
        sig: "",
      };

      console.log("[Status] Publishing status event", statusEvent);

      if (onPublish) {
        await onPublish(statusEvent);
      }

      showEditor = false;

      console.log("[Status] Status published successfully");
    } catch (error) {
      console.error("[Status] Failed to publish status:", error);
      publishError = error instanceof Error ? error.message : "Failed to publish status";
    } finally {
      isPublishing = false;
    }
  };

  const handleAdopt = async (suggestion: StatusEvent) => {
    console.log("[Status] Adopting suggestion", suggestion);

    const state = kindToState(suggestion.kind);
    selectedState = state;
    statusNote = suggestion.content || "";

    // Extract merge metadata if present
    const mergeCommitTag = suggestion.tags.find((t) => t[0] === "merge-commit");
    if (mergeCommitTag) {
      mergeCommit = mergeCommitTag[1] || "";
    }

    const appliedTag = suggestion.tags.find((t) => t[0] === "applied-as-commits");
    if (appliedTag) {
      appliedCommits = appliedTag.slice(1).join(", ");
    }

    await handlePublish();
  };

  const availableStates = $derived.by((): StatusState[] => {
    if (rootKind === 1621) {
      return ["open", "draft", "resolved", "closed"];
    }
    return ["open", "draft", "applied", "closed"];
  });
</script>

{#if compact}
  <!-- Compact mode: just a badge -->
  <div class="inline-flex items-center gap-1">
    {#snippet compactBadge()}
      {@const { icon: Icon, color, bg, border } = getStateIcon(currentState)}
      <Badge variant="outline" class={`${bg} ${border} ${color} gap-1 text-[10px]`}>
        <Icon class="h-3 w-3" />
        {getStateLabel(currentState)}
      </Badge>
    {/snippet}
    {@render compactBadge()}
  </div>
{:else}
  <!-- Full mode: complete status UI -->
  <Card>
    <CardHeader>
      <CardTitle class="flex items-center gap-2 text-base sm:text-lg">
        <AlertCircle class="h-4 w-4 sm:h-5 sm:w-5 flex-shrink-0" />
        Status
      </CardTitle>
    </CardHeader>
    <CardContent class="space-y-3 sm:space-y-4 p-4 sm:p-6">
      <!-- Current Status -->
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {#snippet currentStatusBadge()}
          {@const { icon: Icon, color, bg, border } = getStateIcon(currentState)}
          <div class="flex flex-col sm:flex-row sm:items-center gap-2 min-w-0 flex-1">
            <Badge
              variant="outline"
              class={`${bg} ${border} ${color} gap-1 text-xs sm:text-sm w-fit`}
            >
              <Icon class="h-3 w-3 sm:h-4 sm:w-4" />
              {getStateLabel(currentState)}
            </Badge>
            {#if currentStatusEvent}
              {@const info = getStatusDisplayInfo(currentStatusEvent)}
              <span class="text-xs text-muted-foreground flex flex-wrap items-center gap-1">
                <span>by</span>
                <ProfileComponent pubkey={currentStatusEvent.pubkey} />
                <span class="hidden sm:inline">•</span>
                <span class="break-all sm:break-normal">{info.displayDate.toLocaleString()}</span>
              </span>
            {/if}
          </div>
        {/snippet}
        {@render currentStatusBadge()}

        <div class="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          {#if isAuthorized}
            <Button
              size="sm"
              variant="outline"
              onclick={() => (showEditor = !showEditor)}
              class="w-full sm:w-auto text-xs sm:text-sm"
            >
              {showEditor ? "Cancel" : "Change Status"}
            </Button>
          {/if}
          <Button
            size="sm"
            variant="outline"
            onclick={() => (showHistory = !showHistory)}
            disabled={pastCount === 0}
            class="w-full sm:w-auto text-xs sm:text-sm whitespace-normal sm:whitespace-nowrap"
          >
            {pastCount === 0
              ? "No History"
              : showHistory
                ? "Hide History"
                : `Show History (${pastCount})`}
          </Button>
        </div>
      </div>

      <!-- Editor -->
      {#if showEditor && isAuthorized}
        <div class="space-y-3 rounded-md border border-border bg-muted/30 p-3 sm:p-4">
          <div>
            <Label for="status-state" class="text-sm">New Status</Label>
            <div class="mt-2 flex flex-wrap gap-2">
              {#each availableStates as state (state)}
                {#snippet stateButton()}
                  {@const { icon: Icon, color, bg, border } = getStateIcon(state)}
                  <Button
                    size="sm"
                    variant={selectedState === state ? "default" : "outline"}
                    onclick={() => (selectedState = state)}
                    class="gap-1"
                  >
                    <Icon class="h-3 w-3" />
                    {getStateLabel(state)}
                  </Button>
                {/snippet}
                {@render stateButton()}
              {/each}
            </div>
          </div>

          <div>
            <Label for="status-note" class="text-sm">Note (optional)</Label>
            <Textarea
              id="status-note"
              bind:value={statusNote}
              placeholder="Add a note about this status change..."
              rows={3}
              class="mt-1 text-sm resize-none"
            />
          </div>

          {#if selectedState === "applied" || selectedState === "resolved"}
            <div class="space-y-2 rounded border border-border/50 bg-background p-2 sm:p-3">
              <p class="text-[10px] sm:text-xs text-muted-foreground">
                Merge metadata (optional, defaults to current HEAD)
              </p>
              <div>
                <Label for="merge-commit" class="text-[10px] sm:text-xs">Merge Commit SHA</Label>
                <Input
                  id="merge-commit"
                  bind:value={mergeCommit}
                  placeholder="Leave empty for HEAD"
                  class="mt-1 text-xs h-9 sm:h-10"
                />
              </div>
              <div>
                  <Label for="applied-commits" class="text-[10px] sm:text-xs"
                  >Merged Commits (comma-separated)</Label
                >
                <Input
                  id="applied-commits"
                  bind:value={appliedCommits}
                  placeholder="sha1, sha2, sha3..."
                  class="mt-1 text-xs h-9 sm:h-10"
                />
              </div>
            </div>
          {/if}

          {#if publishError}
            <div
              class="rounded bg-destructive/10 p-2 text-[10px] sm:text-xs text-destructive break-words"
            >
              {publishError}
            </div>
          {/if}

          <div class="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-2">
            <Button
              size="sm"
              onclick={handlePublish}
              disabled={isPublishing}
              class="w-full sm:w-auto text-xs sm:text-sm min-h-[36px] sm:min-h-0"
            >
              {isPublishing ? "Publishing..." : "Publish Status"}
            </Button>
          </div>
        </div>
      {/if}

      <!-- History -->
      <div>
        <Separator class="my-2 sm:my-3" />
        {#if showHistory && pastCount > 0}
          <div class="space-y-2">
            {#each history.slice(1) as event (event.id)}
              {#snippet historyItem()}
                {@const state = kindToState(event.kind)}
                {@const { icon: Icon, color } = getStateIcon(state)}
                {@const info = getStatusDisplayInfo(event)}
                <div class="flex items-start gap-2 text-[10px] sm:text-xs">
                  <Icon class={`mt-0.5 h-3 w-3 ${color} flex-shrink-0`} />
                  <div class="flex-1 min-w-0">
                    <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                      <span class="font-medium"
                        >{getStateLabel(state)}</span
                      >
                      <span class="text-muted-foreground flex items-center gap-1 flex-wrap">
                        <span>by</span>
                        <ProfileComponent pubkey={event.pubkey} />
                        <span class="hidden sm:inline">•</span>
                        <span class="break-all sm:break-normal"
                          >{info.displayDate.toLocaleString()}</span
                        >
                      </span>
                    </div>
                    {#if event.content}
                      <p class="mt-1 text-muted-foreground break-words">{event.content}</p>
                    {/if}
                  </div>
                </div>
              {/snippet}
              {@render historyItem()}
            {/each}
          </div>
        {/if}
      </div>

      <!-- Suggestions -->
      {#if suggestions.length > 0 && isAuthorized}
        <div>
          <Separator class="my-2 sm:my-3" />
          <h4 class="mb-2 text-xs sm:text-sm font-medium">Suggestions from Community</h4>
          <div class="space-y-2">
            {#each suggestions as event (event.id)}
              {#snippet suggestionItem()}
                {@const state = kindToState(event.kind)}
                {@const { icon: Icon, color } = getStateIcon(state)}
                {@const info = getStatusDisplayInfo(event)}
                <div
                  class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 rounded border border-border/50 bg-muted/20 p-2"
                >
                  <div class="flex items-start gap-2 text-[10px] sm:text-xs min-w-0 flex-1">
                    <Icon class={`mt-0.5 h-3 w-3 ${color} flex-shrink-0`} />
                    <div class="flex-1 min-w-0">
                      <div class="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-2">
                        <span class="font-medium"
                          >{getStateLabel(state)}</span
                        >
                        <span class="text-muted-foreground flex items-center gap-1 flex-wrap">
                          <span>by</span>
                          <ProfileComponent pubkey={event.pubkey} />
                          <span class="hidden sm:inline">•</span>
                          <span class="break-all sm:break-normal"
                            >{info.displayDate.toLocaleString()}</span
                          >
                        </span>
                      </div>
                      {#if event.content}
                        <p class="mt-1 text-muted-foreground break-words">{event.content}</p>
                      {/if}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onclick={() => handleAdopt(event)}
                    disabled={isPublishing}
                    class="w-full sm:w-auto text-xs sm:text-sm min-h-[32px] sm:min-h-0 flex-shrink-0"
                  >
                    Adopt
                  </Button>
                </div>
              {/snippet}
              {@render suggestionItem()}
            {/each}
          </div>
        </div>
      {/if}
    </CardContent>
  </Card>
{/if}
