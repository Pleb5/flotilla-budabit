<script lang="ts">
  import {writable} from "svelte/store"
  import type {EventContent} from "@welshman/util"
  import {isMobile, preventDefault} from "@lib/html"
  import GallerySend from "@assets/icons/gallery-send.svg?dataurl"
  import Plane from "@assets/icons/plane-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import EditorContent from "@app/editor/EditorContent.svelte"
  import {makeEditor} from "@app/editor"
  import SlotRenderer from "@app/extensions/components/SlotRenderer.svelte"

  type Props = {
    onSubmit: (event: EventContent) => void
    disabled?: boolean
    disabledMessage?: string
  }

  const {
    onSubmit,
    disabled = false,
    disabledMessage = "Direct messages are unavailable.",
  }: Props = $props()

  const autofocus = !isMobile && !disabled
  const sendShortcut = `${navigator.platform.includes("Mac") ? "cmd" : "ctrl"}+enter to send`

  const uploading = writable(false)

  export const focus = () => {
    if (disabled) return
    editor.then(ed => ed.chain().focus().run())
  }

  const uploadFiles = () => {
    if (disabled) return
    editor.then(ed => ed.chain().selectFiles().run())
  }

  const submit = async () => {
    if (disabled || $uploading) return

    const ed = await editor
    const content = ed.getText({blockSeparator: "\n"}).trim()
    const tags = ed.storage.nostr.getEditorTags()

    if (!content) return

    onSubmit({content, tags})

    ed.chain().clearContent().run()
  }

  const editor = makeEditor({
    autofocus,
    submit,
    uploading,
    aggressive: false,
    encryptFiles: false,
  })
</script>

{#if disabled}
  <div class="mx-2 my-2 rounded-box border border-dashed border-warning/40 bg-warning/10 p-3 text-sm">
    {disabledMessage}
  </div>
{:else}
  <form class="relative z-feature flex gap-2 p-2" onsubmit={preventDefault(submit)}>
    <Button
      data-tip="Add an image"
      class="center tooltip tooltip-right h-10 w-10 min-w-10 rounded-box bg-base-300 transition-colors hover:bg-base-200"
      disabled={$uploading}
      onclick={uploadFiles}>
      {#if $uploading}
        <span class="loading loading-spinner loading-xs"></span>
      {:else}
        <Icon icon={GallerySend} />
      {/if}
    </Button>
    <div class="chat-editor flex-grow overflow-hidden">
      <EditorContent {editor} />
    </div>
    <Button
      data-tip={!isMobile ? sendShortcut : undefined}
      class={`center absolute right-4 h-10 w-10 min-w-10 rounded-full ${!isMobile ? "tooltip tooltip-left" : ""}`}
      disabled={$uploading}
      onclick={submit}>
      <Icon icon={Plane} />
    </Button>
    {#if true}
      <div class="ml-2 flex items-center">
        <SlotRenderer slotId="chat:composer:actions" context={{editor}} />
      </div>
    {/if}
  </form>
{/if}
