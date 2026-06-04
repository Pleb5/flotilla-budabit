<script lang="ts">
  import type {Instance} from "tippy.js"
  import {writable} from "svelte/store"
  import type {EventContent} from "@welshman/util"
  import {isMobile, preventDefault} from "@lib/html"
  import GallerySend from "@assets/icons/gallery-send.svg?dataurl"
  import WidgetAdd from "@assets/icons/widget-add.svg?dataurl"
  import Plane from "@assets/icons/plane-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import AttachmentMenu from "@app/components/AttachmentMenu.svelte"
  import ComposeMenu from "@app/components/ComposeMenu.svelte"
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
  import {onDestroy, onMount} from "svelte"

  type Props = {
    url?: string
    h?: string
    blossomContext?: BlossomUploadContext
    content?: string
    placeholder?: string
    submitLabel?: string
    showMenu?: boolean
    disabled?: boolean
    submitting?: boolean
    onEscape?: () => void
    onEditPrevious?: () => void
    onSubmit: (event: EventContent) => void | Promise<void>
  }

  const {
    url,
    h,
    blossomContext,
    content,
    placeholder = "",
    submitLabel = "Send message",
    showMenu = true,
    disabled = false,
    submitting = false,
    onEscape,
    onEditPrevious,
    onSubmit,
  }: Props = $props()

  const autofocus = !isMobile
  const sendShortcut = `${navigator.platform.includes("Mac") ? "cmd" : "ctrl"}+enter to send`

  const uploading = writable(false)
  const uploadStage = writable<BlossomUploadStage>("idle")
  let attachments = $state<DraftAttachment[]>([])
  let submitInFlight = $state(false)

  export const focus = () => editor.then(ed => ed.chain().focus().run())

  export const canEnterEditPrevious = () =>
    editor.then(ed => ed.getText({blockSeparator: "\n"}) === "" && attachments.length === 0)

  const handleKeyDown = async (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      onEscape?.()
    }

    if (event.key === "ArrowUp" && (await canEnterEditPrevious())) {
      onEditPrevious?.()
    }
  }

  const addFiles = (files?: FileList | null) => {
    if (disabled || submitting || submitInFlight || !files?.length) return

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
      blossomContext,
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

  const showPopover = () => popover?.show()

  const hidePopover = () => popover?.hide()

  const showAttachmentPopover = () => attachmentPopover?.show()

  const hideAttachmentPopover = () => attachmentPopover?.hide()

  const submit = async () => {
    if (disabled || submitting || submitInFlight || $uploading) return

    submitInFlight = true

    try {
      const ed = await editor
      const messageText = ed.getText({blockSeparator: "\n"}).trim()

      if (!messageText && attachments.length === 0) return

      let uploadedAttachments: PublishedAttachment[]

      try {
        uploadedAttachments = await uploadAttachments()
      } catch (error) {
        uploadStage.set("failed")
        pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
        return
      }

      const tags = ed.storage.nostr.getEditorTags()
      tags.push(...uploadedAttachments.map(makeAttachmentImetaTag))
      const content = appendAttachmentUrlsToContent(messageText, uploadedAttachments)

      try {
        const result = onSubmit({content, tags})
        if (result && typeof result.then === "function") await result
      } catch {
        return
      }

      ed.chain().clearContent().run()
      clearAttachments()
      uploadStage.set("idle")
    } finally {
      submitInFlight = false
    }
  }

  const editor = makeEditor({
    url,
    blossomContext,
    content: content ? plainTextToTiptapHTML(content) : "",
    placeholder,
    autofocus,
    submit,
    uploadStage,
    uploading,
    aggressive: false,
    inlineUploads: false,
  })

  let attachmentPopover: Instance | undefined = $state()
  let popover: Instance | undefined = $state()
  let mediaInput: HTMLInputElement | undefined = $state()
  let fileInput: HTMLInputElement | undefined = $state()
  let editorInstance: Awaited<typeof editor> | null = null
  let isDestroyed = false

  onMount(async () => {
    const ed = await editor
    if (isDestroyed) return
    editorInstance = ed
    ed.view.dom.addEventListener("keydown", handleKeyDown)
  })

  onDestroy(() => {
    isDestroyed = true
    editorInstance?.view?.dom.removeEventListener("keydown", handleKeyDown)
    clearAttachments()
  })
</script>

<form class="p-2" onsubmit={preventDefault(submit)}>
  <input
    bind:this={mediaInput}
    type="file"
    class="hidden"
    accept="image/*,video/*"
    multiple
    disabled={disabled || submitting || submitInFlight}
    onchange={event => {
      addFiles(event.currentTarget.files)
      event.currentTarget.value = ""
    }} />
  <input
    bind:this={fileInput}
    type="file"
    class="hidden"
    multiple
    disabled={disabled || submitting || submitInFlight}
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
    <div class="join">
      <Tippy
        bind:popover={attachmentPopover}
        component={AttachmentMenu}
        props={{onPickMedia: pickMediaFiles, onPickFile: pickGenericFiles, onClick: hideAttachmentPopover}}
        params={{trigger: "manual", interactive: true}}>
        <Button
          data-tip="Attach file"
          class="center join-item tooltip tooltip-right h-10 w-10 min-w-10 rounded-full border border-solid border-base-200 bg-base-300"
          disabled={disabled || submitting || submitInFlight || $uploading}
          onclick={showAttachmentPopover}>
          {#if $uploading}
            <span class="loading loading-spinner loading-xs"></span>
          {:else}
            <Icon icon={GallerySend} />
          {/if}
        </Button>
      </Tippy>
      {#if showMenu}
        <Tippy
          bind:popover
          component={ComposeMenu}
          props={{url, h, onClick: hidePopover}}
          params={{trigger: "manual", interactive: true}}>
          <Button
            data-tip="More options"
            class="center join-item tooltip tooltip-right h-10 w-10 min-w-10 rounded-full border border-solid border-base-200 bg-base-300"
            disabled={disabled || submitting || submitInFlight || $uploading}
            onclick={showPopover}>
            <Icon icon={WidgetAdd} />
          </Button>
        </Tippy>
      {/if}
    </div>
    <div class="chat-editor flex-grow overflow-hidden">
      <EditorContent {editor} />
    </div>
    <Button
      data-tip={!isMobile ? sendShortcut : undefined}
      class={`center absolute right-2 h-10 w-10 min-w-10 rounded-full ${!isMobile ? "tooltip tooltip-left" : ""}`}
      aria-label={submitLabel}
      disabled={disabled || submitting || submitInFlight || $uploading}
      onclick={submit}>
      <Icon icon={Plane} />
    </Button>
  </div>
</form>
