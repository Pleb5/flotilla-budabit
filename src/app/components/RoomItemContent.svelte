<script lang="ts">
  import cx from "classnames"
  import type {ComponentProps} from "svelte"
  import {goto} from "$app/navigation"
  import {MESSAGE} from "@welshman/util"
  import {isMobile} from "@lib/html"
  import NoteContent from "@app/components/NoteContent.svelte"
  import {getRoomItemPath} from "@app/util/routes"

  const props: ComponentProps<typeof NoteContent> = $props()

  const path = getRoomItemPath(props.url!, props.event)

  const isInteractiveTarget = (target: EventTarget | null) =>
    target instanceof HTMLElement &&
    Boolean(target.closest("button, a, input, textarea, select, [role='button'], [data-stop-link]"))

  const openPath = (event: MouseEvent) => {
    if (!path || isInteractiveTarget(event.target)) return

    goto(path)
  }

  const openPathFromKeyboard = (event: KeyboardEvent) => {
    if (!path || isInteractiveTarget(event.target)) return
    if (event.key !== "Enter" && event.key !== " ") return

    event.preventDefault()
    goto(path)
  }
</script>

<div class={cx("w-full min-w-0 text-sm", {"card2 card2-sm bg-alt": props.event.kind !== MESSAGE})}>
  {#if path && !isMobile}
    <div
      role="link"
      tabindex="0"
      class="block w-full min-w-0 cursor-pointer"
      onclick={openPath}
      onkeydown={openPathFromKeyboard}>
      <NoteContent {...props} />
    </div>
  {:else}
    <NoteContent {...props} />
  {/if}
</div>
