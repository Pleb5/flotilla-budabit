<script lang="ts">
  import {type Instance} from "tippy.js"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import RoomItemMenu from "@app/components/RoomItemMenu.svelte"

  const {
    url,
    event,
    readOnly = false,
    relays = [],
    protect = undefined,
    communitySectionName = "",
  } = $props()

  const open = () => popover?.show()

  const onClick = () => popover?.hide()

  const onDocumentClick = (event: MouseEvent) => {
    const target = event.target as Node | null

    if (!target || !popover?.state.isVisible) return
    if (element?.contains(target) || popover.popper.contains(target)) return

    popover.hide()
  }

  let popover: Instance | undefined = $state()
  let element: HTMLElement | undefined = $state()
</script>

<svelte:document onclick={onDocumentClick} />

<div bind:this={element} class="flex">
  <Button class="btn join-item btn-xs" onclick={open}>
    <Icon icon={MenuDots} size={4} />
  </Button>
  <Tippy
    bind:popover
    component={RoomItemMenu}
    props={{url, event, onClick, readOnly, relays, protect, communitySectionName}}
    params={{trigger: "manual", interactive: true}} />
</div>
