<script lang="ts">
  import { onMount, onDestroy, tick } from "svelte";
  import { graspServersStore } from "../../stores/graspServers.js";
  import {
    prepareInitialImport,
    runInitialImport,
    withInitialImportLock,
    initialImportUrls,
    type InitialImportRuntime,
  } from "../../utils/initial-import.js";
  import type { InitialImportJob } from "../../utils/initial-import-store.js";
  import type { SubscribeGitProgress } from "../../utils/git-operation-progress.js";

  interface Props {
    owner: string;
    runtime: InitialImportRuntime;
    subscribeGitProgress?: SubscribeGitProgress;
    onClose: () => void;
    onDispose?: () => void;
    onOpenRepo?: (job: InitialImportJob) => void | Promise<void>;
  }
  const { owner, runtime, subscribeGitProgress, onClose, onDispose, onOpenRepo }: Props = $props();
  let sourceUrl = $state("");
  let name = $state("");
  let relay = $state("");
  let issues = $state(false);
  let comments = $state(false);
  let token = $state("");
  let approved = $state(false);
  let busy = $state(false);
  let error = $state("");
  let step = $state("");
  let prepared = $state.raw<InitialImportJob | undefined>();
  let job = $state.raw<InitialImportJob | undefined>();
  let saved = $state.raw<InitialImportJob[]>([]);
  let controller: AbortController | undefined;
  let disposed = false;
  let contentElement: HTMLDivElement;
  const activeJob = $derived(job || prepared);
  const urls = $derived(activeJob ? initialImportUrls(activeJob) : undefined);
  const completed = $derived(job?.status === "complete" || job?.status === "partial");
  const viewKey = $derived(prepared ? "review" : job?.id || "source");
  $effect(() => {
    void viewKey;
    void tick().then(() => contentElement?.scrollTo({ top: 0 }));
  });

  const reportError = (failure: unknown) => {
    const message = failure instanceof Error ? failure.message : "Import could not finish";
    error = token ? message.split(token).join("[redacted]") : message;
  };
  async function refreshSaved() {
    saved = await runtime.store.list(owner);
  }
  onMount(() => {
    // GRASP configuration is a convenience, not a mandatory relay fallback.
    relay = $graspServersStore[0] || "";
    void refreshSaved().catch(reportError);
    const unsubscribe = subscribeGitProgress?.((event) => {
      if (busy && job?.workerOperation?.id === event.operationId) step = event.phase;
    });
    return () => unsubscribe?.();
  });
  onDestroy(() => {
    disposed = true;
    controller?.abort();
    token = "";
    onDispose?.();
  });

  async function review() {
    if (busy) return;
    controller = new AbortController();
    busy = true;
    error = "";
    approved = false;
    try {
      prepared = await withInitialImportLock("review", () =>
        prepareInitialImport(
          { sourceUrl, name: name.trim(), relay: relay.trim(), owner, issues, comments },
          runtime,
          controller!.signal
        )
      );
      if (disposed) prepared = undefined;
    } catch (failure) {
      reportError(failure);
    } finally {
      busy = false;
    }
  }
  async function execute(resume?: InitialImportJob) {
    if (busy || (!resume && (!prepared || !approved))) return;
    controller = new AbortController();
    busy = true;
    error = "";
    try {
      await withInitialImportLock(resume?.id || prepared!.id, async () => {
        runtime.assertActor(owner);
        if (resume) job = await runtime.store.get(resume.id);
        else {
          await runtime.store.create(prepared!);
          job = prepared;
          prepared = undefined;
        }
        if (!job)
          throw new Error(
            "Import recovery is missing. Do not import into an existing destination."
          );
        const result = await runInitialImport(
          job.id,
          {
            ...runtime,
            onProgress: (current, message) => {
              job = current;
              step = message;
              runtime.onProgress?.(current, message);
            },
          },
          controller!.signal,
          token
        );
        job = result;
        await refreshSaved();
      });
    } catch (failure) {
      reportError(failure);
    } finally {
      busy = false;
    }
  }
  async function keepPartial() {
    if (!job || busy || job.gitStage !== "verified") return;
    try {
      await withInitialImportLock(job.id, async () => {
        runtime.assertActor(owner);
        const current = await runtime.store.get(job!.id);
        if (!current) throw new Error("Import recovery is missing");
        const partial: InitialImportJob = {
          ...current,
          status: "partial",
          message:
            "Repository kept; remaining initial history will not be imported. An unconfirmed event may already be public.",
        };
        await runtime.store.save(partial);
        job = partial;
        await refreshSaved();
      });
    } catch (failure) {
      reportError(failure);
    }
  }
  function stop() {
    controller?.abort();
    step = "Stopping further work; retaining published data and recovery…";
  }
</script>

<section
  class="ng-themed-modal bg-card text-card-foreground mx-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-lg border border-border shadow"
  aria-label="Import a new repository"
>
  <header class="shrink-0 border-b border-border p-4 sm:p-6">
    <h1 class="text-2xl font-bold">Create from GitHub</h1>
    <p class="mt-1 text-sm text-muted-foreground">
      A new Nostr repository, plus optional initial issue history. Not ongoing synchronization.
    </p>
  </header>
  <div
    bind:this={contentElement}
    class="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 [overflow-wrap:anywhere] sm:p-6"
  >
    {#if error}<p class="rounded border border-destructive p-3 text-destructive" role="alert">
        {error}
      </p>{/if}
    {#if !activeJob}
      <form
        class="space-y-4"
        onsubmit={(event) => {
          event.preventDefault();
          void review();
        }}
      >
        <label class="block space-y-1" for="initial-source"
          ><span>Public GitHub repository</span>
          <input
            id="initial-source"
            class="input w-full bg-background"
            type="url"
            placeholder="https://github.com/owner/project"
            bind:value={sourceUrl}
            disabled={busy}
            required
          /></label
        >
        <label class="block space-y-1" for="initial-name"
          ><span>New repository name</span>
          <input
            id="initial-name"
            class="input w-full bg-background"
            bind:value={name}
            maxlength="64"
            placeholder="my-project"
            disabled={busy}
            required
          /></label
        >
        <label class="block space-y-1" for="initial-relay"
          ><span>GRASP service (one destination)</span>
          <input
            id="initial-relay"
            class="input w-full bg-background"
            type="url"
            list="initial-grasp-options"
            placeholder="wss://your-grasp-server"
            bind:value={relay}
            disabled={busy}
            required
          /></label
        >
        <datalist id="initial-grasp-options"
          >{#each $graspServersStore as server}<option value={server}></option>{/each}</datalist
        >
        <fieldset class="space-y-2" disabled={busy}>
          <legend class="mb-2 font-semibold">Initial collaboration data</legend>
          <label class="flex items-center gap-2"
            ><input type="checkbox" bind:checked={issues} /> Issues and current status</label
          >
          <label class="flex items-center gap-2"
            ><input type="checkbox" bind:checked={comments} disabled={!issues} /> Issue conversation comments</label
          >
        </fieldset>
        <p class="text-sm text-muted-foreground">
          Public GitHub only. All advertised branches/tags (up to 100), with reachable Git history.
          GitHub-reported size must be at most 50 MiB; Git transfers stop at 64 MiB. These are
          transfer limits, not a guaranteed browser-memory ceiling.
        </p>
        <p class="text-sm text-muted-foreground">
          Not included: pull requests, private repositories, LFS objects, release assets, wikis, or
          submodule repositories. The source is never modified.
        </p>
        <button class="btn btn-primary" type="submit" disabled={busy}
          >{busy ? "Checking source and destination…" : "Review import"}</button
        >
      </form>
      {#if saved.length}
        <section aria-label="Saved imports" class="space-y-2 border-t border-border pt-4">
          <h2 class="font-semibold">Saved imports on this browser</h2>
          {#each saved as item (item.id)}
            <button
              class="block w-full rounded border border-border p-3 text-left hover:bg-muted"
              disabled={busy}
              onclick={() => {
                job = item;
                error = "";
                step = "";
              }}
            >
              <span class="font-semibold">{item.name}</span> · {item.status} · {item.counts.events} confirmed
              history events
            </button>
          {/each}
        </section>
      {/if}
    {:else if prepared}
      <h2 class="text-lg font-semibold">Review before publishing</h2>
      <dl class="space-y-2 text-sm">
        <div>
          <dt class="font-semibold">Source (read-only)</dt>
          <dd>{prepared.source.url}</dd>
        </div>
        <div>
          <dt class="font-semibold">New destination</dt>
          <dd>{urls?.cloneUrls[0]}</dd>
        </div>
        <div>
          <dt class="font-semibold">Git refs</dt>
          <dd>
            {prepared.refs.length} branches/tags; default branch {prepared.source.defaultBranch}
          </dd>
        </div>
        <div>
          <dt class="font-semibold">Initial history</dt>
          <dd>
            {prepared.issues
              ? `Issues and status${prepared.comments ? ", plus conversation comments" : ""}`
              : "None — Git only"}
          </dd>
        </div>
      </dl>
      <details>
        <summary class="cursor-pointer text-sm">Pinned branch/tag tips</summary>
        <ul class="mt-2 text-xs">
          {#each prepared.refs as ref}<li>{ref.ref} · {ref.oid.slice(0, 12)}</li>{/each}
        </ul>
      </details>
      <div class="space-y-2 rounded border border-border bg-muted/30 p-3 text-sm">
        <p>
          The repository announcement is published first so GRASP can admit Git data. An
          announcement can remain public even if cloning or pushing later fails. Accepted Git pushes
          and Nostr events cannot be reliably rolled back.
        </p>
        <p>
          History is signed by your Nostr account with original GitHub author/source attribution,
          not by the original authors. Limits: 1,000 events, 8 MiB cumulative event data, 32 KiB per
          event, 5,000 scanned source items and 200 pages per stream. Hitting a limit preserves a
          partial result rather than truncating data.
        </p>
        <p>
          Resume retries a saved signed event exactly, then reads unfinished source data afresh.
          Source edits or deletions during interruption can affect remaining history. This is not a
          frozen snapshot.
        </p>
      </div>
      <label class="flex items-start gap-2 text-sm"
        ><input class="mt-1" type="checkbox" bind:checked={approved} disabled={busy} /> I approve creating
        this public repository and publishing the selected initial data under my account.</label
      >
    {:else if job}
      <div class="space-y-2" aria-live="polite">
        <h2 class="text-lg font-semibold">
          {job.gitStage === "verified"
            ? "Repository created"
            : "Repository creation not yet confirmed"}
        </h2>
        <p>
          {job.status === "complete"
            ? "Selected initial history complete."
            : job.status === "partial"
              ? "Repository kept with partial initial history."
              : "Initial import is incomplete. Published data is retained."}
        </p>
        <p class="text-sm">
          Confirmed: {job.counts.issue} issues · {job.counts.status} status events · {job.counts
            .comment} comments
        </p>
        {#if step}<p class="text-sm">{step}</p>{/if}
        {#if job.message}<p class="rounded border border-border p-3 text-sm">{job.message}</p>{/if}
      </div>
      <p class="text-sm">{urls?.cloneUrls[0]}</p>
      {#if job.pending}<p class="text-sm">
          One exact signed event is saved for recovery. Its delivery may be unconfirmed, not absent.
        </p>{/if}
      {#if job.workerOperation}<p class="text-sm">
          A Git operation needs its terminal receipt checked. Unknown or divergent outcomes require
          manual inspection; Resume will not force-push or recreate the target.
        </p>{/if}
      <p class="text-sm text-muted-foreground">
        Keep this browser’s site data to retain recovery. Resume only this saved job, under the same
        Nostr account. No remote data is deleted on Stop or Close.
      </p>
    {/if}
    {#if !completed && (issues || activeJob?.issues)}
      <label class="block space-y-1 text-sm" for="initial-token"
        ><span>Optional read-only GitHub token (rate limits; never saved)</span>
        <input
          id="initial-token"
          class="input w-full bg-background"
          type="password"
          autocomplete="off"
          spellcheck="false"
          bind:value={token}
          disabled={busy}
        /></label
      >
    {/if}
  </div>
  <footer class="flex shrink-0 flex-wrap justify-end gap-2 border-t border-border p-4">
    {#if busy}
      <button class="btn" onclick={stop}
        >{job?.publicStarted ? "Stop further work" : "Cancel"}</button
      >
    {:else}
      {#if prepared}<button
          class="btn"
          onclick={() => {
            prepared = undefined;
            approved = false;
          }}>Back</button
        >
        <button class="btn btn-primary" disabled={!approved} onclick={() => execute()}
          >Create public repository</button
        >
      {:else if job}
        <button
          class="btn"
          onclick={() => {
            job = undefined;
            step = "";
            token = "";
          }}>Other imports</button
        >
        {#if !completed}<button class="btn btn-primary" onclick={() => execute(job)}
            >Resume saved import</button
          >{/if}
        {#if job.gitStage === "verified"}
          {#if !completed}<button class="btn" onclick={keepPartial}
              >Keep repository; stop history</button
            >{/if}
          <button class="btn btn-primary" onclick={() => onOpenRepo?.(job!)}>Open repository</button
          >
        {/if}
      {/if}
      <button class="btn" onclick={onClose}>Close</button>
    {/if}
  </footer>
</section>
