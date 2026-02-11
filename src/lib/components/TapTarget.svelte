<script lang="ts">
  import {isMobile} from "@lib/html"

  const {children, onTap, ...restProps} = $props()

  const onclick = (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    const interactive = target?.closest?.(
      "button, a, input, textarea, select, [role='button'], [data-stop-tap]",
    )
    if (interactive && interactive !== event.currentTarget) {
      event.stopPropagation()
      return
    }

    if (isMobile && typeof onTap === "function") {
      onTap(event)
    }
  }
</script>

<div role="button" tabindex="0" {onclick} {...restProps}>
  {@render children()}
</div>
