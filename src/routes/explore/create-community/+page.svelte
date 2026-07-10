<script lang="ts">
  import {onMount, tick} from "svelte"
  import {goto} from "$app/navigation"
  import {pubkey, userRelayList} from "@welshman/app"
  import {getRelaysFromList} from "@welshman/util"
  import Page from "@lib/components/Page.svelte"
  import Button from "@lib/components/Button.svelte"
  import CommunityCreate from "@app/components/CommunityCreate.svelte"
  import {
    communityAdminDefinitionEvents,
    getCommunityDefinitionRelayHints,
    loadCommunityDefinitionWithOutboxFallback,
    selectLatestCommunityDefinition,
    setActiveCommunityDefinition,
  } from "@app/core/community-state"
  import {
    makeCommunityNcommunity,
    normalizeRelays,
    type CommunityDefinition,
  } from "@app/core/community"
  import {makeCommunityPath} from "@app/util/routes"

  const EXISTING_COMMUNITY_LOOKUP_TIMEOUT_MS = 2_000

  let existingCommunityCheckReady = $state(false)
  let existingCommunityDefinition = $state<CommunityDefinition | undefined>()
  let existingCommunityUser = ""
  let existingCommunityCheckKey = ""
  let existingCommunityRequestId = 0

  const waitForPostPaintHydration = async () => {
    await tick()
    if (typeof requestAnimationFrame !== "function") return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }

  const userRelayHints = $derived.by(() => normalizeRelays(getRelaysFromList($userRelayList)))
  const cachedExistingCommunityDefinition = $derived.by(() =>
    $pubkey ? selectLatestCommunityDefinition($communityAdminDefinitionEvents, $pubkey) : undefined,
  )
  const existingCommunityRelayHints = $derived.by(() =>
    existingCommunityDefinition
      ? getCommunityDefinitionRelayHints(existingCommunityDefinition, userRelayHints)
      : [],
  )

  const editExistingCommunity = () => {
    const definition = existingCommunityDefinition
    if (!definition) return

    const communityInput = makeCommunityNcommunity({
      pubkey: definition.pubkey,
      relayHints: existingCommunityRelayHints,
    })

    setActiveCommunityDefinition(definition)
    goto(makeCommunityPath(communityInput, "admin"))
  }

  onMount(() => {
    let cancelled = false

    void waitForPostPaintHydration().then(() => {
      if (!cancelled) existingCommunityCheckReady = true
    })

    return () => {
      cancelled = true
      existingCommunityCheckReady = false
      existingCommunityRequestId += 1
    }
  })

  $effect(() => {
    const user = $pubkey || ""

    if (existingCommunityUser === user) return

    existingCommunityUser = user
    existingCommunityDefinition = undefined
    existingCommunityCheckKey = ""
    existingCommunityRequestId += 1
  })

  $effect(() => {
    const user = $pubkey || ""
    const definition = cachedExistingCommunityDefinition

    if (!user || !definition) return

    existingCommunityDefinition = definition
    existingCommunityRequestId += 1
  })

  $effect(() => {
    const user = $pubkey || ""
    const relayHints = userRelayHints
    const key = user ? `${user}:${relayHints.join(",")}` : ""

    if (!existingCommunityCheckReady || !user || !key) return
    if (existingCommunityDefinition?.pubkey === user) return
    if (existingCommunityCheckKey === key) return

    existingCommunityCheckKey = key
    const requestId = ++existingCommunityRequestId

    loadCommunityDefinitionWithOutboxFallback(user, {
      relayHints,
      authenticate: true,
      timeout: EXISTING_COMMUNITY_LOOKUP_TIMEOUT_MS,
    })
      .then(definition => {
        if (requestId !== existingCommunityRequestId || existingCommunityUser !== user) return

        if (definition) {
          existingCommunityDefinition = definition
          return
        }
      })
      .catch(() => {})
  })
</script>

<Page class="cw-full bg-base-200">
  {#if existingCommunityDefinition}
    <div class="flex min-h-screen items-center justify-center p-6">
      <div class="card2 bg-alt flex w-full max-w-xl flex-col gap-4 p-6 text-center shadow-md">
        <div>
          <h1 class="text-2xl font-bold">This account already has a community</h1>
          <p class="mt-2 text-sm opacity-70">
            A signer can only own one community. Edit the existing community instead.
          </p>
        </div>
        <div class="flex flex-col justify-center gap-2 sm:flex-row">
          <Button onclick={editExistingCommunity} class="btn btn-primary">Edit community</Button>
          <Button onclick={() => goto("/explore")} class="btn btn-ghost">Back to explore</Button>
        </div>
      </div>
    </div>
  {:else}
    <CommunityCreate />
  {/if}
</Page>
