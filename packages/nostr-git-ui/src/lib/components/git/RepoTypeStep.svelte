<script lang="ts">
  import { onDestroy, untrack } from "svelte";
  import {
    inspectPublicRepoSource,
    parsePublicRepoUrl,
    type PublicRepoSource,
    type PublicRepoProvider,
  } from "@nostr-git/core/git";
  import { publicRepoCopyAdmissionError } from "../../utils/public-repo-copy.js";
  interface Props {
    mode: "new" | "import" | null;
    sourceUrl: string;
    source: PublicRepoSource | null;
    onModeChange: (mode: "new" | "import") => void;
    onUrlChange: (value: string) => void;
    onSource: (source: PublicRepoSource, signal: AbortSignal) => void | Promise<void>;
  }
  const { mode, sourceUrl, source, onModeChange, onUrlChange, onSource }: Props = $props();
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
      const admissionError = publicRepoCopyAdmissionError(result);
      if (admissionError) throw new Error(admissionError);
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
      Create independent copies of a public repository at destinations you control, and announce
      them on Nostr.
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
          {waiting ? "Waiting to check repository…" : "Checking public repository…"}
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
            <p class="font-semibold">Public repository available</p>
            <p class="text-sm font-medium">
              Public repository found: <strong>{source.owner}/{source.name}</strong>. Default
              branch: {source.defaultBranch}
            </p>
          </div>
        </div>
      {/if}
    {/if}
  </div>
</div>
