/// <reference types="vite/client" />
import {mount, unmount} from "svelte"
import type {ComponentProps} from "svelte"
import ShareActions from "./share-actions.svelte"

export function mountShareActionsFixture(props: ComponentProps<typeof ShareActions>) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  const target = document.createElement("div")
  document.body.appendChild(target)
  const component = mount(ShareActions, {target, props})
  return async () => {
    await unmount(component)
    target.remove()
  }
}
