<script lang="ts">
  import {onMount, mount, unmount, createRawSnippet, getAllContexts, tick} from "svelte"
  import {page} from "$app/stores"
  import Drawer from "@lib/components/Drawer.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import {modalStack, closeTopModal, syncModalStoresToActiveId, type Modal} from "@app/util/modal"

  const closeModals = () => {
    const topModal = $modalStack.at(-1)
    return topModal && !topModal.options.noEscape ? closeTopModal() : false
  }

  const getFocusTargets = (host: HTMLElement) =>
    Array.from(
      host.querySelectorAll<HTMLElement>(
        "[data-modal-content] :is(button, a[href], input, select, textarea, [tabindex])",
      ),
    ).filter(
      target =>
        target.tabIndex >= 0 &&
        !target.matches(":disabled") &&
        !target.closest("[inert]") &&
        target.getClientRects().length > 0,
    )

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return
    const manageFocus = $modalStack.some(modal => modal.options.trapFocus)
    if (e.key === "Escape" && (manageFocus || e.target === document.body)) {
      e.preventDefault()
      closeModals()
    } else if (e.key === "Tab" && manageFocus) {
      const host = mountedModals.get(activeModalId)?.host
      if (!host) return
      const targets = getFocusTargets(host)
      const first = targets[0]
      const last = targets.at(-1)
      if (!first) {
        e.preventDefault()
        host.querySelector<HTMLElement>('[role="dialog"]')?.focus()
      } else if (!targets.includes(document.activeElement as HTMLElement)) {
        e.preventDefault()
        ;(e.shiftKey ? last : first)?.focus()
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }

  let element: HTMLElement
  let activeModalId = ""
  const mountedModals = new Map<
    string,
    {host: HTMLElement; instance: any; returnFocus: HTMLElement | null; trapFocus: boolean}
  >()
  const modalContexts = getAllContexts()

  const mountModal = (modal: Modal) => {
    const host = document.createElement("div")
    const {options, component, props} = modal
    const wrapper = options.drawer ? Drawer : Dialog
    const returnFocus =
      document.activeElement instanceof HTMLElement ? document.activeElement : null

    element.appendChild(host)

    const instance = mount(wrapper as any, {
      target: host,
      context: modalContexts,
      props: {
        onClose: closeModals,
        fullscreen: options.fullscreen,
        fixedHeight: options.fixedHeight,
        ariaLabel: options.ariaLabel,
        children: createRawSnippet(() => ({
          render: () => "<div data-modal-content></div>",
          setup: (target: Element) => {
            const child = mount(component, {target, props, context: modalContexts})

            return () => unmount(child)
          },
        })),
      },
    })

    mountedModals.set(modal.id, {
      host,
      instance,
      returnFocus,
      trapFocus: Boolean(options.trapFocus),
    })
  }

  const unmountModal = (id: string) => {
    const mounted = mountedModals.get(id)
    if (!mounted) return

    mountedModals.delete(id)
    mounted.host.inert = true
    mounted.host.setAttribute("aria-hidden", "true")
    // Keep the host attached until the exit animation has finished.
    void unmount(mounted.instance, {outro: true}).then(() => mounted.host.remove())
  }

  const syncModalStack = (stack: Modal[]) => {
    const activeId = stack.at(-1)?.id || ""
    const activeIds = new Set(stack.map(modal => modal.id))
    const previousModal = mountedModals.get(activeModalId)
    const manageFocus =
      stack.some(modal => modal.options.trapFocus) ||
      Array.from(mountedModals.values()).some(modal => modal.trapFocus)
    const activeChanged = activeId !== activeModalId

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

    activeModalId = activeId
    if (activeChanged && manageFocus) {
      void tick().then(() => {
        if (activeModalId !== activeId) return
        const host = mountedModals.get(activeId)?.host
        const returnFocus = previousModal?.returnFocus
        if (
          returnFocus?.isConnected &&
          !returnFocus.closest("[inert]") &&
          (!host || host.contains(returnFocus))
        ) {
          returnFocus.focus({preventScroll: true})
        } else if (host) {
          const target =
            host.querySelector<HTMLElement>("[data-modal-initial-focus]") ||
            getFocusTargets(host)[0] ||
            host.querySelector<HTMLElement>('[role="dialog"]')
          target?.focus({preventScroll: true})
        }
      })
    }
  }

  onMount(() => {
    const unsubscribePage = page.subscribe($page =>
      syncModalStoresToActiveId($page.url.hash.slice(1)),
    )
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
