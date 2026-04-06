<script lang="ts">
  import type {Snippet} from "svelte"
  import {onMount} from "svelte"
  import {fly} from "@lib/transition"

  interface Props {
    onClose: () => void
    align?: "left" | "right"
    widthClass?: string
    viewportMargin?: number
    children?: Snippet
  }

  const {onClose, align = "left", widthClass = "w-72", viewportMargin = 16, children}: Props =
    $props()

  let element: HTMLElement | undefined = $state()
  let left = $state(viewportMargin)
  let top = $state(viewportMargin)
  let maxHeight = $state(360)
  let ready = $state(false)
  let rafId = 0

  const reposition = () => {
    if (!element) return

    const anchor = element.parentElement as HTMLElement | null

    if (!anchor) return

    const anchorRect = anchor.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight
    const gap = 8
    const preferredLeft = align === "right" ? anchorRect.right - rect.width : anchorRect.left
    const clampedLeft = Math.max(
      viewportMargin,
      Math.min(viewportWidth - viewportMargin - rect.width, preferredLeft),
    )
    const spaceBelow = viewportHeight - anchorRect.bottom - gap - viewportMargin
    const spaceAbove = anchorRect.top - gap - viewportMargin
    const placeAbove = rect.height > spaceBelow && spaceAbove > spaceBelow
    const nextMaxHeight = Math.max(
      160,
      Math.min(viewportHeight - viewportMargin * 2, placeAbove ? spaceAbove : spaceBelow),
    )
    const nextTop = placeAbove
      ? Math.max(viewportMargin, anchorRect.top - gap - Math.min(rect.height, nextMaxHeight))
      : Math.min(
          Math.max(viewportMargin, anchorRect.bottom + gap),
          viewportHeight - viewportMargin - Math.min(rect.height, nextMaxHeight),
        )

    left = clampedLeft
    top = nextTop
    maxHeight = nextMaxHeight
    ready = true
  }

  const scheduleReposition = () => {
    cancelAnimationFrame(rafId)
    rafId = requestAnimationFrame(() => {
      reposition()
    })
  }

  onMount(() => {
    const updatePosition = () => {
      scheduleReposition()
    }

    updatePosition()

    window.addEventListener("resize", updatePosition)
    window.addEventListener("scroll", updatePosition, true)

    let observer: ResizeObserver | undefined

    if (typeof ResizeObserver !== "undefined" && element) {
      observer = new ResizeObserver(updatePosition)
      observer.observe(element)
      const anchor = element.parentElement as HTMLElement | null

      if (anchor) {
        observer.observe(anchor)
      }
    }

    return () => {
      window.removeEventListener("resize", updatePosition)
      window.removeEventListener("scroll", updatePosition, true)
      observer?.disconnect()
      cancelAnimationFrame(rafId)
    }
  })

  $effect(() => {
    if (!element) return

    scheduleReposition()
  })

  const onMouseUp = (event: MouseEvent) => {
    const target = event.target as Node | null

    if (!element?.contains(target)) {
      setTimeout(onClose)
    }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      setTimeout(onClose)
    }
  }
</script>

<svelte:window onmouseup={onMouseUp} onkeydown={onKeyDown} />

<div
  bind:this={element}
  class={`fixed z-popover max-w-[calc(100vw-3rem)] ${widthClass}`}
  style={`left:${left}px; top:${top}px; max-height:${maxHeight}px; visibility:${ready ? "visible" : "hidden"};`}>
  <div
    transition:fly|local
    class="scrollbar-thin max-h-full overflow-y-auto overscroll-contain rounded-box border border-base-300/70 bg-base-100 p-3 shadow-md"
    style={`max-height:${maxHeight}px; -webkit-overflow-scrolling: touch; touch-action: pan-y;`}>
    {@render children?.()}
  </div>
</div>
