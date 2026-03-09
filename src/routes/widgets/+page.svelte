<script lang="ts">
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import {onMount, onDestroy} from "svelte"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import {get} from "svelte/store"
  import {extensionSettings, getWidgetsForLocation} from "@app/extensions/settings"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import Page from "@lib/components/Page.svelte"

  let iframeRef: HTMLIFrameElement | undefined = $state()

  // Get widget ID from URL query param
  const widgetId = $derived($page.url.searchParams.get("id"))

  // Derive widgets from settings reactively
  const widgets = $derived.by(() => {
    // Subscribe to extensionSettings changes
    const _ = $extensionSettings
    return getWidgetsForLocation("menu-route")
  })

  // Derive selected widget from widgets and URL param
  const selectedWidget = $derived.by(() => {
    if (widgetId) {
      return widgets.find(w => w.identifier === widgetId) || widgets[0] || null
    }
    return widgets[0] || null
  })

  const sendContext = () => {
    if (!iframeRef?.contentWindow || !selectedWidget?.appUrl) return

    const userPubkey = get(pubkey)
    const profiles = get(profilesByPubkey)
    const profile = userPubkey ? profiles.get(userPubkey) : undefined

    const context = {
      pubkey: userPubkey || "",
      display_name: profile?.display_name || profile?.name || "",
      name: profile?.name || "",
      picture: profile?.picture || "",
      nip05: profile?.nip05 || "",
      lud16: profile?.lud16 || "",
      lud06: profile?.lud06 || "",
      website: profile?.website || "",
    }

    iframeRef.contentWindow.postMessage(
      {kind: "user-metadata", data: context},
      new URL(selectedWidget.appUrl).origin
    )
  }

  const handleMessage = (event: MessageEvent) => {
    if (!selectedWidget?.appUrl) return
    try {
      const widgetOrigin = new URL(selectedWidget.appUrl).origin
      if (event.origin !== widgetOrigin) return
      const {kind} = event.data || {}
      if (kind === "app-loaded") {
        sendContext()
      }
    } catch {
      // Ignore invalid messages
    }
  }

  onMount(() => {
    window.addEventListener("message", handleMessage)
  })

  onDestroy(() => {
    window.removeEventListener("message", handleMessage)
  })

  const onIframeLoad = () => {
    setTimeout(sendContext, 100)
  }

  const selectWidget = (widget: SmartWidgetEvent) => {
    goto(`/widgets?id=${widget.identifier}`, {replaceState: true})
  }
</script>

<Page class="flex flex-col !overflow-hidden">
  {#if widgets.length === 0}
    <div class="flex flex-1 items-center justify-center">
      <div class="text-center">
        <p class="text-lg opacity-70">No widgets configured for menu display</p>
        <p class="mt-2 text-sm opacity-50">
          Go to Settings → Extensions to configure widget display locations
        </p>
      </div>
    </div>
  {:else if widgets.length === 1 && selectedWidget}
    <!-- Single widget - full screen -->
    <div class="flex-1">
      <iframe
        bind:this={iframeRef}
        src={selectedWidget.appUrl}
        title={selectedWidget.content || selectedWidget.identifier}
        class="h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onload={onIframeLoad}
      ></iframe>
    </div>
  {:else}
    <!-- Multiple widgets - tabs -->
    <div class="flex border-b border-base-300">
      {#each widgets as widget (widget.identifier)}
        <button
          class="flex items-center gap-2 px-4 py-3 text-sm transition-colors"
          class:bg-base-200={selectedWidget?.identifier === widget.identifier}
          class:border-b-2={selectedWidget?.identifier === widget.identifier}
          class:border-primary={selectedWidget?.identifier === widget.identifier}
          onclick={() => selectWidget(widget)}>
          {#if widget.iconUrl || widget.imageUrl}
            <img
              src={widget.iconUrl || widget.imageUrl}
              alt="icon"
              class="h-5 w-5 rounded object-cover" />
          {/if}
          <span>{widget.content || widget.identifier}</span>
        </button>
      {/each}
    </div>
    {#if selectedWidget?.appUrl}
      <div class="flex-1">
        <iframe
          bind:this={iframeRef}
          src={selectedWidget.appUrl}
          title={selectedWidget.content || selectedWidget.identifier}
          class="h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          onload={onIframeLoad}
        ></iframe>
      </div>
    {:else}
      <div class="flex flex-1 items-center justify-center">
        <p class="opacity-70">Select a widget</p>
      </div>
    {/if}
  {/if}
</Page>
