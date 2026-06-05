<script lang="ts">
  import {goto} from "$app/navigation"
  import {loadUserRelayList, pubkey, userRelayList} from "@welshman/app"
  import {getRelaysFromList} from "@welshman/util"
  import Page from "@lib/components/Page.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import CommunityCreate from "@app/components/CommunityCreate.svelte"
  import {
    communityAdminDefinitionEvents,
    communityPreferencesLoading,
    hydratePreferredCommunities,
    selectLatestCommunityDefinition,
    setActiveCommunityDefinition,
  } from "@app/core/community-state"
  import {makeCommunityNcommunity, normalizeRelays} from "@app/core/community"
  import {pushToast} from "@app/util/toast"
  import {makeCommunityPath} from "@app/util/routes"

  const EXISTING_COMMUNITY_HYDRATION_MAX_ATTEMPTS = 2

  let userRelayListHydrationKey = $state("")
  let userRelayListHydrationLoadingKey = $state("")
  let existingCommunityHydrationKey = $state("")
  let existingCommunityHydrationAttempts = $state(0)
  let existingCommunityRedirected = $state(false)

  const userRelayHints = $derived.by(() => normalizeRelays(getRelaysFromList($userRelayList)))
  const userRelayListKey = $derived($userRelayList?.event?.id || userRelayHints.join(","))
  const userRelayListHydrated = $derived(
    Boolean(
      $pubkey &&
        (userRelayListHydrationKey === $pubkey || $userRelayList?.event?.pubkey === $pubkey),
    ),
  )
  const existingCommunityDefinition = $derived.by(() =>
    $pubkey ? selectLatestCommunityDefinition($communityAdminDefinitionEvents, $pubkey) : undefined,
  )
  const checkingExistingCommunity = $derived(
    Boolean(
      $pubkey &&
        !existingCommunityDefinition &&
        (!userRelayListHydrated ||
          $communityPreferencesLoading ||
          existingCommunityHydrationAttempts < EXISTING_COMMUNITY_HYDRATION_MAX_ATTEMPTS),
    ),
  )

  $effect(() => {
    const user = $pubkey || ""

    if (!user) {
      userRelayListHydrationKey = ""
      userRelayListHydrationLoadingKey = ""
      existingCommunityHydrationKey = ""
      existingCommunityHydrationAttempts = 0
      existingCommunityRedirected = false
      return
    }

    if (userRelayListHydrationKey === user || userRelayListHydrationLoadingKey === user) return

    userRelayListHydrationLoadingKey = user
    loadUserRelayList([])
      .catch(() => {})
      .finally(() => {
        if (userRelayListHydrationLoadingKey !== user) return

        userRelayListHydrationKey = user
        userRelayListHydrationLoadingKey = ""
      })
  })

  $effect(() => {
    const relayHints = userRelayHints
    const key = $pubkey ? `${$pubkey}:${relayHints.join(",")}:${userRelayListKey}` : ""

    if (!$pubkey || !key || !userRelayListHydrated || existingCommunityDefinition) return

    if (existingCommunityHydrationKey !== key) {
      existingCommunityHydrationKey = key
      existingCommunityHydrationAttempts = 0
    }

    if ($communityPreferencesLoading) return
    if (existingCommunityHydrationAttempts >= EXISTING_COMMUNITY_HYDRATION_MAX_ATTEMPTS) return

    existingCommunityHydrationAttempts += 1
    hydratePreferredCommunities({
      relayHints,
      force: existingCommunityHydrationAttempts > 1,
    }).catch(() => {})
  })

  $effect(() => {
    const definition = existingCommunityDefinition
    if (!definition || existingCommunityRedirected) return

    existingCommunityRedirected = true
    setActiveCommunityDefinition(definition)
    pushToast({
      theme: "info",
      message: "This account already has a community. Edit it from the community menu.",
    })

    const communityInput = makeCommunityNcommunity({
      pubkey: definition.pubkey,
      relayHints: definition.relays,
    })
    goto(makeCommunityPath(communityInput, "admin"), {replaceState: true}).catch(() => {
      existingCommunityRedirected = false
    })
  })
</script>

<Page class="cw-full bg-base-200">
  {#if checkingExistingCommunity}
    <div class="flex min-h-screen items-center justify-center p-6 text-center">
      <Spinner loading>Checking for an existing community...</Spinner>
    </div>
  {:else if !existingCommunityDefinition}
    <CommunityCreate />
  {/if}
</Page>
