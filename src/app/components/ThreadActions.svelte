<script lang="ts">
  import type {TrustedEvent, EventContent} from "@welshman/util"
  import {getTagValue} from "@welshman/util"
  import Link from "@lib/components/Link.svelte"
  import RoomName from "@app/components/RoomName.svelte"
  import ReactionSummary from "@app/components/ReactionSummary.svelte"
  import ThunkStatusOrDeleted from "@app/components/ThunkStatusOrDeleted.svelte"
  import EventActivity from "@app/components/EventActivity.svelte"
  import EventActions from "@app/components/EventActions.svelte"
  import {publishSocialDelete, publishReaction} from "@app/core/commands"
  import {makeThreadPath, makeSpacePath} from "@app/util/routes"

  interface Props {
    url: string
    event: TrustedEvent
    showRoom?: boolean
    showActivity?: boolean
    relays?: string[]
    scopeH?: string
    communitySectionName?: string
    readOnly?: boolean
    allowedAuthors?: string[]
    floatMobileMenu?: boolean
  }

  const {
    url,
    event,
    showRoom,
    showActivity,
    relays = [],
    scopeH = "",
    communitySectionName = "",
    readOnly = false,
    allowedAuthors = undefined,
    floatMobileMenu = false,
  }: Props = $props()

  const h = getTagValue("h", event.tags)
  const path = makeThreadPath(url, event.id)

  const deleteReaction = async (event: TrustedEvent) =>
    publishSocialDelete({url, event})

  const createReaction = async (template: EventContent) =>
    publishReaction({
      ...template,
      event,
      relays: relays.length ? relays : [url],
      tags: [...(template.tags || []), ...(scopeH ? [["h", scopeH]] : [])],
    })
</script>

{#if floatMobileMenu}
  <div class="z-10 absolute right-2 top-2 sm:hidden">
    <EventActions
      {url}
      {relays}
      {scopeH}
      {communitySectionName}
      {readOnly}
      {event}
      noun="Thread"
      allowAdminDelete={false}
      menuOnly
      class="border border-solid border-neutral bg-base-100/90 shadow-sm backdrop-blur" />
  </div>
{/if}

<div class="flex flex-grow flex-wrap justify-end gap-2">
  {#if h && showRoom}
    <Link href={makeSpacePath(url, h)} class="btn btn-neutral btn-xs rounded-full">
      Posted in #<RoomName {h} {url} />
    </Link>
  {/if}
  <ReactionSummary
    {url}
    {relays}
    {scopeH}
    {event}
    {readOnly}
    {allowedAuthors}
    {deleteReaction}
    {createReaction}
    reactionClass="tooltip-left" />
  <ThunkStatusOrDeleted {event} />
  {#if showActivity}
    <EventActivity {url} {path} {event} {relays} {scopeH} {allowedAuthors} />
  {/if}
  <EventActions
    {url}
    {relays}
    {scopeH}
    {communitySectionName}
    {readOnly}
    {event}
    noun="Thread"
    allowAdminDelete={false}
    class={floatMobileMenu ? "hidden sm:flex" : ""} />
</div>

{#if floatMobileMenu && !readOnly}
  <div class="mt-2 flex justify-end sm:hidden">
    <EventActions
      {url}
      {relays}
      {scopeH}
      {communitySectionName}
      {readOnly}
      {event}
      noun="Thread"
      allowAdminDelete={false}
      hideMenu
      class="border border-solid border-neutral bg-base-100/90 text-xs shadow-sm backdrop-blur" />
  </div>
{/if}
