<script lang="ts">
  import {fly} from "svelte/transition"
  import {throttle, clamp} from "@welshman/lib"
  import {preventDefault, stopPropagation} from "@lib/html"

  const SUGGESTIONS_SEARCH_THROTTLE_MS = 350

  const {
    term,
    search,
    select,
    component: Component,
    style = "",
    allowCreate = false,
    showEmpty = true,
    throttleMs = SUGGESTIONS_SEARCH_THROTTLE_MS,
    disabledValues = [],
    disabledLabel = "",
  } = $props()

  let index = $state(0)
  let items: string[] = $state([])

  const populateItems = throttle(throttleMs, term => {
    const nextItems = search(term).slice(0, 5)

    items = nextItems
    index = 0
  })

  const setIndex = (newIndex: number, block: any) => {
    index = clamp([0, items.length - 1], newIndex)
  }

  const isDisabled = (value: string) => disabledValues.includes(value)

  export const onKeyDown = (e: any) => {
    if (["Enter", "Tab"].includes(e.code)) {
      const value = items[index]

      if (value && !isDisabled(value)) {
        select(value)
        return true
      } else if ($term && allowCreate) {
        select($term)
        return true
      }
    }

    if (e.code === "Space" && $term && allowCreate) {
      select($term)
      return true
    }

    if (e.code === "ArrowUp") {
      setIndex(index - 1, "start")

      return true
    }

    if (e.code === "ArrowDown") {
      setIndex(index + 1, "start")

      return true
    }
  }

  const onmousedown = (e: Event) => {
    e.preventDefault()
    e.stopPropagation()
  }

  $effect(() => {
    populateItems($term)
  })
</script>

<div transition:fly|local={{duration: 200}} class="tiptap-suggestions" {style}>
  <div class="tiptap-suggestions__content max-h-[40vh]">
    {#if $term && allowCreate && !items.includes($term)}
      <button
        class="tiptap-suggestions__create"
        {onmousedown}
        onclick={stopPropagation(preventDefault(() => select($term)))}>
        Use "<Component value={$term}></Component>"
      </button>
    {/if}
    {#each items as value, i (value)}
      {@const disabled = isDisabled(value)}
      <button
        aria-label={value}
        aria-disabled={disabled}
        class="tiptap-suggestions__item"
        class:tiptap-suggestions__selected={index === i}
        class:tiptap-suggestions__disabled={disabled}
        tabindex={disabled ? -1 : 0}
        {onmousedown}
        onclick={stopPropagation(preventDefault(() => !disabled && select(value)))}>
        <div class="flex w-full min-w-0 items-center justify-between gap-3">
          <Component {value}></Component>
          {#if disabled && disabledLabel}
            <span class="badge badge-neutral badge-sm shrink-0">{disabledLabel}</span>
          {/if}
        </div>
      </button>
    {/each}
  </div>
  {#if showEmpty && items.length === 0}
    <div class="tiptap-suggestions__empty">No results</div>
  {/if}
</div>
