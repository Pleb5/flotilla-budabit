<script lang="ts">
  import { ChevronDown, Loader2 } from "@lucide/svelte";
  import type { Repo } from "./Repo.svelte";
  import { isDisplayableGitRef } from "./branch-ref";

  const { repo, loadData = true }: { repo: Repo; loadData?: boolean } = $props();

  // Get all refs (branches and tags) from repo
  const refs = $derived.by(() => repo.refs);
  const mainBranch = $derived.by(() => repo.mainBranch || "");
  const branches = $derived.by(() =>
    refs.filter((ref) => ref.type === "heads" && isDisplayableGitRef(ref))
  );
  const tags = $derived.by(() =>
    refs.filter((ref) => ref.type === "tags" && isDisplayableGitRef(ref))
  );
  const selectedBranch = $derived.by(() => repo.selectedBranch || mainBranch || "");
  const selectedLabel = $derived.by(() => {
    if (repo.isRefsLoading && !refs.length) return "Loading branches...";
    if (!refs.length) return "No branches found";
    if (!selectedBranch) return "";
    const isMainBranch =
      selectedBranch === mainBranch && branches.some((branch) => branch.name === selectedBranch);
    return isMainBranch ? `${selectedBranch} (default)` : selectedBranch;
  });
  const selectWidthCh = $derived.by(() => {
    const label = selectedLabel || "Branch";
    const paddingCh = 6;
    const minCh = 12;
    const maxCh = 22;
    return Math.min(maxCh, Math.max(minCh, label.length + paddingCh));
  });
  const isSwitching = $derived.by(() => repo.isBranchSwitching);
  const isLoading = $derived.by(() => repo.isBranchSwitching || repo.isRefsLoading);
  const loadingLabel = $derived.by(() =>
    repo.isRefsLoading && !isSwitching ? "Loading branches" : `Switching to ${selectedBranch}`
  );
  const discoverySource = $derived.by(() => repo.refDiscoverySource);
  const sourceHost = $derived.by(() => {
    const remoteUrl = discoverySource?.remoteUrl || "";
    if (!remoteUrl) return "";
    try {
      return new URL(remoteUrl).hostname;
    } catch {
      return remoteUrl;
    }
  });
  const sourceLabel = $derived.by(() => {
    if (!discoverySource) return "";
    if (discoverySource.kind === "provider-rest") {
      return sourceHost ? `API: ${sourceHost}` : "Provider API";
    }
    if (discoverySource.kind === "git-natural") {
      return sourceHost ? `Natural: ${sourceHost}` : "Git natural";
    }
    if (discoverySource.kind === "git-remote") {
      return sourceHost ? `Remote: ${sourceHost}` : "Git remote";
    }
    if (discoverySource.kind === "repo-state") return "Repo state";
    if (discoverySource.kind === "local") return "Local cache";
    return discoverySource.label || "Branch source";
  });
  const sourceTitle = $derived.by(() => {
    if (!discoverySource) return "";
    return [discoverySource.label, discoverySource.remoteUrl, discoverySource.details]
      .filter(Boolean)
      .join(" · ");
  });

  // Debug logging disabled for performance - uncomment if needed for debugging
  // $effect(() => {
  //   console.log(
  //     "[BranchSelector] refs:",
  //     refs.length,
  //     "branches:",
  //     branches.length,
  //     "tags:",
  //     tags.length
  //   );
  //   console.log("[BranchSelector] selectedBranch:", selectedBranch, "mainBranch:", mainBranch);
  //   console.log("[BranchSelector] isSwitching:", isSwitching);
  // });

  function handleChange(e: Event) {
    const target = e.target as HTMLSelectElement;
    const branchName = target.value;
    const currentSelected = repo.selectedBranch;
    if (branchName && !isSwitching && branchName !== currentSelected) {
      repo.setSelectedBranch(branchName, { persist: true, loadData });
    }
  }
</script>

<div class="flex w-full min-w-0 max-w-full flex-wrap items-center gap-2">
  <div class="relative max-w-full min-w-0">
    <select
      value={selectedBranch}
      onchange={handleChange}
      disabled={isLoading}
      aria-busy={isLoading}
      aria-label="Branch selector"
      title={selectedLabel}
      style={`width: min(${selectWidthCh}ch, 14rem); max-width: 100%;`}
      class="min-w-0 max-w-[11rem] appearance-none truncate rounded-md border border-border bg-background py-2 pl-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:cursor-not-allowed disabled:opacity-50 sm:max-w-[12rem] sm:pl-3 sm:pr-10 xl:max-w-[14rem]"
    >
      {#if repo.isRefsLoading && refs.length === 0}
        <option value="">Loading branches...</option>
      {:else if refs.length === 0}
        <option value="">No branches found</option>
      {:else}
        {#if branches.length > 0}
          <optgroup label="Branches">
            {#each branches as branch (branch.name)}
              <option value={branch.name}>
                {branch.name}{branch.name === mainBranch ? " (default)" : ""}
              </option>
            {/each}
          </optgroup>
        {/if}
        {#if tags.length > 0}
          <optgroup label="Tags">
            {#each tags as tag (tag.name)}
              <option value={tag.name}>{tag.name}</option>
            {/each}
          </optgroup>
        {/if}
      {/if}
    </select>

    <span
      class="pointer-events-none absolute inset-y-0 right-2.5 flex items-center text-muted-foreground sm:right-3"
      aria-hidden="true"
    >
      {#if isLoading}
        <Loader2 class="h-3.5 w-3.5 animate-spin" />
      {:else}
        <ChevronDown class="h-3.5 w-3.5 opacity-70" />
      {/if}
    </span>

    {#if isLoading}
      <span class="sr-only" aria-live="polite">{loadingLabel}</span>
    {/if}
  </div>
  {#if sourceLabel}
    <span
      class="hidden min-w-0 max-w-full truncate rounded border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline-block"
      title={sourceTitle}
    >
      {sourceLabel}
    </span>
  {/if}
</div>
