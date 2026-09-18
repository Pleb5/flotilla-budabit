<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import {
    inspectPublicRepoSource,
    parsePublicRepoUrl,
    type PublicRepoSource,
    type PublicRepoProvider,
  } from "@nostr-git/core/git";
  import type { ExistingSourceAnnouncement } from "../../utils/repo-import-checks.js";
  import type { RepoRelayCheckReport } from "../../utils/repo-creation-preflight.js";
  import RepoRelayCheckStatus from "./RepoRelayCheckStatus.svelte";
  interface Props {
    mode: "new" | "import" | null;
    sourceUrl: string;
    source: PublicRepoSource | null;
    onModeChange: (mode: "new" | "import") => void;
    onUrlChange: (value: string) => void;
    onSource: (source: PublicRepoSource, signal: AbortSignal) => Promise<void>;
    duplicates: ExistingSourceAnnouncement[];
    relayChecks: RepoRelayCheckReport | null;
    importAnyway: boolean;
    onImportAnyway: (value: boolean) => void;
  }
  const {
    mode,
    sourceUrl,
    source,
    onModeChange,
    onUrlChange,
    onSource,
    duplicates,
    relayChecks,
    importAnyway,
    onImportAnyway,
  }: Props = $props();
  let inspecting = $state(false);
  let waiting = $state(false);
  let error = $state("");
  let provider = $state<PublicRepoProvider | "">("");
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const unknownProvider = $derived.by(() => {
    try {
      return !parsePublicRepoUrl(sourceUrl).provider;
    } catch {
      return false;
    }
  });
  function cancel() {
    clearTimeout(timer);
    waiting = false;
    controller?.abort();
    controller = undefined;
    inspecting = false;
    error = "";
  }
  onDestroy(cancel);
  $effect(() => {
    const url = sourceUrl;
    const hint = provider;
    const importing = mode === "import";
    cancel();
    if (importing && url.trim() && !untrack(() => source)) {
      waiting = true;
      timer = setTimeout(() => void inspect(url, hint), 1200);
    }
    return cancel;
  });
  async function inspect(url = sourceUrl, hint = provider) {
    cancel();
    onUrlChange(url);
    const current = new AbortController();
    controller = current;
    inspecting = true;
    try {
      const result = await inspectPublicRepoSource(url, current.signal, {
        provider: hint || undefined,
      });
      if (controller === current && !current.signal.aborted) await onSource(result, current.signal);
    } catch (cause) {
      if (controller === current && !current.signal.aborted)
        error = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (controller === current) inspecting = false;
    }
  }
</script>

<div class="space-y-4">
  <h2 class="text-xl font-semibold">What type of repo do you want to create?</h2>
  <div class="rounded-lg border border-border p-4 {mode === 'new' ? 'ring-2 ring-accent' : ''}">
    <label class="flex min-h-10 cursor-pointer items-center gap-3 font-medium">
      <input
        type="radio"
        name="repo-type"
        checked={mode === "new"}
        onchange={() => {
          cancel();
          onModeChange("new");
        }}
      /> Brand new Repo
    </label>
    <p class="mt-1 text-sm text-muted-foreground">
      Start a new repository on your selected services.
    </p>
  </div>
  <div
    class="space-y-3 rounded-lg border border-border p-4 {mode === 'import'
      ? 'ring-2 ring-accent'
      : ''}"
  >
    <label class="flex min-h-10 cursor-pointer items-center gap-3 font-medium">
      <input
        type="radio"
        name="repo-type"
        checked={mode === "import"}
        onchange={() => onModeChange("import")}
      /> Import an existing Repo
    </label>
    <p class="text-sm text-muted-foreground">
      Announce a public repository on Nostr, with optional independent Git copies.
    </p>
    {#if mode === "import"}
      <label for="public-repo-url" class="block text-sm font-medium">Repository URL</label>
      <input
        id="public-repo-url"
        type="text"
        value={sourceUrl}
        oninput={(event) => {
          cancel();
          provider = "";
          onUrlChange(event.currentTarget.value);
        }}
        onkeydown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void inspect();
          }
        }}
        placeholder="https://github.com/owner/repository"
        class="w-full rounded border border-input bg-background px-3 py-2"
      />
      <p class="text-xs text-muted-foreground">
        GitHub, GitLab, Gitea, and Codeberg / Forgejo. The .git suffix is optional. Public sources
        are read anonymously; no source token is used.
      </p>
      {#if unknownProvider && (error || provider)}
        <div class="space-y-2 rounded border border-border p-3">
          <label for="source-provider" class="block text-sm font-medium"
            >Repository server software</label
          >
          <p class="text-sm">
            If this custom server could not be detected, choose the software it runs so we can use
            its public API.
          </p>
          <select
            id="source-provider"
            class="mt-2 rounded border border-input bg-background px-3 py-2"
            bind:value={provider}
            onchange={() => {
              cancel();
              onUrlChange(sourceUrl);
            }}
          >
            <option value="">Detect automatically</option><option value="github"
              >GitHub Enterprise</option
            ><option value="gitlab">GitLab</option><option value="gitea">Gitea</option><option
              value="forgejo">Forgejo</option
            >
          </select>
        </div>
      {/if}
      {#if waiting || inspecting}
        <p role="status" class="text-sm font-medium">
          {waiting
            ? "Waiting to check repository…"
            : "Checking public repository and your announcements…"}
        </p>
      {/if}
      {#if error || source}
        <button
          type="button"
          class="rounded border border-input px-4 py-2 disabled:opacity-50"
          disabled={!sourceUrl.trim() || inspecting}
          onclick={() => inspect()}>Check again</button
        >
      {/if}
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      {#if source}<div
          role="status"
          class="flex items-start gap-3 rounded-lg border border-green-600 bg-green-500/10 p-4 text-green-800 dark:text-green-300"
        >
          <svg
            aria-hidden="true"
            class="mt-0.5 h-6 w-6 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            ><circle cx="12" cy="12" r="10"></circle><path d="m7 12 3 3 7-7"></path></svg
          >
          <div class="space-y-1">
            <p class="font-semibold">Repository available</p>
            <p class="text-sm font-medium">
              Public repository found: <strong>{source.owner}/{source.name}</strong>. {source.empty
                ? "Empty repository — announcement-only is available."
                : `Default branch: ${source.defaultBranch}`}
            </p>
          </div>
        </div>
        {#if relayChecks}
          <RepoRelayCheckStatus report={relayChecks} />
          {#if !duplicates.length}<p class="text-sm font-medium">
              No matching clone URL found in your cached announcements or the relay results
              received.
            </p>{/if}
        {/if}
        {#if duplicates.length || relayChecks?.failedRelays.length}
          <div class="space-y-3 rounded-lg border border-amber-600 bg-amber-500/10 p-4">
            {#if duplicates.length}
              <p role="alert" class="font-semibold">You already announced this repository.</p>
              <ul class="space-y-1 text-sm">
                {#each duplicates as duplicate}<li>
                    {duplicate.name} <span class="font-mono">({duplicate.identifier})</span>
                  </li>{/each}
              </ul>
              <p class="text-sm">
                This clone URL is already in your Nostr repositories. Importing again requires a
                different repository identifier.
              </p>
            {:else}<p class="text-sm">
                Continue with incomplete announcement checks. A confirmed identifier clash still
                requires a different identifier.
              </p>{/if}
            <label class="flex cursor-pointer items-center gap-3 font-semibold"
              ><input
                type="checkbox"
                class="h-4 w-4 rounded-sm"
                checked={importAnyway}
                onchange={(event) => onImportAnyway(event.currentTarget.checked)}
              /> Import anyway</label
            >
          </div>
        {/if}
      {/if}
    {/if}
  </div>
</div>
