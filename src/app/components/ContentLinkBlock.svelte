<script lang="ts">
  import {call, ellipsize, displayUrl, postJson} from "@welshman/lib"
  import {isRelayUrl} from "@welshman/util"
  import {preventDefault, stopPropagation} from "@lib/html"
  import Link from "@lib/components/Link.svelte"
  import ContentLinkDetail from "@app/components/ContentLinkDetail.svelte"
  import ContentLinkBlockImage from "@app/components/ContentLinkBlockImage.svelte"
  import {pushModal} from "@app/util/modal"
  import {APP_URL, dufflepud} from "@app/core/state"

  const {value, event} = $props()

  let hideImage = $state(false)

  const url = value.url.toString()
  const [href, external] = call(() => {
    if (isRelayUrl(url)) {
      return [url, true]
    }
    if ($APP_URL && url.startsWith($APP_URL)) return [url.replace($APP_URL, ""), false]

    return [url, true]
  })

  const localPreview = call(() => {
    if (external) return null

    try {
      const parsed = url.startsWith("http")
        ? new URL(url)
        : new URL(href, $APP_URL || window.location.origin)
      const path = `${parsed.pathname}${parsed.search}${parsed.hash}` || href || "/"

      if (path.includes("/git/")) {
        return {title: "Budabit Git link", description: path}
      }

      if (path.includes("/chat")) {
        return {title: "Budabit chat link", description: path}
      }

      if (path.includes("/threads/")) {
        return {title: "Budabit thread link", description: path}
      }

      if (!path || path === "/") {
        return {title: "BudaBit", description: displayUrl(url)}
      }

      return {title: "Budabit link", description: path}
    } catch {
      return {title: "Budabit link", description: href || displayUrl(url)}
    }
  })

  const loadPreview = async () => {
    const json = await postJson(dufflepud("link/preview"), {url})

    if (!json?.title && !json?.image) {
      throw new Error("Failed to load link preview")
    }

    return json
  }

  const onError = () => {
    hideImage = true
  }

  const expand = () => pushModal(ContentLinkDetail, {value, event}, {fullscreen: true})
</script>

<Link {external} {href} class="my-2 block max-w-lg no-underline hover:no-underline">
  <div
    class="overflow-hidden rounded-2xl border border-base-content/10 bg-base-100 leading-normal shadow-sm transition hover:border-primary/30 hover:shadow-md">
    {#if url.match(/\.(mov|webm|mp4)$/)}
      <video controls src={url} class="max-h-80 w-full bg-base-200 object-contain object-center">
        <track kind="captions" />
      </video>
    {:else if url.match(/\.(jpe?g|png|gif|webp)$/)}
      <button
        type="button"
        class="block w-full bg-base-200"
        onclick={stopPropagation(preventDefault(expand))}>
        <ContentLinkBlockImage {value} {event} class="m-auto max-h-80" />
      </button>
    {:else if localPreview}
      <div class="flex min-w-0 flex-col gap-1.5 p-3">
        <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {displayUrl(url)}
        </div>
        <strong class="line-clamp-2 text-sm leading-snug">{localPreview.title}</strong>
        {#if localPreview.description}
          <p class="line-clamp-2 break-words text-xs leading-snug text-muted-foreground">
            {localPreview.description}
          </p>
        {/if}
      </div>
    {:else}
      {#await loadPreview()}
        <div class="flex min-h-24 items-center gap-3 p-3 text-sm text-muted-foreground">
          <span class="loading loading-spinner loading-sm"></span>
          Loading preview...
        </div>
      {:then preview}
        <div class="flex min-w-0 leading-normal">
          {#if preview.image && !hideImage}
            <div class="h-24 w-28 shrink-0 bg-base-200 sm:h-28 sm:w-36">
              <img
                alt=""
                onerror={onError}
                src={preview.image}
                class="h-full w-full object-cover object-center" />
            </div>
          {/if}
          <div class="flex min-w-0 flex-1 flex-col gap-1.5 p-3">
            <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              {displayUrl(url)}
            </div>
            <strong class="line-clamp-2 text-sm leading-snug"
              >{preview.title || displayUrl(url)}</strong>
            {#if preview.description}
              <p class="line-clamp-2 text-xs leading-snug text-muted-foreground">
                {ellipsize(preview.description, 150)}
              </p>
            {/if}
          </div>
        </div>
      {:catch}
        <div class="flex min-w-0 flex-col gap-1.5 p-3">
          <div class="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {displayUrl(url)}
          </div>
          <strong class="line-clamp-2 text-sm leading-snug">Open link</strong>
          <p class="line-clamp-2 break-all text-xs leading-snug text-muted-foreground">{url}</p>
        </div>
      {/await}
    {/if}
  </div>
</Link>
