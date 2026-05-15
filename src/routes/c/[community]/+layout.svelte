<script lang="ts">
  import type {Snippet} from "svelte"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import {displayRelayUrl} from "@welshman/util"
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
    activeCommunityDefinition,
    loadCommunityBootstrap,
    makeCommunitySession,
    setActiveCommunityDefinition,
    setActiveCommunityInput,
  } from "@app/core/community-state"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const hasInlineCommunityMenu = $derived(
    [
      "/c/[community]/calendar",
      "/c/[community]/calendar/create",
      "/c/[community]/calendar/[event]",
      "/c/[community]/goals",
      "/c/[community]/goals/create",
      "/c/[community]/rooms/[room]",
      "/c/[community]/threads",
      "/c/[community]/threads/create",
      "/c/[community]/threads/[thread]",
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

  let loadedCommunityKey = $state("")
  let loadingCommunityKey = $state("")
  let authRelayUrl = $state("")
  let relayAuthError = $state("")
  let shownAuthErrorKey = $state("")

  const openCommunityMenu = () => {
    if (parsedCommunity) pushDrawer(CommunityMenu, {community: parsedCommunity.pubkey}, {replaceState: true})
  }

  $effect(() => {
    let cancelled = false
    const routeCommunity = $page.params.community || ""
    const communityKey = parsedCommunity
      ? `${parsedCommunity.pubkey}:${parsedCommunity.relays.join(",")}:${routeCommunity}`
      : ""

    const load = async () => {
      if (!parsedCommunity) {
        return
      }

      if (loadedCommunityKey === communityKey || loadingCommunityKey === communityKey) return

      try {
        loadingCommunityKey = communityKey
        const session = setActiveCommunityInput(decodeURIComponent(routeCommunity)) || makeCommunitySession(parsedCommunity)
        const bootstrap = await loadCommunityBootstrap(session)

        if (!cancelled && bootstrap.definition) {
          setActiveCommunityDefinition(bootstrap.definition)
        }
        if (!cancelled) loadedCommunityKey = communityKey
      } catch (error) {
        if (!cancelled) console.warn("[community] Failed to load community metadata", error)
      } finally {
        if (loadingCommunityKey === communityKey) loadingCommunityKey = ""
      }
    }

    load()

    return () => {
      cancelled = true
    }
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
