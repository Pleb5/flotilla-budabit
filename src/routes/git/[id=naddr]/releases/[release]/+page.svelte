<script lang="ts">
  import {getContext} from "svelte"
  import {page} from "$app/stores"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import {request} from "@welshman/net"
  import {REPO_KEY, REPO_RELAYS_KEY, getRepoMaintainers} from "@app/core/git-state"
  import {
    loadSoftwareReleaseLink,
    assetDownloadUrl,
    type SoftwareReleaseLink,
  } from "@app/core/software-release-link"
  import Markdown from "@lib/components/Markdown.svelte"
  import {verifiedEvent} from "../../../../../../packages/budabit-releases-extension/packages/iframe-app/src/lib/trust"

  const repo = getContext<Repo>(REPO_KEY)
  const relays = getContext<Readable<string[]>>(REPO_RELAYS_KEY)
  let release = $state<SoftwareReleaseLink | null>(null)
  let loading = $state(true)
  let error = $state("")
  let revision = $state(0)
  $effect(() => {
    void revision
    const announcement = repo.repoEvent
    const pointer = $page.params.release
    const sources = [...$relays]
    release = null
    error = ""
    loading = true
    if (!announcement || !pointer) {
      loading = false
      return
    }
    const controller = new AbortController()
    loadSoftwareReleaseLink(announcement, pointer, sources, controller.signal)
      .then(value => {
        if (!controller.signal.aborted) release = value
      })
      .catch(cause => {
        if (!controller.signal.aborted)
          error = cause instanceof Error ? cause.message : String(cause)
      })
      .finally(() => {
        if (!controller.signal.aborted) loading = false
      })
    return () => controller.abort()
  })
  $effect(() => {
    const announcement = repo.repoEvent
    const pointer = $page.params.release
    const sources = [...$relays]
    if (!announcement || !pointer || !sources.length) return
    const controller = new AbortController()
    const seen = new Set<string>()
    let timer: ReturnType<typeof setTimeout> | undefined
    void request({
      relays: sources,
      signal: controller.signal,
      owner: "software-release-link",
      filters: [
        {
          kinds: [32267, 30063, 3063, 5],
          authors: getRepoMaintainers(announcement),
          since: Math.floor(Date.now() / 1000) - 1,
        },
      ],
      onEvent(event) {
        if (!verifiedEvent(event) || seen.has(event.id)) return
        seen.add(event.id)
        clearTimeout(timer)
        timer = setTimeout(() => revision++, 100)
      },
    }).catch(() => {
      /* Explicit refresh remains available when live reads fail. */
    })
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  })
</script>

<section class="min-w-0 space-y-4 break-words p-4" aria-labelledby="software-release-title">
  <div class="flex flex-wrap items-center justify-between gap-3">
    <h1 id="software-release-title" class="text-xl font-semibold">Software release</h1>
    <button class="btn btn-sm" onclick={() => revision++} disabled={loading}
      >Refresh release</button>
  </div>
  <a class="link" href={`/git/${$page.params.id}`}>Back to repository</a>
  {#if loading}
    <p role="status">Loading software release…</p>
  {:else if error}
    <p role="alert">{error}</p>
  {:else if !release}
    <p role="status">
      This release is unavailable under the current repository and application authority.
    </p>
  {:else}
    <h2 class="text-lg font-semibold">{release.application.name} {release.version}</h2>
    <p>
      Application: {release.application.appId} · {release.event.tags.find(t => t[0] === "c")?.[1] ||
        "main"}
    </p>
    <Markdown
      content={release.event.content}
      event={release.event}
      relays={$relays}
      variant="comment" />
    {#if release.partial}<p role="status">Some relays did not complete. Refresh to retry.</p>{/if}
    {#if release.missingAssets}<p role="status">
        {release.missingAssets} linked assets are unavailable or invalid.
      </p>{/if}
    <ul class="space-y-3" aria-label="Release assets">
      {#each release.assets as asset (asset.eventId)}
        <li class="space-y-2 rounded border p-3">
          <a
            class="link font-semibold"
            href={assetDownloadUrl(asset)}
            target="_blank"
            rel="noreferrer">{asset.filename}</a>
          <p>{asset.mimeType} · {asset.platforms.join(" · ")}</p>
          <p class="break-all text-sm">SHA-256: {asset.sha256}</p>
        </li>
      {/each}
    </ul>
  {/if}
</section>
