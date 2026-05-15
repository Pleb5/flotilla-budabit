<script lang="ts">
  import {slide} from "@lib/transition"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  interface Props {
    title?: import("svelte").Snippet
    description?: import("svelte").Snippet
    children?: import("svelte").Snippet
    [key: string]: any
  }

  const {...props}: Props = $props()

  const toggle = () => {
    isOpen = !isOpen
  }

  const toggleFromKeyboard = (event: KeyboardEvent) => {
    if (event.key !== "Enter" && event.key !== " ") return

    event.preventDefault()
    toggle()
  }

  let isOpen = $state(false)
</script>

<div class="relative flex flex-col gap-4 {props.class}">
  <div
    role="button"
    tabindex="0"
    aria-expanded={isOpen}
    class="relative cursor-pointer pr-10"
    onclick={toggle}
    onkeydown={toggleFromKeyboard}>
    <div class="absolute right-0 top-0 h-4 w-4 transition-all" class:rotate-90={!isOpen}>
      <Icon icon={AltArrowDown} />
    </div>
    <div class="flex flex-col gap-4">
      {@render props.title?.()}
      {@render props.description?.()}
    </div>
  </div>
  {#if isOpen}
    <div transition:slide>
      {@render props.children?.()}
    </div>
  {/if}
</div>
