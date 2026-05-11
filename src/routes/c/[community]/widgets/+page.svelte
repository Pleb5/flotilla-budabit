<script lang="ts">
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, getTagValue} from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import Widget from "@assets/icons/widget.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {activeCommunityRelays} from "@app/core/community-state"
  import {TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {SMART_WIDGET_KIND, makeCommunityTargetingFilter, makeTargetedPublicationOriginalFilters} from "@app/core/community-feeds"
  import {
    makeAddressablePublicationRef,
    makeTargetedPublicationForCommunity,
    withPublicationTargetingId,
  } from "@app/core/community-targeting"
  import {parseCommunityRouteParam} from "@app/util/routes"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const targetingFilters = $derived(
    communityPubkey ? [makeCommunityTargetingFilter(communityPubkey, [SMART_WIDGET_KIND])] : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const widgetFilters = $derived(makeTargetedPublicationOriginalFilters($targetingEvents))
  const widgets = $derived(deriveEventsAsc(deriveEventsById({repository, filters: widgetFilters})))

  const createWidget = () => {
    if (!$pubkey || !communityPubkey || !name.trim() || !appUrl.trim()) return
    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const widgetId = slug.trim() || randomId()
    const targetingId = randomId()
    publishThunk({
      relays,
      event: makeEvent(
        SMART_WIDGET_KIND,
        withPublicationTargetingId(
          {
            content: description.trim(),
            tags: [
              ["d", widgetId],
              ["title", name.trim()],
              ["l", "basic"],
              ["button", "Open", "app", appUrl.trim()],
              ...(iconUrl.trim() ? [["icon", iconUrl.trim()]] : []),
            ],
          },
          targetingId,
        ),
      ),
    })
    publishThunk({
      relays,
      event: makeEvent(
        TARGETED_PUBLICATION_KIND,
        makeTargetedPublicationForCommunity({
          targetingId,
          originalKind: SMART_WIDGET_KIND,
          originalRef: makeAddressablePublicationRef({
            kind: SMART_WIDGET_KIND,
            pubkey: $pubkey,
            identifier: widgetId,
            relay: relays[0],
          }),
          communityPubkey,
          communityRelay: relays[0],
        }),
      ),
    })

    name = ""
    slug = ""
    appUrl = ""
    iconUrl = ""
    description = ""
    pushToast({message: "Widget published."})
  }

  let name = $state("")
  let slug = $state("")
  let appUrl = $state("")
  let iconUrl = $state("")
  let description = $state("")

  onMount(() => {
    if (!communityPubkey || $activeCommunityRelays.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: targetingFilters, signal: controller.signal})

    return () => controller.abort()
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0 || widgetFilters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters: widgetFilters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Widget} /></div>
  {/snippet}
  {#snippet title()}<strong>Widgets</strong>{/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createWidget)}>
    <strong>Create targeted widget</strong>
    <Field>{#snippet label()}<p>Name</p>{/snippet}{#snippet input()}<input bind:value={name} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>Identifier</p>{/snippet}{#snippet input()}<input bind:value={slug} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>App URL</p>{/snippet}{#snippet input()}<input bind:value={appUrl} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>Icon URL</p>{/snippet}{#snippet input()}<input bind:value={iconUrl} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>Description</p>{/snippet}{#snippet input()}<textarea bind:value={description} class="textarea textarea-bordered" rows="3"></textarea>{/snippet}</Field>
    <div class="flex justify-end">
      <Button type="submit" class="btn btn-primary" disabled={!$pubkey || !name.trim() || !appUrl.trim()}>
        Publish widget
      </Button>
    </div>
  </form>

  <div class="col-2">
    {#each $widgets as widget (widget.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <strong>{getTagValue("title", widget.tags) || getTagValue("d", widget.tags) || "Widget"}</strong>
        <p class="break-all text-xs opacity-60">{getTagValue("button", widget.tags) || ""}</p>
        {#if widget.content}<p class="whitespace-pre-wrap">{widget.content}</p>{/if}
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">No targeted widgets found.</p>
    {/each}
  </div>
</PageContent>
