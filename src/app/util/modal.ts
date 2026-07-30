import type {Component} from "svelte"
import {derived, get, writable} from "svelte/store"
import {randomId, always, Emitter} from "@welshman/lib"
import {goto, replaceState} from "$app/navigation"
import {page} from "$app/stores"
import {
  getModalHashSyncPlan,
  getModalStackForActiveId,
  getModalTopClosePlan,
  shouldUseHistoryForTopClose,
} from "./modal-stack"

export type ModalOptions = {
  drawer?: boolean
  noEscape?: boolean
  fullscreen?: boolean
  replaceState?: boolean
  path?: string
}

export type Modal = {
  id: string
  component: Component
  props: Record<string, any>
  options: ModalOptions
}

export const emitter = new Emitter()

export const modals = writable<Record<string, Modal>>({})
export const modalIds = writable<string[]>([])

export const modalStack = derived([page, modals, modalIds], ([$page, $modals, $modalIds]) => {
  const activeId = $page.url.hash.slice(1)

  return getModalStackForActiveId($modalIds, activeId)
    .map(id => $modals[id])
    .filter((modal): modal is Modal => Boolean(modal))
})

export const modal = derived(modalStack, $modalStack => $modalStack.at(-1))

const getCurrentModalId = () => {
  const currentPage = get(page)
  const liveUrl = typeof window === "undefined" ? undefined : new URL(window.location.href)

  return liveUrl?.hash.slice(1) || currentPage.url.hash.slice(1)
}

const replaceModalHash = (id: string) => {
  const currentPage = get(page)
  const liveUrl = typeof window === "undefined" ? undefined : new URL(window.location.href)
  const url = liveUrl || new URL(currentPage.url)

  url.hash = id
  replaceState(`${url.pathname}${url.search}${url.hash}`, currentPage.state)
}

const clearModalHash = () => {
  const currentPage = get(page)
  const liveUrl = typeof window === "undefined" ? undefined : new URL(window.location.href)
  const url = liveUrl || new URL(currentPage.url)

  url.hash = ""
  replaceState(`${url.pathname}${url.search}`, currentPage.state)
}

const retainModalIds = (retainedIds: string[]) => {
  const current = get(modals)
  const retained = new Set(retainedIds.filter(id => current[id]))

  modals.set(
    Object.fromEntries(Object.entries(current).filter(([modalId]) => retained.has(modalId))),
  )
  modalIds.set(retainedIds.filter(id => retained.has(id)))
}

export const syncModalStoresToActiveId = (activeId: string) => {
  const currentIds = get(modalIds)
  const currentModals = get(modals)
  const plan =
    activeId && currentModals[activeId]
      ? getModalHashSyncPlan(currentIds, activeId)
      : {retainedIds: [], removedIds: [...currentIds]}

  if (plan.removedIds.length === 0) return

  retainModalIds(plan.retainedIds)
}

function isValidModalPath(path: string): boolean {
  if (!path) return true
  if (path.startsWith("/") && !path.startsWith("//")) return true
  // Reject anything with a colon before the first ? or # (catches javascript:, data:, etc.)
  const schemeEnd = path.search(/[?#]/)
  const prefix = schemeEnd === -1 ? path : path.slice(0, schemeEnd)
  if (prefix.includes(":")) return false
  // Reject protocol-relative URLs
  if (path.startsWith("//")) return false
  return true
}

export const pushModal = (
  component: Component<any>,
  props: Record<string, any> = {},
  options: ModalOptions = {},
) => {
  const id = randomId()
  const path = options.path || ""

  if (!isValidModalPath(path)) {
    console.error("Invalid modal path:", path)
    return null
  }

  const currentId = getCurrentModalId()
  const currentIds = get(modalIds)
  const retainedIds = getModalStackForActiveId(currentIds, currentId)
  const retained = new Set(retainedIds)

  modals.update(current => {
    const next = Object.fromEntries(
      Object.entries(current).filter(([modalId]) => retained.has(modalId)),
    )

    return {...next, [id]: {id, component, props, options}}
  })
  modalIds.set([...retainedIds, id])

  goto(path + "#" + id, {replaceState: options.replaceState, noScroll: true, keepFocus: true})

  return id
}

export const pushDrawer = (
  component: Component<any>,
  props: Record<string, any> = {},
  options: ModalOptions = {},
) => pushModal(component, props, {...options, drawer: true})

export const closeTopModal = () => {
  const currentId = getCurrentModalId()
  const currentModals = get(modals)
  const currentIds = get(modalIds)
  const currentModal = currentModals[currentId]
  const plan = getModalTopClosePlan(currentIds, currentId)

  if (!currentModal) {
    retainModalIds([])
    return clearModalHash()
  }

  emitter.emit("close")

  if (plan.previousId && currentModals[plan.previousId]) {
    if (shouldUseHistoryForTopClose(plan, currentModal.options, typeof window !== "undefined")) {
      window.history.back()
      return
    }

    retainModalIds(plan.retainedIds)
    replaceModalHash(plan.previousId)
    return
  }

  retainModalIds([])
  clearModalHash()
}

export const clearModals = () => {
  const currentPage = get(page)
  const liveUrl = typeof window === "undefined" ? undefined : new URL(window.location.href)
  const liveModalId = liveUrl?.hash.slice(1) || ""
  const currentModalId = liveModalId || currentPage.url.hash.slice(1)
  const currentModals = get(modals)

  modals.update(always({}))
  modalIds.set([])
  emitter.emit("close")

  if (currentModalId && currentModals[currentModalId]) {
    clearModalHash()
  }
}
