<script lang="ts">
  import {pubkey} from "@welshman/app"
  import {onDestroy} from "svelte"
  import Link from "@lib/components/Link.svelte"
  import {normalizePubkey} from "@app/core/community"
  import {activeUserCommunityRefs} from "@app/core/community-state"
  import {
    communityExtensionPrompt,
    clearCommunityExtensionPromptLogin,
    dismissCommunityExtensionPrompt,
    ensureCommunityExtensionPromptLogin,
    isCommunityExtensionPromptDismissed,
  } from "@app/extensions/community-extension-prompt"
  import {loadCommunityCuratedWidgets} from "@app/extensions/community-curation"
  import {getTrustedCommunityWidgets} from "@app/extensions/community-widget-trust"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {logCommunityWidgetDebug} from "@app/extensions/community-widget-debug"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import {makeCommunityInputValue} from "@app/util/community-stars"

  type Props = {
    communityPubkey: string
    relayHints?: string[]
  }

  const {communityPubkey, relayHints = []}: Props = $props()

  let widgets = $state<SmartWidgetEvent[]>([])
  let trustedAuthorPubkeys = $state<string[]>([])
  let loadKey = ""
  let loadRequestId = 0
  let sawLoggedInUser = false

  const normalizedCommunityPubkey = $derived(normalizePubkey(communityPubkey))
  const isCommunityMember = $derived(
    $activeUserCommunityRefs.some(
      ref => normalizePubkey(ref.communityPubkey) === normalizedCommunityPubkey,
    ),
  )
  const trustedWidgets = $derived(getTrustedCommunityWidgets(widgets, trustedAuthorPubkeys))
  const installedWidgetIds = $derived(
    new Set(Object.keys($effectiveExtensionSettings.installed?.widget || {})),
  )
  const hasInstalledTrustedWidget = $derived(
    trustedWidgets.some(widget => installedWidgetIds.has(getWidgetLineId(widget))),
  )
  const dismissed = $derived(
    isCommunityExtensionPromptDismissed($pubkey || "", communityPubkey, $communityExtensionPrompt),
  )
  const showPrompt = $derived(
    Boolean(
      $pubkey &&
      isCommunityMember &&
      !dismissed &&
      trustedWidgets.length > 0 &&
      !hasInstalledTrustedWidget,
    ),
  )
  const settingsHref = $derived(
    `/settings/extensions?community=${encodeURIComponent(communityPubkey)}&focus=trusted#community-extensions`,
  )

  const dismiss = () => {
    if ($pubkey) dismissCommunityExtensionPrompt($pubkey, communityPubkey)
  }

  $effect(() => {
    if ($pubkey) {
      sawLoggedInUser = true
      ensureCommunityExtensionPromptLogin($pubkey)
    } else if (sawLoggedInUser) {
      sawLoggedInUser = false
      clearCommunityExtensionPromptLogin()
    }
  })

  $effect(() => {
    const input = makeCommunityInputValue({pubkey: communityPubkey, relayHints})
    const key = $pubkey && isCommunityMember && !dismissed && input ? input : ""

    if (!key) {
      widgets = []
      trustedAuthorPubkeys = []
      loadKey = ""
      loadRequestId += 1
      return
    }

    if (key === loadKey) return
    loadKey = key
    const requestId = ++loadRequestId

    loadCommunityCuratedWidgets(input)
      .then(result => {
        if (requestId !== loadRequestId || key !== loadKey) {
          logCommunityWidgetDebug("extensions prompt discarded stale curated widgets result", {
            communityPubkey,
            key,
            currentKey: loadKey,
            requestId,
            currentRequestId: loadRequestId,
            status: result.status,
            widgetCount: result.status === "community" ? result.widgets.length : 0,
          })
          return
        }

        widgets = result.status === "community" ? result.widgets : []
        trustedAuthorPubkeys =
          result.status === "community" ? result.trustedWidgetAuthorPubkeys : []
      })
      .catch(error => {
        if (requestId !== loadRequestId || key !== loadKey) return

        console.warn("[community-extensions-prompt] Failed to load widgets", error)
        widgets = []
        trustedAuthorPubkeys = []
        loadKey = ""
      })
  })

  onDestroy(() => {
    loadRequestId += 1
  })
</script>

{#if showPrompt}
  <section class="card2 border border-primary/40 bg-primary/10 p-3 shadow-md">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div class="min-w-0">
        <strong>Trusted community extensions are available</strong>
        <p class="text-sm opacity-75">
          This community has {trustedWidgets.length} extension{trustedWidgets.length === 1
            ? ""
            : "s"} from its owner or widget moderators. Install them only if you want to use them.
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap gap-2">
        <Link href={settingsHref} class="btn btn-primary btn-sm">See community extensions</Link>
        <button type="button" class="btn btn-ghost btn-sm" onclick={dismiss}>Dismiss</button>
      </div>
    </div>
  </section>
{/if}
