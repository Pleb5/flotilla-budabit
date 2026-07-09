import type {Component} from "svelte"
import {derived, get, writable} from "svelte/store"
import {randomId, always, Emitter} from "@welshman/lib"
import {goto, replaceState} from "$app/navigation"
import {page} from "$app/stores"

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
  const activeIndex = $modalIds.indexOf(activeId)
  if (activeIndex < 0) return []

  return $modalIds
    .slice(0, activeIndex + 1)
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
  const activeIndex = currentIds.indexOf(currentId)
  const retainedIds = activeIndex >= 0 ? currentIds.slice(0, activeIndex + 1) : []
  const retained = new Set(retainedIds)

  modals.update(current => {
    const next = Object.fromEntries(Object.entries(current).filter(([modalId]) => retained.has(modalId)))

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
  const activeIndex = currentIds.indexOf(currentId)

  if (activeIndex < 0 || !currentModals[currentId]) return clearModalHash()

  const previousId = activeIndex > 0 ? currentIds[activeIndex - 1] : ""
  const removedIds = new Set(currentIds.slice(activeIndex))

  modals.update(current =>
    Object.fromEntries(Object.entries(current).filter(([modalId]) => !removedIds.has(modalId))),
  )
  if (!previousId) modalIds.set([])
  emitter.emit("close")

  if (previousId && currentModals[previousId]) replaceModalHash(previousId)
  else clearModalHash()
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
