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
  }

  const {attachments = [], event}: Props = $props()

  const getUrlValue = (url: string) => {
    try {
      return {url: new URL(url)}
    } catch {
      return undefined
    }
  }
</script>

{#if attachments.length > 0}
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
              {attachment.name || attachment.url.split("/").at(-1) || "Attachment"}
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
