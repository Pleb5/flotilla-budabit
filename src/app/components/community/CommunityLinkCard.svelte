<script lang="ts">
  import {goto} from "$app/navigation"
  import {repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {
    COMMUNITY_DISCOVERY_RELAYS,
    hydratePubkeyOutboxRelays,
    loadCommunityEvents,
    makeExactCommunityDefinitionFilter,
    resolveExactCommunityDefinition,
    selectExactCommunityDefinition,
  } from "@app/core/community-state"
  import type {CommunityDefinition, CommunityPointer} from "@app/core/community"
  import {makeExactCommunityPath} from "@app/util/routes"
  import CommunityShareButton from "@app/components/community/CommunityShareButton.svelte"

  type Props = {
    value: CommunityPointer
    compact?: boolean
    initialDefinition?: CommunityDefinition
  }

  const {value, compact = false, initialDefinition}: Props = $props()

  const fallbackName = $derived(`${value.address.slice(0, 18)}...${value.address.slice(-8)}`)

  let definition = $state<CommunityDefinition | undefined>(initialDefinition)
  let loadingDefinition = $state(false)

  $effect(() => {
    if (initialDefinition) {
      definition = initialDefinition
      return
    }

    const events = deriveEventsAsc(
      deriveEventsById({
        repository,
        filters: [
          makeExactCommunityDefinitionFilter(value),
          {kinds: [5], authors: [value.ownerPubkey]},
        ],
      }),
    )

    return events.subscribe(items => {
      definition = selectExactCommunityDefinition(items, value)
    })
  })

  $effect(() => {
    if (initialDefinition) return

    let cancelled = false
    loadingDefinition = true

    resolveExactCommunityDefinition(value, {
      discoveryRelays: COMMUNITY_DISCOVERY_RELAYS,
      hydrateOwnerOutbox: hydratePubkeyOutboxRelays,
      loadEvents: (relays, filters) => loadCommunityEvents(relays, filters, {timeout: 3000}),
    })
      .then(result => {
        if (!cancelled && result) definition = result
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) loadingDefinition = false
      })

    return () => {
      cancelled = true
    }
  })

  const name = $derived(definition?.metadata.name || fallbackName)
  const description = $derived(definition?.metadata.description || "Shared Budabit community")
  let failedPicture = $state("")

  const picture = $derived(String(definition?.metadata.picture || "").trim())
  const showPicture = $derived(Boolean(picture && failedPicture !== picture))
  const href = $derived(makeExactCommunityPath(value))

  const openCommunity = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return

    event.preventDefault()
    event.stopPropagation()
    goto(href)
  }
</script>

<div class="my-2 block w-full max-w-xl text-left">
  <div
    class="overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-sm transition-colors hover:border-primary/40">
    <div class="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
      <a
        {href}
        class="flex min-w-0 flex-1 items-center gap-3 no-underline"
        onclick={openCommunity}
        data-stop-tap>
        <div
          class="center !flex h-14 w-14 shrink-0 overflow-hidden rounded-2xl border border-base-300 bg-base-200 sm:h-16 sm:w-16">
          {#if showPicture}
            <img
              alt=""
              src={picture}
              class="h-full w-full object-cover"
              onerror={() => (failedPicture = picture)} />
          {:else}
            <Icon icon={HomeSmile} size={compact ? 6 : 7} />
          {/if}
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-2">
            <p class="truncate text-xs font-semibold uppercase tracking-wide opacity-60">
              Community
            </p>
            {#if loadingDefinition && !definition}
              <span class="loading loading-spinner loading-xs opacity-50"></span>
            {/if}
          </div>
          <h3 class="truncate text-base font-bold sm:text-lg">{name}</h3>
          {#if description}
            <p class="line-clamp-2 text-sm opacity-70">{description}</p>
          {/if}
        </div>
      </a>
      <div class="flex shrink-0 gap-2 self-end sm:self-center">
        <CommunityShareButton
          {value}
          definitionRelays={definition?.relays || []}
          class="btn btn-square btn-sm" />
        <a
          {href}
          class="btn btn-primary btn-sm !border-primary !bg-primary !text-primary-content !no-underline hover:!border-primary/80 hover:!bg-primary/80 hover:!text-primary-content hover:!no-underline"
          onclick={openCommunity}
          data-stop-tap>
          Open
        </a>
      </div>
    </div>
  </div>
</div>
