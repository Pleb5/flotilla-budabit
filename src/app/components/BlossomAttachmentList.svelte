<script lang="ts">
  import File from "@assets/icons/file.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ContentLinkBlock from "@app/components/ContentLinkBlock.svelte"
  import {
    formatAttachmentSize,
    getAttachmentExtension,
    isPreviewableAttachment,
    type PublishedAttachment,
  } from "@app/util/attachments"

  type Props = {
    attachments?: PublishedAttachment[]
    event?: any
    variant?: "default" | "body" | "comment" | "inline"
  }

  const {attachments = [], event, variant = "default"}: Props = $props()

  const isImageAttachment = ({type = "", url = ""}: PublishedAttachment) =>
    type.startsWith("image/") || /\.(jpe?g|png|gif|webp|svg|bmp|ico)(\?.*)?$/i.test(url)

  const isVideoAttachment = ({type = "", url = ""}: PublishedAttachment) =>
    type.startsWith("video/") || /\.(mov|webm|mp4)(\?.*)?$/i.test(url)

  const getAttachmentName = (attachment: PublishedAttachment) =>
    attachment.name || attachment.url.split("/").at(-1) || "Attachment"

  const getUrlValue = (url: string) => {
    try {
      return {url: new URL(url)}
    } catch {
      return undefined
    }
  }
</script>

{#if attachments.length > 0}
  {#if variant === "inline"}
    <div class="mt-2 flex w-full max-w-full flex-wrap gap-1.5" data-stop-link data-stop-tap>
      {#each attachments as attachment (attachment.url)}
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          class="flex h-16 max-w-[11rem] items-center overflow-hidden rounded-lg border border-base-content/10 bg-base-100 text-left no-underline shadow-sm transition hover:border-primary/30 hover:no-underline">
          <div class="relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden bg-base-200">
            {#if isImageAttachment(attachment)}
              <img alt="" src={attachment.url} class="h-full w-full object-cover" loading="lazy" />
            {:else if isVideoAttachment(attachment)}
              <video muted playsinline preload="metadata" src={attachment.url} class="h-full w-full object-cover">
                <track kind="captions" />
              </video>
            {:else}
              <Icon icon={File} size={8} />
              <span class="absolute text-[9px] font-semibold">
                {getAttachmentExtension(attachment)}
              </span>
            {/if}
          </div>
          <div class="min-w-0 flex-1 px-2 py-1.5">
            <div class="line-clamp-2 break-words text-xs font-semibold leading-tight">
              {getAttachmentName(attachment)}
            </div>
            <div class="mt-0.5 truncate text-[10px] opacity-70">
              {attachment.type || "file"} · {formatAttachmentSize(attachment.size)}
            </div>
          </div>
        </a>
      {/each}
    </div>
  {:else if variant === "comment"}
    <div class="mt-2 grid w-full max-w-full grid-cols-1 gap-2 sm:grid-cols-2" data-stop-link data-stop-tap>
      {#each attachments as attachment (attachment.url)}
        <a
          href={attachment.url}
          target="_blank"
          rel="noopener noreferrer"
          class="flex min-w-0 max-w-full items-center overflow-hidden rounded-xl border border-base-content/10 bg-base-100 text-left no-underline shadow-sm transition hover:border-primary/30 hover:no-underline">
          <div class="relative flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden bg-base-200">
            {#if isImageAttachment(attachment)}
              <img alt="" src={attachment.url} class="h-full w-full object-cover" loading="lazy" />
            {:else if isVideoAttachment(attachment)}
              <video muted playsinline preload="metadata" src={attachment.url} class="h-full w-full object-cover">
                <track kind="captions" />
              </video>
            {:else}
              <Icon icon={File} size={9} />
              <span class="absolute text-[10px] font-semibold">
                {getAttachmentExtension(attachment)}
              </span>
            {/if}
          </div>
          <div class="min-w-0 flex-1 px-3 py-2">
            <div class="line-clamp-2 break-words text-sm font-semibold leading-tight">
              {getAttachmentName(attachment)}
            </div>
            <div class="mt-1 truncate text-xs opacity-70">
              {attachment.type || "file"} · {formatAttachmentSize(attachment.size)}
            </div>
          </div>
        </a>
      {/each}
    </div>
  {:else}
    <div class="mt-2 flex w-full max-w-full flex-col gap-2" data-stop-link data-stop-tap>
      {#each attachments as attachment (attachment.url)}
        {@const value = getUrlValue(attachment.url)}
        {#if isPreviewableAttachment(attachment) && value}
          <ContentLinkBlock {value} {event} />
        {:else}
          <a
            href={attachment.url}
            target="_blank"
            rel="noopener noreferrer"
            class="flex max-w-lg items-center gap-3 rounded-2xl border border-base-content/10 bg-base-100 p-3 no-underline shadow-sm transition hover:border-primary/30 hover:shadow-md hover:no-underline">
            <div class="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-box bg-base-200">
              <Icon icon={File} size={8} />
              <span class="absolute text-[9px] font-semibold">
                {getAttachmentExtension(attachment)}
              </span>
            </div>
            <div class="min-w-0 flex-1">
              <div class="truncate text-sm font-semibold">
                {getAttachmentName(attachment)}
              </div>
              <div class="truncate text-xs opacity-70">
                {attachment.type || "file"} · {formatAttachmentSize(attachment.size)}
              </div>
            </div>
          </a>
        {/if}
      {/each}
    </div>
  {/if}
{/if}
