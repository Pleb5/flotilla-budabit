<script lang="ts">
  import { z } from "zod";
  import { CircleAlert, GitBranch, ChevronRight, Loader2, GitFork } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  import { createPullRequestEvent } from "@nostr-git/core/events";
  import type { PullRequestEvent } from "@nostr-git/core/events";
  import { X, Plus } from "@lucide/svelte";
  import type { Repo } from "./Repo.svelte";

  const { Button, Input, Textarea, Label, Checkbox } = useRegistry();

  interface Props {
    repo: Repo;
    onPRCreated: (pr: PullRequestEvent) => Promise<void>;
  }

  let { repo, onPRCreated }: Props = $props();

  const cloneUrls = $derived(repo.cloneUrls ?? []);
  const targetBranches = $derived(
    (repo.refs || []).filter((r) => r.type === "heads").map((r) => ({ name: r.name }))
  );

  const back = () => history.back();

  const prSchema = z.object({
    subject: z.string().min(1, "Subject is required"),
    content: z.string(),
    sourceBranch: z.string().min(1, "Source branch is required"),
    targetBranch: z.string().min(1, "Target branch is required"),
    cloneUrls: z.array(z.string()).min(1, "At least one clone URL is required"),
    labels: z.array(z.string()).default([]),
  });

  let subject = $state("");
  let content = $state("");
  let sourceBranch = $state("");
  let targetBranch = $state("");
  let fromFork = $state(false);
  let cloneUrlsText = $state("");
  let labels = $state<string[]>([]);
  let customLabels = $state<string[]>([]);
  let newLabel = $state("");
  let errors = $state<Record<string, string>>({});
  let isSubmitting = $state(false);
  let sourceBranches = $state<Array<{ name: string }>>([]);
  let sourceBranchesLoading = $state(false);
  let sourceBranchesError = $state("");
  let forkFetchRetryNonce = $state(0);
  let prPreview = $state<{
    success: boolean;
    error?: string;
    commits: Array<{ oid: string; message: string; author?: { name?: string } }>;
    commitOids: string[];
    tipCommit?: string;
    filesChanged: string[];
    mergeBase?: string;
  } | null>(null);
  let previewLoading = $state(false);

  const commonLabels = ["enhancement", "bug", "documentation", "ready-for-review"];

  const parseForkCloneUrls = () =>
    cloneUrlsText
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  function handleRetryForkFetch() {
    if (!fromFork) return;
    sourceBranchesError = "";
    forkFetchRetryNonce += 1;
  }

  // Source branches: from repo.refs when same-repo, from fork when fromFork
  $effect(() => {
    const retryNonce = forkFetchRetryNonce;
    void retryNonce;
    if (!fromFork) {
      sourceBranches = targetBranches;
      sourceBranchesLoading = false;
      sourceBranchesError = "";
      return;
    }
    const urls = parseForkCloneUrls();
    if (urls.length === 0 || !repo.workerManager) {
      sourceBranches = [];
      sourceBranchesLoading = false;
      sourceBranchesError = "";
      return;
    }
    let cancelled = false;
    sourceBranchesLoading = true;
    sourceBranchesError = "";
    repo.workerManager
      .listBranchesFromUrls({ cloneUrls: urls })
      .then((res) => {
        if (cancelled) return;
        sourceBranches = (res?.branches || []).map((name) => ({ name }));
        sourceBranchesError = res?.error || "";
        sourceBranchesLoading = false;
      })
      .catch((err) => {
        if (cancelled) return;
        sourceBranches = [];
        sourceBranchesError = err instanceof Error ? err.message : "Failed to load fork branches";
        sourceBranchesLoading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  // Fetch PR preview when both branches selected.
  // For same-repo PRs, source === target is invalid. For fork PRs, both can have the same name (e.g. main→main).
  $effect(() => {
    const retryNonce = forkFetchRetryNonce;
    void retryNonce;
    const sameNameInvalid = !fromFork && sourceBranch === targetBranch;
    if (!repo.workerManager || !sourceBranch || !targetBranch || sameNameInvalid) {
      prPreview = null;
      return;
    }
    let cancelled = false;
    previewLoading = true;
    prPreview = null;
    const targetUrls = cloneUrls;
    const sourceUrls = fromFork ? parseForkCloneUrls() : [];
    const cloneUrlsForPreview = fromFork ? targetUrls : targetUrls;
    if (fromFork && sourceUrls.length === 0) {
      prPreview = {
        success: false,
        error: "Enter fork clone URL to preview",
        commits: [],
        commitOids: [],
        filesChanged: [],
      };
      previewLoading = false;
      return;
    }
    repo.workerManager
      .getPRPreview({
        repoId: repo.key,
        sourceBranch,
        targetBranch,
        cloneUrls: cloneUrlsForPreview,
        sourceCloneUrls: fromFork ? sourceUrls : undefined,
      })
      .then((result) => {
        if (cancelled) return;
        prPreview = result;
        previewLoading = false;
      })
      .catch((err) => {
        if (cancelled) return;
        prPreview = {
          success: false,
          error: err?.message || "Failed to load PR preview",
          commits: [],
          commitOids: [],
          filesChanged: [],
        };
        previewLoading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  function handleLabelToggle(label: string) {
    if (labels.includes(label)) {
      labels = labels.filter((l) => l !== label);
    } else {
      labels = [...labels, label];
    }
  }

  function handleAddCustomLabel() {
    const trimmed = newLabel.trim();
    if (trimmed && !customLabels.includes(trimmed) && !commonLabels.includes(trimmed)) {
      customLabels = [...customLabels, trimmed];
      labels = [...labels, trimmed];
      newLabel = "";
    }
  }

  function handleRemoveCustomLabel(label: string) {
    customLabels = customLabels.filter((l) => l !== label);
    labels = labels.filter((l) => l !== label);
  }

  async function onFormSubmit(e: Event) {
    e.preventDefault();
    errors = {};
    isSubmitting = true;
    const urls = fromFork ? parseForkCloneUrls() : cloneUrls;
    const result = prSchema.safeParse({
      subject,
      content,
      sourceBranch,
      targetBranch,
      cloneUrls: urls.length ? urls : cloneUrls,
      labels,
    });
    if (!result.success) {
      for (const err of result.error.errors) {
        const path = err.path[0];
        if (path) errors[path as string] = err.message;
      }
      isSubmitting = false;
      return;
    }
    if (!prPreview?.success || !prPreview.commitOids?.length) {
      errors.general =
        "Please wait for commits to load, or ensure the source branch has commits not in the target.";
      isSubmitting = false;
      return;
    }
    const tipCommitOid = prPreview.tipCommit || prPreview.commitOids[0];
    if (!tipCommitOid) {
      errors.general = "Unable to determine PR tip commit";
      isSubmitting = false;
      return;
    }
    try {
      const prEvent = createPullRequestEvent({
        content: result.data.content,
        repoAddr: repo.address,
        subject: result.data.subject,
        labels: result.data.labels,
        tipCommitOid,
        clone: result.data.cloneUrls,
        branchName: result.data.targetBranch,
        mergeBase: prPreview.mergeBase,
        recipients: [repo.repoEvent?.pubkey ?? ""],
      });
      await onPRCreated(prEvent);
      back();
    } catch (error) {
      console.error(error);
      errors.general = error instanceof Error ? error.message : String(error);
    } finally {
      isSubmitting = false;
    }
  }
</script>

<form class="space-y-6" onsubmit={onFormSubmit}>
  <div class="flex items-center gap-2">
    <CircleAlert class="h-6 w-6" />
    New Pull Request
  </div>

  <!-- Same repo vs From fork -->
  <label class="flex items-center gap-2 cursor-pointer">
    <Checkbox bind:checked={fromFork} />
    <GitFork class="h-4 w-4" />
    <span>Create PR from my fork</span>
  </label>

  {#if fromFork}
    <div>
      <Label for="pr-clone-urls">Clone URL(s), one per line</Label>
      <Textarea
        id="pr-clone-urls"
        bind:value={cloneUrlsText}
        class="mt-1 font-mono text-sm"
        rows={2}
        placeholder="https://github.com/you/your-fork.git"
      />
      <p class="mt-1 text-xs text-muted-foreground">
        Your fork's clone URL. Source branches will be loaded from here.
      </p>
      <div class="mt-2 flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          onclick={handleRetryForkFetch}
          disabled={!cloneUrlsText.trim() || sourceBranchesLoading || previewLoading}
        >
          Retry fork fetch
        </Button>
        {#if sourceBranchesLoading}
          <span class="flex items-center gap-1 text-xs text-muted-foreground">
            <Loader2 class="h-3 w-3 animate-spin" />
            Refreshing fork branches...
          </span>
        {/if}
      </div>
      {#if sourceBranchesError}
        <div class="mt-1 text-sm text-destructive">{sourceBranchesError}</div>
      {/if}
      {#if errors.cloneUrls}
        <div class="mt-1 text-sm text-red-500">{errors.cloneUrls}</div>
      {/if}
    </div>
  {/if}

  <!-- Branch selection: source -> target (GitHub style) -->
  <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
    <div>
      <Label for="pr-source-branch">Source branch</Label>
      <select
        id="pr-source-branch"
        bind:value={sourceBranch}
        disabled={sourceBranchesLoading}
        class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      >
        <option value="">Select a branch</option>
        {#each sourceBranches as b (b.name)}
          <option value={b.name}>{b.name}</option>
        {/each}
      </select>
      {#if errors.sourceBranch}
        <div class="mt-1 text-sm text-red-500">{errors.sourceBranch}</div>
      {/if}
    </div>
    <div>
      <Label for="pr-target-branch">Target branch</Label>
      <select
        id="pr-target-branch"
        bind:value={targetBranch}
        disabled={false}
        class="mt-1 flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
      >
        <option value="">Select a branch</option>
        {#each targetBranches as b (b.name)}
          <option value={b.name}>{b.name}</option>
        {/each}
      </select>
      {#if errors.targetBranch}
        <div class="mt-1 text-sm text-red-500">{errors.targetBranch}</div>
      {/if}
    </div>
  </div>

  {#if sourceBranch && targetBranch && (fromFork || sourceBranch !== targetBranch)}
    <!-- PR preview: commits and changes -->
    <div class="rounded-lg border border-border bg-muted/30 p-3">
      <div class="flex items-center gap-2 text-sm font-medium mb-2">
        <GitBranch class="h-4 w-4" />
        <span>{sourceBranch}</span>
        <ChevronRight class="h-4 w-4 text-muted-foreground" />
        <span>{targetBranch}</span>
      </div>
      {#if previewLoading}
        <div class="flex items-center gap-2 py-4 text-muted-foreground">
          <Loader2 class="h-4 w-4 animate-spin" />
          <span>Loading commits and changes…</span>
        </div>
      {:else if prPreview?.error}
        <div class="space-y-2 py-2">
          <div class="text-sm text-destructive">{prPreview.error}</div>
          {#if fromFork}
            <Button
              type="button"
              variant="outline"
              onclick={handleRetryForkFetch}
              disabled={sourceBranchesLoading || previewLoading}
            >
              Retry fork fetch
            </Button>
          {/if}
        </div>
      {:else if prPreview?.success}
        <div class="space-y-3 text-sm">
          {#if prPreview.commits?.length}
            <div>
              <span class="font-medium">{prPreview.commits.length} commit(s)</span>
              <ul class="mt-1 max-h-32 overflow-y-auto space-y-1 font-mono text-xs">
                {#each prPreview.commits as c (c.oid)}
                  <li class="flex gap-2 truncate">
                    <span class="text-muted-foreground shrink-0">{c.oid.slice(0, 7)}</span>
                    <span class="truncate">{c.message?.split("\n")[0] ?? "(no message)"}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}
          {#if prPreview.filesChanged?.length}
            <div>
              <span class="font-medium">{prPreview.filesChanged.length} file(s) changed</span>
              <ul class="mt-1 max-h-24 overflow-y-auto font-mono text-xs space-y-0.5">
                {#each prPreview.filesChanged as f (f)}
                  <li class="truncate">{f}</li>
                {/each}
              </ul>
            </div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}

  <div>
    <Label for="pr-subject">Subject</Label>
    <Input
      id="pr-subject"
      bind:value={subject}
      class="mt-1"
      placeholder="Brief description of the PR"
    />
    {#if errors.subject}
      <div class="mt-1 text-sm text-red-500">{errors.subject}</div>
    {/if}
  </div>

  <div>
    <Label for="pr-content">Description</Label>
    <Textarea
      id="pr-content"
      bind:value={content}
      class="mt-1"
      rows={6}
      placeholder="Describe the changes. Markdown supported."
    />
    <p class="mt-1 text-xs text-muted-foreground">Supports Markdown</p>
  </div>

  <div class="space-y-3">
    <Label>Labels</Label>
    <div class="grid grid-cols-2 gap-2">
      {#each commonLabels as label}
        <label class="flex items-center space-x-2">
          <Checkbox
            checked={labels.includes(label)}
            onCheckedChange={() => handleLabelToggle(label)}
          />
          <span>{label}</span>
        </label>
      {/each}
      {#each customLabels as label}
        <label class="flex items-center space-x-2 rounded">
          <Checkbox
            checked={labels.includes(label)}
            onCheckedChange={() => handleLabelToggle(label)}
          />
          <span>{label}</span>
          <button type="button" class="text-red-500" onclick={() => handleRemoveCustomLabel(label)}>
            <X size={14} />
          </button>
        </label>
      {/each}
      <div class="flex gap-2">
        <Input
          placeholder="Add label"
          bind:value={newLabel}
          class="flex-1"
          onkeydown={(e) => e.key === "Enter" && (e.preventDefault(), handleAddCustomLabel())}
        />
        <Button type="button" variant="outline" onclick={handleAddCustomLabel}
          ><Plus size={14} /></Button
        >
      </div>
    </div>
  </div>

  {#if errors.general}
    <div class="text-sm text-red-500">{errors.general}</div>
  {/if}

  <div class="flex justify-end gap-3">
    <Button type="button" variant="outline" onclick={back} disabled={isSubmitting}>Cancel</Button>
    <Button type="submit" variant="git" disabled={isSubmitting}>
      {isSubmitting ? "Creating…" : "Create PR"}
    </Button>
  </div>
</form>
