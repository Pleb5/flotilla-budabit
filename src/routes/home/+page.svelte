<script lang="ts">
  import {goto} from "$app/navigation"
  import {load} from "@welshman/net"
  import {PROFILE} from "@welshman/util"
  import * as nip19 from "nostr-tools/nip19"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import {APP_NAME} from "@app/core/state"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {normalizeRelays, parseCommunityInput} from "@app/core/community"
  import {
    activeCommunityDefinition,
    activeCommunityProfile,
    activeCommunitySession,
    getCommunityBootstrapRelays,
    makeCommunityDefinitionFilter,
    makeCommunityProfileFilter,
    parseCommunityProfile,
    selectLatestCommunityDefinition,
    setActiveCommunityInput,
    type CommunityProfile,
  } from "@app/core/community-state"
  import {makeCommunityPath} from "@app/util/routes"

  let communityInput = $state("")
  let loadedPreviewPubkey = $state("")
  let loadedPreviewProfile = $state<CommunityProfile | undefined>()
  let previewLoading = $state(false)
  let previewRequestId = 0
  let previewRequestKey = ""

  const createCommunity = () => goto("/home/create-community")

  const selectCommunity = () => {
    const session = setActiveCommunityInput(communityInput)

    if (!session) {
      pushToast({
        theme: "error",
        message: "Enter a valid community npub, hex pubkey, or ncommunity.",
      })
      return
    }

    communityInput = ""
    goto(makeCommunityPath(session.communityPubkey))
  }

  const openPreviewCommunity = () => {
    const parsed = parseCommunityInput(communityInput)
    const pubkey = parsed?.pubkey || (communityInput.trim() ? "" : $activeCommunitySession?.communityPubkey)

    if (!pubkey) return

    if (parsed) setActiveCommunityInput(communityInput)
    goto(makeCommunityPath(pubkey))
  }

  const formatNpub = (pubkey?: string, shorten = false) => {
    if (!pubkey) return "No community selected"

    try {
      const npub = nip19.npubEncode(pubkey)

      return shorten ? `${npub.slice(0, 12)}...${npub.slice(-8)}` : npub
    } catch {
      return `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}`
    }
  }

  const hasCommunityInput = $derived(Boolean(communityInput.trim()))
  const previewInput = $derived(parseCommunityInput(communityInput))
  const previewPubkey = $derived(
    hasCommunityInput ? previewInput?.pubkey || "" : $activeCommunitySession?.communityPubkey || "",
  )
  const previewProfile = $derived(
    loadedPreviewPubkey === previewPubkey && loadedPreviewProfile
      ? loadedPreviewProfile
      : !hasCommunityInput || previewInput?.pubkey === $activeCommunitySession?.communityPubkey
        ? $activeCommunityProfile
        : undefined,
  )
  const previewLabel = $derived(hasCommunityInput ? "Preview community" : "Selected community")
  const previewName = $derived(
    previewProfile?.display_name || previewProfile?.name || (previewPubkey ? formatNpub(previewPubkey, true) : "No community selected"),
  )
  const previewInfo = $derived(
    previewPubkey
      ? previewProfile?.about || formatNpub(previewPubkey, true)
      : hasCommunityInput
        ? "Enter a valid npub, hex pubkey, or ncommunity."
        : "Paste a community to preview it.",
  )
  const previewPicture = $derived(previewProfile?.picture || "")

  const setLoadedPreviewProfile = (requestId: number, pubkey: string, events: Awaited<ReturnType<typeof load>>) => {
    if (requestId !== previewRequestId || loadedPreviewPubkey !== pubkey) return false

    const profileEvent = events
      .filter(event => event.kind === PROFILE && event.pubkey === pubkey)
      .sort((a, b) => b.created_at - a.created_at)[0]

    if (!profileEvent) return false

    loadedPreviewProfile = parseCommunityProfile(profileEvent)
    previewLoading = false

    return true
  }

  $effect(() => {
    const parsed = previewInput
    const pubkey = previewPubkey

    if (!pubkey) {
      loadedPreviewPubkey = ""
      loadedPreviewProfile = undefined
      previewLoading = false
      return
    }

    const relayHints = parsed?.relays || $activeCommunitySession?.communityRelayHints || []
    const activeDefinitionRelays =
      !parsed || parsed.pubkey === $activeCommunitySession?.communityPubkey
        ? $activeCommunityDefinition?.relays || []
        : []
    const requestKey = [pubkey, ...relayHints, ...activeDefinitionRelays].join("|")

    if (previewRequestKey === requestKey) return
    previewRequestKey = requestKey

    const requestId = ++previewRequestId
    const discoveryRelays = getCommunityBootstrapRelays([...relayHints, ...activeDefinitionRelays])

    loadedPreviewPubkey = pubkey
    loadedPreviewProfile = undefined
    previewLoading = true

    load({relays: discoveryRelays, filters: [makeCommunityProfileFilter(pubkey)]})
      .then(events => setLoadedPreviewProfile(requestId, pubkey, events))
      .catch(() => {})

    load({relays: discoveryRelays, filters: [makeCommunityDefinitionFilter(pubkey)]})
      .then(definitionEvents => {
        const definition = selectLatestCommunityDefinition(definitionEvents, pubkey)
        const profileRelays = normalizeRelays([
          ...(definition?.relays || []),
          ...activeDefinitionRelays,
          ...discoveryRelays,
        ])

        return load({relays: profileRelays, filters: [makeCommunityProfileFilter(pubkey)]})
      })
      .then(events => {
        if (requestId !== previewRequestId || loadedPreviewPubkey !== pubkey) return
        setLoadedPreviewProfile(requestId, pubkey, events)
        previewLoading = false
      })
      .catch(() => {
        if (requestId === previewRequestId && loadedPreviewPubkey === pubkey) {
          loadedPreviewProfile = undefined
          previewLoading = false
        }
      })
  })
</script>

<div class="hero min-h-screen overflow-auto pb-8">
  <div class="hero-content">
    <div class="column content gap-4">
      <h1 class="text-center text-5xl">Welcome to</h1>
      <h1 class="mb-4 text-center text-5xl font-bold uppercase">{$APP_NAME}</h1>
      <div class="col-3">
        <button
          type="button"
          class="card2 bg-alt group flex w-full items-center gap-4 p-4 text-left shadow-md transition-colors hover:bg-base-300 disabled:cursor-not-allowed disabled:opacity-60"
          disabled={!previewPubkey}
          onclick={openPreviewCommunity}>
          <div
            class="center !flex h-16 w-16 shrink-0 overflow-hidden rounded-full border border-solid border-base-300 bg-base-300">
            {#if previewPicture}
              <img alt="" src={previewPicture} class="h-full w-full object-cover" />
            {:else}
              <Icon icon={Ghost} size={7} />
            {/if}
          </div>
          <div class="min-w-0 flex-1">
            <p class="text-xs font-semibold uppercase tracking-wide opacity-60">{previewLabel}</p>
            <h2 class="ellipsize text-xl font-bold">{previewName}</h2>
            <p class="ellipsize text-sm opacity-70">{previewLoading ? "Loading metadata..." : previewInfo}</p>
          </div>
          <div class="hidden text-3xl opacity-50 transition-transform group-hover:translate-x-1 sm:block">&gt;</div>
        </button>
        <form class="card2 bg-alt col-4 p-4 shadow-md" onsubmit={preventDefault(selectCommunity)}>
          <Field>
            {#snippet label()}
              <p>Community npub, hex, or ncommunity</p>
            {/snippet}
            {#snippet input()}
              <label class="input input-bordered flex w-full items-center gap-2">
                <Icon icon={HomeSmile} />
                <input
                  bind:value={communityInput}
                  class="grow"
                  type="text"
                  placeholder="npub1... or ncommunity://..." />
              </label>
            {/snippet}
            {#snippet info()}
              This selects the community identity and opens its BudaBit workspace.
            {/snippet}
          </Field>
          <div class="flex justify-end">
            <Button type="submit" class="btn btn-primary" disabled={!communityInput.trim()}>
              Save community
            </Button>
          </div>
        </form>
        <Button onclick={createCommunity}>
          <CardButton class="btn-neutral">
            {#snippet icon()}
              <Icon icon={AddCircle} size={7} />
            {/snippet}
            {#snippet title()}
              <div>Create BudaBit Community</div>
            {/snippet}
            {#snippet info()}
              <div>Publish the community definition, writer lists, and initial admin badges.</div>
            {/snippet}
          </CardButton>
        </Button>
      </div>
    </div>
  </div>
</div>
