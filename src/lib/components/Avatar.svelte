<script lang="ts">
  import {onMount} from "svelte"
  import Icon from "@lib/components/Icon.svelte"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"

  const {src = "", size = 7, icon = UserRounded, style = "", responsive = false, ...restProps} = $props()

  let element: HTMLElement

  const rem = $derived(size * 4)
  
  // Calculate responsive sizes if responsive prop is true
  const mobileSize = $derived(responsive ? Math.max(6, Math.round(size * 0.6)) : size)
  const mobileSizePx = $derived(mobileSize * 4)
  const desktopSizePx = $derived(size * 4)
  
  // Responsive classes for Tailwind using CSS custom properties
  const responsiveClasses = $derived(
    responsive
      ? "!w-[var(--avatar-size-mobile)] !h-[var(--avatar-size-mobile)] !min-w-[var(--avatar-size-mobile)] sm:!w-[var(--avatar-size-desktop)] sm:!h-[var(--avatar-size-desktop)] sm:!min-w-[var(--avatar-size-desktop)]"
      : ""
  )
  
  // Responsive style with CSS custom properties
  const responsiveStyle = $derived(
    responsive
      ? `--avatar-size-mobile: ${mobileSizePx}px; --avatar-size-desktop: ${desktopSizePx}px;`
      : ""
  )
  
  // Inline size styles - only needed when not responsive (responsive uses Tailwind classes)
  const sizeStyle = $derived(
    responsive
      ? ""
      : `width: ${rem}px; height: ${rem}px; min-width: ${rem}px;`
  )

  onMount(() => {
    if (src) {
      const image = new Image()

      image.addEventListener("error", () => {
        element?.querySelector(".hidden")?.classList.remove("hidden")
      })

      image.src = src
    }
  })
</script>

<div
  bind:this={element}
  class="{restProps.class} {responsiveClasses} relative !flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-cover bg-center"
  style="{sizeStyle} background-image: url({src}); {responsiveStyle} {style}">
  <Icon {icon} class={src ? "hidden" : ""} size={Math.round(size * 0.8)} />
</div>
