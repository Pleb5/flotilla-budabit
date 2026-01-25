import type {Component} from "svelte"
import {derived, writable} from "svelte/store"
import {randomId, always, assoc, Emitter} from "@welshman/lib"
import {goto} from "$app/navigation"
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

export const modal = derived([page, modals], ([$page, $modals]) => {
  return $modals[$page.url.hash.slice(1)]
})

function isValidModalPath(path: string): boolean {
  // Must be empty, start with /, or be a relative path without protocol
  if (!path) return true;
  if (path.includes('://')) return false;
  if (path.startsWith('//')) return false;
  return true;
}

export const pushModal = (
  component: Component<any>,
  props: Record<string, any> = {},
  options: ModalOptions = {},
) => {
  const id = randomId()
  const path = options.path || ""

  if (!isValidModalPath(path)) {
    console.error('Invalid modal path:', path)
    return null
  }

  modals.update(assoc(id, {id, component, props, options}))

  goto(path + "#" + id, {replaceState: options.replaceState})

  return id
}

export const pushDrawer = (
  component: Component<any>,
  props: Record<string, any> = {},
  options: ModalOptions = {},
) => pushModal(component, props, {...options, drawer: true})

export const clearModals = () => {
  modals.update(always({}))
  emitter.emit("close")
}
