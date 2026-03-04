<script lang="ts">
  import "tippy.js/animations/shift-away.css"

  import tippy from "tippy.js"
  import {onMount, mount, unmount} from "svelte"
  import {isMobile} from "@lib/html"

  let {
    component,
    children = undefined,
    props = {},
    params = {},
    popover = $bindable(),
    instance = $bindable(),
    ...restProps
  } = $props()

  let element: Element

  onMount(() => {
    const target = document.createElement("div")

    popover = tippy(element, {
      content: target,
      animation: "shift-away",
      appendTo: document.querySelector(".tippy-target")!,
      trigger: isMobile ? "click" : "mouseenter focus",
      ...params,
    })

    const mounted = mount(component, {target, props})
    instance = mounted

    return () => {
      void unmount(mounted)
      popover?.destroy()
      popover = undefined
      instance = undefined
    }
  })
</script>

<div bind:this={element} class={restProps.class}>
  {@render children?.()}
</div>
