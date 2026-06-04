<script lang="ts">
  import type {Instance} from "tippy.js"
  import {onDestroy, onMount} from "svelte"
  import {writable} from "svelte/store"
  import GallerySend from "@assets/icons/gallery-send.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import AttachmentMenu from "@app/components/AttachmentMenu.svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import ComposerAttachmentStrip from "@app/components/ComposerAttachmentStrip.svelte"
  import EditorContent from "@app/editor/EditorContent.svelte"
  import {makeEditor, plainTextToTiptapHTML} from "@app/editor"
  import type {BlossomUploadContext, BlossomUploadStage} from "@app/core/blossom"
  import {uploadFile} from "@app/core/commands"
  import {promptBlossomMirrorUploads} from "@app/util/blossom-mirror-prompt"
  import {pushToast} from "@app/util/toast"
  import {
    appendAttachmentUrlsToContent,
    makeAttachmentImetaTag,
    makeDraftAttachment,
    makePublishedAttachment,
    revokeDraftAttachment,
    type DraftAttachment,
    type PublishedAttachment,
  } from "@app/util/attachments"
  import type {
    RichComposerContext,
    RichContentPayload,
    RichDescriptionEditorProps,
  } from "@nostr-git/ui"

  const {
    initialContent = "",
    placeholder = "Write a description...",
    compact = false,
    disabled = false,
    context,
    onReady,
  }: RichDescriptionEditorProps = $props()

  const getUrl = (context?: RichComposerContext) =>
    context?.url || context?.relayHint || context?.relays?.[0] || ""

  const getBlossomContext = (context?: RichComposerContext) =>
    context?.blossomContext as BlossomUploadContext | undefined

  const uploading = writable(false)
  const uploadStage = writable<BlossomUploadStage>("idle")
  let attachments = $state<DraftAttachment[]>([])

  const addFiles = (files?: FileList | null) => {
    if (disabled || !files?.length) return

    attachments = [...attachments, ...Array.from(files).map(makeDraftAttachment)]
  }

  const removeAttachment = (id: string) => {
    const attachment = attachments.find(attachment => attachment.id === id)
    if (attachment) revokeDraftAttachment(attachment)

    attachments = attachments.filter(attachment => attachment.id !== id)
  }

  const clearAttachments = () => {
    for (const attachment of attachments) revokeDraftAttachment(attachment)
    attachments = []
  }

  const updateAttachment = (id: string, update: Partial<DraftAttachment>) => {
    attachments = attachments.map(attachment =>
      attachment.id === id ? {...attachment, ...update} : attachment,
    )
  }

  const uploadAttachment = async (
    attachment: DraftAttachment,
  ): Promise<{published: PublishedAttachment; uploadId?: string}> => {
    if (attachment.result) {
      return {
        published: makePublishedAttachment({name: attachment.name, result: attachment.result}),
        uploadId: attachment.uploadId,
      }
    }

    updateAttachment(attachment.id, {status: "uploading", error: undefined})

    const {error, result, uploadId} = await uploadFile(attachment.file, {
      blossomContext: getBlossomContext(context),
      onStage: stage => uploadStage.set(stage),
    })

    if (error || !result?.url) {
      const message = error || "Attachment upload failed."
      updateAttachment(attachment.id, {status: "failed", error: message})
      throw new Error(message)
    }

    updateAttachment(attachment.id, {status: "uploaded", result, uploadId})

    return {published: makePublishedAttachment({name: attachment.name, result}), uploadId}
  }

  const uploadAttachments = async () => {
    const uploaded: PublishedAttachment[] = []
    const uploadIds: string[] = []

    if (attachments.length === 0) return uploaded

    uploading.set(true)
    uploadStage.set("preparing")

    try {
      for (const attachment of attachments) {
        const result = await uploadAttachment(attachment)

        uploaded.push(result.published)
        if (result.uploadId) uploadIds.push(result.uploadId)
      }

      promptBlossomMirrorUploads(uploadIds)

      return uploaded
    } finally {
      uploading.set(false)
    }
  }

  const getText = async () => {
    const ed = await editor

    return ed.getText({blockSeparator: "\n"}).trim()
  }

  const getContent = async (): Promise<RichContentPayload> => {
    const ed = await editor
    const text = await getText()

    let uploadedAttachments: PublishedAttachment[]
    try {
      uploadedAttachments = await uploadAttachments()
    } catch (error) {
      uploadStage.set("failed")
      pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
      throw error
    }

    const tags = ed.storage.nostr.getEditorTags()
    tags.push(...uploadedAttachments.map(makeAttachmentImetaTag))
    const content = appendAttachmentUrlsToContent(text, uploadedAttachments)

    if (uploadedAttachments.length > 0) uploadStage.set("idle")

    return {content, tags}
  }

  const focus = () => {
    if (disabled) return
    void editor.then(ed => ed.chain().focus().run())
  }

  const pickMediaFiles = () => mediaInput?.click()
  const pickGenericFiles = () => fileInput?.click()
  const showAttachmentPopover = () => attachmentPopover?.show()
  const hideAttachmentPopover = () => attachmentPopover?.hide()

  const editor = makeEditor({
    url: getUrl(context),
    blossomContext: getBlossomContext(context),
    content: plainTextToTiptapHTML(initialContent),
    placeholder,
    submit: () => undefined,
    uploadStage,
    uploading,
    aggressive: false,
    inlineUploads: false,
  })

  let attachmentPopover: Instance | undefined = $state()
  let mediaInput: HTMLInputElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()

  onMount(() => {
    onReady?.({getText, getContent, focus})
  })

  onDestroy(clearAttachments)
</script>

<div
  class="repo-rich-description-editor {compact ? 'repo-rich-description-editor--compact' : ''}"
  class:repo-rich-description-editor--disabled={disabled}>
  <input
    bind:this={mediaInput}
    type="file"
    class="hidden"
    accept="image/*,video/*"
    multiple
    disabled={disabled}
    onchange={event => {
      addFiles(event.currentTarget.files)
      event.currentTarget.value = ""
    }} />
  <input
    bind:this={fileInput}
    type="file"
    class="hidden"
    multiple
    disabled={disabled}
    onchange={event => {
      addFiles(event.currentTarget.files)
      event.currentTarget.value = ""
    }} />
  <ComposerAttachmentStrip {attachments} onRemove={removeAttachment} />
  {#if $uploadStage !== "idle"}
    <div class="mb-2">
      <BlossomUploadStatus stage={$uploadStage} />
    </div>
  {/if}
  <div class="flex min-w-0 gap-2 rounded-box border border-base-300 bg-base-100 p-2">
    <Tippy
      bind:popover={attachmentPopover}
      component={AttachmentMenu}
      props={{onPickMedia: pickMediaFiles, onPickFile: pickGenericFiles, onClick: hideAttachmentPopover}}
      params={{trigger: "manual", interactive: true}}>
      <Button
        data-tip="Attach file"
        class="center tooltip tooltip-right h-10 w-10 min-w-10 rounded-box bg-base-300 transition-colors hover:bg-base-200"
        disabled={disabled || $uploading}
        onclick={showAttachmentPopover}>
        {#if $uploading}
          <span class="loading loading-spinner loading-xs"></span>
        {:else}
          <Icon icon={GallerySend} />
        {/if}
      </Button>
    </Tippy>
    <div class="input-editor min-w-0 flex-1 overflow-hidden">
      <EditorContent {editor} />
    </div>
  </div>
</div>

<style>
  .repo-rich-description-editor {
    min-width: 0;
  }

  .repo-rich-description-editor :global(.tiptap) {
    min-height: 12rem;
    max-height: 24rem;
  }

  .repo-rich-description-editor--compact :global(.tiptap) {
    min-height: 9rem;
    max-height: 14rem;
  }

  .repo-rich-description-editor--disabled {
    pointer-events: none;
    opacity: 0.7;
  }
</style>
