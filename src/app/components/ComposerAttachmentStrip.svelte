<script lang="ts">
  import Close from "@assets/icons/close.svg?dataurl"
  import File from "@assets/icons/file.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {
    formatAttachmentSize,
    getAttachmentExtension,
    type DraftAttachment,
  } from "@app/util/attachments"

  type Props = {
    attachments: DraftAttachment[]
    onRemove: (id: string) => void
  }

  const {attachments, onRemove}: Props = $props()
</script>

{#if attachments.length > 0}
  <div class="mb-2 flex gap-2 overflow-x-auto px-1 pb-1">
    {#each attachments as attachment (attachment.id)}
      <div
        class="relative flex h-28 w-28 shrink-0 flex-col overflow-hidden rounded-box border border-base-content/20 bg-base-200 text-xs shadow-sm sm:h-32 sm:w-32"
        title={attachment.name}>
        <Button
          class="btn btn-circle btn-xs absolute right-1 top-1 z-10 bg-base-100/90"
          onclick={() => onRemove(attachment.id)}
          aria-label="Remove attachment">
          <Icon icon={Close} size={3} />
        </Button>

        {#if attachment.previewUrl && attachment.type.startsWith("image/")}
          <img alt="" src={attachment.previewUrl} class="h-full w-full object-cover" />
        {:else if attachment.previewUrl && attachment.type.startsWith("video/")}
          <video muted src={attachment.previewUrl} class="h-full w-full bg-base-300 object-cover">
            <track kind="captions" />
          </video>
        {:else}
          <div class="flex flex-1 flex-col items-center justify-center gap-2 p-3 text-center">
            <div class="relative">
              <Icon icon={File} size={10} />
              <span
                class="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[10px] font-semibold">
                {getAttachmentExtension(attachment)}
              </span>
            </div>
            <div class="line-clamp-2 max-w-full break-words font-medium">{attachment.name}</div>
            <div class="opacity-60">{formatAttachmentSize(attachment.size)}</div>
          </div>
        {/if}

        {#if attachment.status === "uploading"}
          <div class="absolute inset-0 flex items-center justify-center bg-base-300/70">
            <span class="loading loading-spinner loading-sm"></span>
          </div>
        {:else if attachment.status === "failed"}
          <div
            class="absolute inset-x-0 bottom-0 truncate bg-error/90 p-1 text-center text-error-content"
            title={attachment.error || "Upload failed"}>
            {attachment.error || "Upload failed"}
          </div>
        {/if}
      </div>
    {/each}
  </div>
{/if}
