<script lang="ts">
  import {writable} from "svelte/store"
  import type {EventContent} from "@welshman/util"
  import {isMobile, preventDefault} from "@lib/html"
  import GallerySend from "@assets/icons/gallery-send.svg?dataurl"
  import Plane from "@assets/icons/plane-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import AttachmentMenu from "@app/components/AttachmentMenu.svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import ComposerAttachmentStrip from "@app/components/ComposerAttachmentStrip.svelte"
  import EditorContent from "@app/editor/EditorContent.svelte"
  import {makeEditor} from "@app/editor"
  import type {BlossomUploadStage} from "@app/core/blossom"
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
  import type {Instance} from "tippy.js"
  import {onDestroy} from "svelte"

  type Props = {
    onSubmit: (
      event: EventContent,
      submission: {revision: string; isCurrent: () => boolean},
    ) => Promise<boolean | void>
    disabled?: boolean
    disabledMessage?: string
    submitting?: boolean
  }

  let {
    onSubmit,
    disabled = false,
    disabledMessage = "Direct messages are unavailable.",
    submitting = $bindable(false),
  }: Props = $props()

  const autofocus = !isMobile && !disabled
  const sendShortcut = `${navigator.platform.includes("Mac") ? "cmd" : "ctrl"}+enter to send`

  const uploading = writable(false)
  const uploadStage = writable<BlossomUploadStage>("idle")
  let attachments = $state<DraftAttachment[]>([])
  let submitInFlight = $state(false)
  const draftId = crypto.randomUUID()
  let revision = 0
  let alive = true
  const edited = () => {
    revision++
  }

  export const focus = () => {
    if (disabled) return
    editor.then(ed => ed.chain().focus().run())
  }

  const addFiles = (files?: FileList | null) => {
    if (disabled || submitInFlight || !files?.length) return

    attachments = [...attachments, ...Array.from(files).map(makeDraftAttachment)]
    edited()
  }

  const removeAttachment = (id: string) => {
    const attachment = attachments.find(attachment => attachment.id === id)
    if (attachment) revokeDraftAttachment(attachment)

    attachments = attachments.filter(attachment => attachment.id !== id)
    edited()
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

  const pickMediaFiles = () => mediaInput?.click()

  const pickGenericFiles = () => fileInput?.click()

  const showAttachmentPopover = () => attachmentPopover?.show()

  const hideAttachmentPopover = () => attachmentPopover?.hide()

  const submit = async () => {
    if (disabled || submitInFlight || $uploading) return

    submitInFlight = true
    submitting = true

    try {
      const ed = await editor
      const messageText = ed.getText({blockSeparator: "\n"}).trim()
      const tags = ed.storage.nostr.getEditorTags()
      const submittedRevision = revision
      const isCurrent = () => alive && revision === submittedRevision

      if (!messageText && attachments.length === 0) return

      let uploadedAttachments: PublishedAttachment[]

      try {
        uploadedAttachments = await uploadAttachments()
      } catch (error) {
        uploadStage.set("failed")
        pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
        return
      }

      if (!alive) return
      tags.push(...uploadedAttachments.map(makeAttachmentImetaTag))
      const content = appendAttachmentUrlsToContent(messageText, uploadedAttachments)

      try {
        const submitted = await onSubmit(
          {content, tags},
          {revision: `${draftId}:${submittedRevision}`, isCurrent},
        )
        if (submitted === false) return
      } catch {
        return
      }

      if (isCurrent()) {
        ed.chain().clearContent().run()
        clearAttachments()
        uploadStage.set("idle")
      }
    } finally {
      submitInFlight = false
      submitting = false
    }
  }

  const editor = makeEditor({
    autofocus,
    submit,
    uploadStage,
    uploading,
    aggressive: false,
    encryptFiles: false,
    inlineUploads: false,
  })
  editor.then(ed => {
    if (alive) ed.on("update", edited)
  })

  let attachmentPopover: Instance | undefined = $state()
  let mediaInput: HTMLInputElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()

  onDestroy(() => {
    alive = false
    editor.then(ed => ed.off("update", edited))
    clearAttachments()
  })
</script>

{#if disabled}
  <div
    class="mx-2 my-2 rounded-box border border-dashed border-warning/40 bg-warning/10 p-3 text-sm">
    {disabledMessage}
  </div>
{:else}
  <form class="z-feature p-2" onsubmit={preventDefault(submit)}>
    <input
      bind:this={mediaInput}
      type="file"
      class="hidden"
      accept="image/*,video/*"
      multiple
      disabled={submitInFlight}
      onchange={event => {
        addFiles(event.currentTarget.files)
        event.currentTarget.value = ""
      }} />
    <input
      bind:this={fileInput}
      type="file"
      class="hidden"
      multiple
      disabled={submitInFlight}
      onchange={event => {
        addFiles(event.currentTarget.files)
        event.currentTarget.value = ""
      }} />
    <ComposerAttachmentStrip {attachments} onRemove={removeAttachment} />
    {#if $uploadStage !== "idle"}
      <div class="mb-2 ml-12">
        <BlossomUploadStatus stage={$uploadStage} />
      </div>
    {/if}
    <div class="relative flex gap-2">
      <Tippy
        bind:popover={attachmentPopover}
        component={AttachmentMenu}
        props={{
          onPickMedia: pickMediaFiles,
          onPickFile: pickGenericFiles,
          onClick: hideAttachmentPopover,
        }}
        params={{trigger: "manual", interactive: true}}>
        <Button
          data-tip="Attach file"
          aria-label="Attach file"
          class="center tooltip tooltip-right h-10 w-10 min-w-10 rounded-box bg-base-300 transition-colors hover:bg-base-200"
          disabled={submitInFlight || $uploading}
          onclick={showAttachmentPopover}>
          {#if $uploading}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <Icon icon={GallerySend} />
          {/if}
        </Button>
      </Tippy>
      <div class="chat-editor flex-grow overflow-hidden">
        <EditorContent {editor} />
      </div>
      <Button
        data-tip={!isMobile ? sendShortcut : undefined}
        aria-label="Send message"
        class={`center absolute right-2 h-10 w-10 min-w-10 rounded-full ${!isMobile ? "tooltip tooltip-left" : ""}`}
        disabled={submitInFlight || $uploading}
        onclick={submit}>
        <Icon icon={Plane} />
      </Button>
    </div>
  </form>
{/if}
