/// <reference types="vite/client" />
/// <reference types="@sveltejs/kit" />
import {mount, unmount} from "svelte"
import type {ComponentProps} from "svelte"
import {repository} from "@welshman/app"
import CommentShareLayout from "./comment-share-layout.svelte"

export function mountCommentShareLayoutFixture(props: ComponentProps<typeof CommentShareLayout>) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  // Insert fixture events into the local read cache only; do not sign or publish to relays.
  repository.publish(props.issue)
  repository.publish(props.comment)
  const target = document.createElement("div")
  document.body.appendChild(target)
  const component = mount(CommentShareLayout, {target, props})
  return async () => {
    await unmount(component)
    target.remove()
  }
}
