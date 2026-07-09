<script lang="ts">
  import {onMount, mount, unmount, createRawSnippet, getAllContexts} from "svelte"
  import {page} from "$app/stores"
  import Drawer from "@lib/components/Drawer.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {modalStack, closeTopModal, syncModalStoresToActiveId, type Modal} from "@app/util/modal"

  const closeModals = () => {
    const topModal = $modalStack.at(-1)
    if (topModal && !topModal.options.noEscape) closeTopModal()
  }

  const onKeyDown = (e: any) => {
    if (e.code === "Escape" && e.target === document.body) {
      closeModals()
    }
  }

  let element: HTMLElement
  const mountedModals = new Map<string, {host: HTMLElement; instance: any}>()
  const modalContexts = getAllContexts()

  const mountModal = (modal: Modal) => {
    const host = document.createElement("div")
    const {options, component, props} = modal
    const wrapper = options.drawer ? Drawer : Dialog

    element.appendChild(host)

    const instance = mount(wrapper as any, {
      target: host,
      context: modalContexts,
      props: {
        onClose: closeModals,
        fullscreen: options.fullscreen,
        children: createRawSnippet(() => ({
          render: () => "<div></div>",
          setup: (target: Element) => {
            const child = mount(component, {target, props, context: modalContexts})

            return () => unmount(child)
          },
        })),
      },
    })

    mountedModals.set(modal.id, {host, instance})
  }

  const unmountModal = (id: string) => {
    const mounted = mountedModals.get(id)
    if (!mounted) return

    unmount(mounted.instance, {outro: true})
    mounted.host.remove()
    mountedModals.delete(id)
  }

  const syncModalStack = (stack: Modal[]) => {
    const activeId = stack.at(-1)?.id || ""
    const activeIds = new Set(stack.map(modal => modal.id))

    for (const id of Array.from(mountedModals.keys())) {
      if (!activeIds.has(id)) unmountModal(id)
    }

    for (const modal of stack) {
      if (!mountedModals.has(modal.id)) mountModal(modal)

      const mounted = mountedModals.get(modal.id)
      if (!mounted) continue

      const active = modal.id === activeId

      mounted.host.style.display = active ? "" : "none"
      mounted.host.toggleAttribute("inert", !active)
      mounted.host.setAttribute("aria-hidden", active ? "false" : "true")
    }
  }

  onMount(() => {
    const unsubscribePage = page.subscribe($page => syncModalStoresToActiveId($page.url.hash.slice(1)))
    const unsubscribeStack = modalStack.subscribe(syncModalStack)

    return () => {
      unsubscribePage()
      unsubscribeStack()
      for (const id of Array.from(mountedModals.keys())) unmountModal(id)
    }
  })
</script>

<svelte:window onkeydown={onKeyDown} />

<div bind:this={element} data-testid="modal-root"></div>
