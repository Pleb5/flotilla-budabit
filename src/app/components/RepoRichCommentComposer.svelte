<script lang="ts">
  import RoomCompose from "@app/components/RoomCompose.svelte"
  import type {BlossomUploadContext} from "@app/core/blossom"
  import type {EventContent} from "@welshman/util"
  import type {RichCommentComposerProps, RichComposerContext} from "@nostr-git/ui"

  const {
    initialContent = "",
    mode = "comment",
    compact = false,
    disabled = false,
    submitting = false,
    context,
    onSubmit,
    onCancel,
    onEscape,
  }: RichCommentComposerProps = $props()

  const getUrl = (context?: RichComposerContext) =>
    context?.url || context?.relayHint || context?.relays?.[0] || ""

  const getBlossomContext = (context?: RichComposerContext) =>
    context?.blossomContext as BlossomUploadContext | undefined

  const submit = ({content, tags = []}: EventContent) => {
    if (disabled || submitting) return

    return onSubmit({content, tags})
  }

  const escape = () => {
    onEscape?.()
    if (!onEscape) onCancel?.()
  }
</script>

{#if disabled}
  <div class="rounded-box border border-dashed border-base-content/20 bg-base-200/50 p-3 text-sm opacity-70">
    Commenting is currently unavailable.
  </div>
{:else}
  <div
    class="repo-rich-comment-composer {compact ? 'repo-rich-comment-composer--compact' : ''}"
    data-mode={mode}>
    {#key `${mode}:${initialContent}`}
      <RoomCompose
        url={getUrl(context)}
        blossomContext={getBlossomContext(context)}
        content={initialContent}
        showMenu={false}
        {disabled}
        {submitting}
        onSubmit={submit}
        onEscape={escape} />
    {/key}
  </div>
{/if}

<style>
  .repo-rich-comment-composer {
    min-width: 0;
  }

  .repo-rich-comment-composer :global(form) {
    padding: 0;
  }

  .repo-rich-comment-composer--compact :global(.chat-editor .tiptap) {
    max-height: 9rem;
  }
</style>
