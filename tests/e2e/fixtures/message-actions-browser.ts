/// <reference types="vite/client" />
/// <reference types="@sveltejs/kit" />
import {mount, unmount} from "svelte"
import {get} from "svelte/store"
import type {ComponentProps} from "svelte"
import {buildCommunityDefinition, parseCommunityDefinition} from "@app/core/community"
import {
  activeExactCommunitySession,
  setActiveExactCommunityDefinition,
} from "@app/core/community-state"
import MessageActions from "./message-actions.svelte"

export function mountMessageActionsFixture(
  props: Omit<ComponentProps<typeof MessageActions>, "community">,
) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  const previousSession = get(activeExactCommunitySession)
  // UI-only synthetic community: insert locally, never sign or send it to a relay.
  const definition = parseCommunityDefinition({
    ...props.ownMessage,
    id: "a".repeat(64),
    sig: "0".repeat(128),
    ...buildCommunityDefinition({
      communityId: "3".repeat(64),
      name: "Message action fixture",
      relays: props.relays,
      sections: [
        {
          name: "General",
          kinds: [{kind: 9, subtype: "room-message"}, {kind: 1111}],
          profileLists: [],
          badges: [],
        },
      ],
    }),
  })
  if (!definition) throw new Error("Invalid message action fixture community")
  setActiveExactCommunityDefinition(definition)
  const target = document.createElement("div")
  document.body.appendChild(target)
  const component = mount(MessageActions, {
    target,
    props: {...props, community: definition.pointer},
  })
  return async () => {
    await unmount(component)
    target.remove()
    activeExactCommunitySession.set(previousSession)
  }
}
