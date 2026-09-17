<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    inspectPublicRepoSource,
    type PublicRepoSource,
    type PublicRepoProvider,
  } from "@nostr-git/core/git";
  interface Props {
    mode: "new" | "import" | null;
    sourceUrl: string;
    source: PublicRepoSource | null;
    onModeChange: (mode: "new" | "import") => void;
    onUrlChange: (value: string) => void;
    onSource: (source: PublicRepoSource) => void;
  }
  const { mode, sourceUrl, source, onModeChange, onUrlChange, onSource }: Props = $props();
  let inspecting = $state(false);
  let error = $state("");
  let provider = $state<PublicRepoProvider | "">("");
  let controller: AbortController | undefined;
  function cancel() {
    controller?.abort();
    controller = undefined;
    inspecting = false;
    error = "";
  }
  onDestroy(cancel);
  async function inspect() {
    cancel();
    const current = new AbortController();
    controller = current;
    inspecting = true;
    try {
      const result = await inspectPublicRepoSource(sourceUrl, current.signal, {
        provider: provider || undefined,
      });
      if (controller === current && !current.signal.aborted) onSource(result);
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
      <details>
        <summary class="cursor-pointer text-sm text-muted-foreground">Self-hosted provider</summary>
        <select
          aria-label="Self-hosted source provider"
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
      </details>
      <button
        type="button"
        class="rounded border border-input px-4 py-2 disabled:opacity-50"
        disabled={!sourceUrl.trim() || inspecting}
        onclick={inspect}
        >{inspecting ? "Checking public repository…" : "Inspect repository"}</button
      >
      {#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
      {#if source}<p role="status" class="text-sm text-muted-foreground">
          Public repository found: <strong>{source.owner}/{source.name}</strong>. {source.empty
            ? "Empty repository — announcement-only is available."
            : `Default branch: ${source.defaultBranch}`}
        </p>{/if}
    {/if}
  </div>
</div>
