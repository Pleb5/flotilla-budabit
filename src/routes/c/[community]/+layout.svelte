<script lang="ts">
  import {onDestroy, type Snippet} from "svelte"
  import {page} from "$app/stores"
  import {ago, MONTH} from "@welshman/lib"
  import {pubkey, repository} from "@welshman/app"
  import {request} from "@welshman/net"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {displayRelayUrl, MESSAGE} from "@welshman/util"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import CommunityMenu from "@app/components/CommunityMenu.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import {pushToast} from "@app/util/toast"
  import {pushDrawer} from "@app/util/modal"
  import {deriveRelayAuthError} from "@app/core/state"
  import {parseCommunityRouteParam} from "@app/util/routes"
  import {
    activeCommunityAdmissionForms,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityModeratorRequestReactionEvents,
    activeCommunityModeratorRequests,
    activeCommunityRelays,
    activeCommunityReportEvents,
    ensureCommunityBootstrap,
    getCommunityBootstrapKey,
    makeCommunitySession,
    setActiveCommunityInput,
  } from "@app/core/community-state"
  import {FORM_RESPONSE_KIND} from "@app/core/community"
  import {makeCommunityTargetingFilter} from "@app/core/community-feeds"
  import {
    buildCommunityLiveFilters,
    getCommunityLiveSubscriptionKey,
    normalizeCommunityLiveValues,
  } from "@app/core/community-live"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const hasInlineCommunityMenu = $derived(
    [
      "/c/[community]",
      "/c/[community]/access",
      "/c/[community]/admin",
      "/c/[community]/badges",
      "/c/[community]/calendar",
      "/c/[community]/calendar/create",
      "/c/[community]/calendar/[event]",
      "/c/[community]/git",
      "/c/[community]/goals",
      "/c/[community]/goals/create",
      "/c/[community]/goals/[goal]",
      "/c/[community]/moderation",
      "/c/[community]/permalinks",
      "/c/[community]/rooms",
      "/c/[community]/rooms/[room]",
      "/c/[community]/threads",
      "/c/[community]/threads/create",
      "/c/[community]/threads/[thread]",
      "/c/[community]/widgets",
    ].includes($page.route.id || ""),
  )
  const pageClass = $derived(
    !$pubkey
      ? "cw-full"
      : parsedCommunity
        ? hasInlineCommunityMenu
          ? "community-with-menu"
          : "community-with-menu community-with-floating-menu"
        : "",
  )

  let authRelayUrl = $state("")
  let relayAuthError = $state("")
  let shownAuthErrorKey = $state("")
  let communityLiveKey = ""
  let communityLiveController: AbortController | null = null
  let communityHistoryLoadKey = ""
  let communityHistoryLoadController: AbortController | null = null
  const COMMUNITY_HISTORY_LOAD_TIMEOUT_MS = 5_000

  const communityTargetingFilters = $derived(
    $activeCommunityDefinition
      ? [makeCommunityTargetingFilter($activeCommunityDefinition.pubkey)]
      : [],
  )
  const communityTargetingEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: communityTargetingFilters})),
  )
  const admissionFormAddresses = $derived(
    normalizeCommunityLiveValues(Object.values($activeCommunityAdmissionForms).map(form => form.address)),
  )
  const admissionResponseFilters = $derived(
    admissionFormAddresses.length
      ? [{kinds: [FORM_RESPONSE_KIND], "#a": admissionFormAddresses}]
      : [],
  )
  const admissionResponseEventsStore = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: admissionResponseFilters})),
  )
  const admissionResponseIds = $derived(
    normalizeCommunityLiveValues($admissionResponseEventsStore.map(event => event.id)),
  )

  const stopCommunityLiveSubscription = () => {
    communityLiveController?.abort()
    communityLiveController = null
    communityLiveKey = ""
  }

  const stopCommunityHistoryLoad = () => {
    communityHistoryLoadController?.abort()
    communityHistoryLoadController = null
    communityHistoryLoadKey = ""
  }

  const openCommunityMenu = () => {
    if (parsedCommunity) pushDrawer(CommunityMenu, {community: parsedCommunity.pubkey}, {replaceState: true})
  }

  $effect(() => {
    const routeCommunity = $page.params.community || ""
    const currentPubkey = $pubkey || ""

    const load = async () => {
      if (!parsedCommunity) {
        activeCommunityBootstrapStatus.set({key: "", loading: false, loaded: false})
        return
      }

      const session = setActiveCommunityInput(decodeURIComponent(routeCommunity)) || makeCommunitySession(parsedCommunity)
      const communityKey = getCommunityBootstrapKey(session, currentPubkey)

      try {
        await ensureCommunityBootstrap(session, {key: communityKey})
      } catch (error) {
        console.warn("[community] Failed to load community metadata", error)
      }
    }

    load()
  })

  $effect(() => {
    const url = $activeCommunityDefinition?.relays[0] || parsedCommunity?.relays[0] || ""

    authRelayUrl = url
    relayAuthError = ""

    if (!$pubkey || !url) return

    const authError = deriveRelayAuthError(url)
    const unsubscribe = authError.subscribe(error => {
      if (authRelayUrl !== url) return

      relayAuthError = error || ""

      if (!error) return


      const key = `${url}:${error}`

      if (shownAuthErrorKey === key) return
      shownAuthErrorKey = key
      pushToast({theme: "error", message: `Access issue on ${displayRelayUrl(url)}: ${error}`})
    })

    return unsubscribe
  })

  $effect(() => {
    const definition = $activeCommunityDefinition
    const relays = normalizeCommunityLiveValues($activeCommunityRelays)

    if (!definition || relays.length === 0) {
      stopCommunityHistoryLoad()
      return
    }

    const key = `${definition.pubkey}::${relays.join("|")}`
    if (communityHistoryLoadKey === key) return

    communityHistoryLoadController?.abort()
    communityHistoryLoadKey = key
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), COMMUNITY_HISTORY_LOAD_TIMEOUT_MS)
    communityHistoryLoadController = controller

    request({
      relays,
      threshold: 0.5,
      autoClose: true,
      signal: controller.signal,
      filters: [{kinds: [MESSAGE], "#h": [definition.pubkey], since: ago(MONTH)}],
    })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn("[community-history] Failed to preload community message history", error)
        }
      })
      .finally(() => {
        clearTimeout(timeout)
        if (communityHistoryLoadController === controller) {
          communityHistoryLoadController = null
        }
      })
  })

  $effect(() => {
    const definition = $activeCommunityDefinition
    const relays = normalizeCommunityLiveValues($activeCommunityRelays)

    if (!definition || relays.length === 0) {
      stopCommunityLiveSubscription()
      return
    }

    const filters = buildCommunityLiveFilters({
      definition,
      targetingEvents: $communityTargetingEventsStore,
      admissionFormAddresses,
      admissionResponseIds,
      reportEvents: $activeCommunityReportEvents,
      moderatorRequests: $activeCommunityModeratorRequests,
      moderatorRequestReactionEvents: $activeCommunityModeratorRequestReactionEvents,
    })

    if (filters.length === 0) {
      stopCommunityLiveSubscription()
      return
    }

    const key = getCommunityLiveSubscriptionKey({
      communityPubkey: definition.pubkey,
      relays,
      filters,
    })
    if (communityLiveKey === key) return

    communityLiveController?.abort()
    communityLiveKey = key
    const controller = new AbortController()
    communityLiveController = controller

    request({relays, filters, signal: controller.signal}).catch(error => {
      if (!controller.signal.aborted) {
        console.warn("[community-live] Failed to subscribe to community activity", error)
      }
    })
  })

  onDestroy(() => {
    stopCommunityHistoryLoad()
    stopCommunityLiveSubscription()
  })
</script>

{#if parsedCommunity && $pubkey}
  <SecondaryNav>
    <CommunityMenu community={parsedCommunity.pubkey} />
  </SecondaryNav>
  {#if !hasInlineCommunityMenu}
    <button
      type="button"
      class="btn btn-neutral btn-sm fixed right-[calc(var(--sair)+0.75rem)] top-[calc(var(--sait)+0.75rem)] z-nav lg:hidden"
      aria-label="Open community menu"
      onclick={openCommunityMenu}>
      <Icon icon={MenuDots} />
    </button>
  {/if}
{/if}

<Page class={pageClass}>
  {#if !parsedCommunity}
    <div class="content p-4">
      <h1 class="text-2xl font-bold">Invalid community</h1>
      <p>Use a valid community npub, hex pubkey, or encoded ncommunity value.</p>
    </div>
  {:else}
    {#if relayAuthError && authRelayUrl}
      <div class="card2 m-2 border border-error/30 bg-error/10 p-4 text-sm">
        <strong>Community relay access issue</strong>
        <p class="mt-1 opacity-80">
          {displayRelayUrl(authRelayUrl)} reported: {relayAuthError}
        </p>
      </div>
    {/if}
    {@render children?.()}
  {/if}
</Page>

<style>
  @media (max-width: 1023.98px) {
    :global(.community-with-floating-menu [data-component="PageBar"]) {
      padding-right: calc(var(--sair) + 4rem);
    }
  }
</style>
