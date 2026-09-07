/// <reference types="vite/client" />
/// <reference types="@sveltejs/kit" />
import {mount, unmount, type ComponentProps} from "svelte"
import ReplyComposer from "./reply-composer.svelte"

export function mountReplyComposerFixture(props: ComponentProps<typeof ReplyComposer> = {}) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  const target = document.createElement("div")
  document.body.appendChild(target)
  const component = mount(ReplyComposer, {target, props})
  return async () => {
    await unmount(component)
    target.remove()
  }
}
