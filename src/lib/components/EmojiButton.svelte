<script lang="ts">
  import {type Instance} from "tippy.js"
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import {onDestroy} from "svelte"
  import {between, throttle} from "@welshman/lib"
  import Button from "@lib/components/Button.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import EmojiPicker from "@lib/components/EmojiPicker.svelte"

  const {...props} = $props()

  const open = () => {
    if (!popover || popover.state.isDestroyed) return
    popover.show()
    tracking = true
  }

  const close = () => {
    tracking = false
    if (!popover || popover.state.isDestroyed) return
    popover.hide()
  }

  const onClick = (emoji: NativeEmoji) => {
    props.onEmoji(emoji)
    close()
  }

  const onMouseMove = throttle(300, ({clientX, clientY}: MouseEvent) => {
    if (destroyed || !tracking) return
    if (!popover || popover.state.isDestroyed || !popover.state.isShown) return
    const popper = popover.popper
    if (!popper) return
    const {x, y, width, height} = popper.getBoundingClientRect()

    if (!between([x, x + width], clientX) || !between([y - 100, y + height + 100], clientY)) {
      close()
    }
  })

  let popover: Instance | undefined = $state()
  let tracking = $state(false)
  let destroyed = false
  const handleMouseMove = (event: MouseEvent) => onMouseMove(event)

  $effect(() => {
    if (!tracking || destroyed) return
    document.addEventListener("mousemove", handleMouseMove)
    return () => {
      document.removeEventListener("mousemove", handleMouseMove)
    }
  })

  onDestroy(() => {
    destroyed = true
    tracking = false
    popover = undefined
  })
</script>

<Tippy
  bind:popover
  component={EmojiPicker}
  props={{onClick}}
  params={{trigger: "manual", interactive: true}}>
  <Button onclick={open} class={props.class}>
    {@render props.children?.()}
  </Button>
</Tippy>
