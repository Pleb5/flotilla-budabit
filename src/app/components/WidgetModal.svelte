<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {pubkey, profilesByPubkey} from "@welshman/app"
  import {get} from "svelte/store"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import {clearModals} from "@app/util/modal"
  import Icon from "@lib/components/Icon.svelte"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"

  type Props = {
    widget: SmartWidgetEvent
  }

  const {widget}: Props = $props()

  let iframeRef: HTMLIFrameElement | undefined = $state()
  let loaded = $state(false)

  const sendContext = () => {
    if (!iframeRef?.contentWindow || !widget.appUrl) return

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

    // Send context to widget iframe using postMessage
    // Format per smart-widget-handler spec
    iframeRef.contentWindow.postMessage(
      {
        kind: "user-metadata",
        data: context,
      },
      new URL(widget.appUrl).origin
    )
  }

  const onIframeLoad = () => {
    loaded = true
    // Small delay to ensure iframe is ready to receive messages
    setTimeout(sendContext, 100)
  }

  // Listen for messages from the widget
  const handleMessage = (event: MessageEvent) => {
    if (!widget.appUrl) return

    try {
      const widgetOrigin = new URL(widget.appUrl).origin
      if (event.origin !== widgetOrigin) return

      const {kind, data} = event.data || {}

      if (kind === "app-loaded") {
        sendContext()
      }

      // Handle other message types as needed
      // sign-event, sign-publish, payment-request, custom-data, etc.
      console.log("[WidgetModal] Received message:", kind, data)
    } catch (e) {
      // Ignore invalid messages
    }
  }

  onMount(() => {
    window.addEventListener("message", handleMessage)
  })

  onDestroy(() => {
    window.removeEventListener("message", handleMessage)
  })
</script>

<div class="flex h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-base-100 shadow-xl">
  <!-- Header -->
  <div class="flex items-center justify-between border-b border-base-300 px-4 py-3">
    <div class="flex items-center gap-3">
      {#if widget.iconUrl || widget.imageUrl}
        <img
          src={widget.iconUrl || widget.imageUrl}
          alt="icon"
          class="h-8 w-8 rounded object-cover" />
      {/if}
      <div>
        <h2 class="font-semibold">{widget.content || widget.identifier}</h2>
        <p class="text-xs opacity-70">Smart Widget • {widget.widgetType}</p>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" onclick={() => clearModals()}>
      <Icon icon={CloseCircle} size={5} />
    </button>
  </div>

  <!-- Iframe container -->
  <div class="relative flex-1 overflow-hidden">
    {#if !loaded}
      <div class="absolute inset-0 flex items-center justify-center bg-base-200">
        <span class="loading loading-spinner loading-lg"></span>
      </div>
    {/if}
    {#if widget.appUrl}
      <iframe
        bind:this={iframeRef}
        src={widget.appUrl}
        title={widget.content || widget.identifier}
        class="absolute inset-0 h-full w-full border-0"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        onload={onIframeLoad}
      ></iframe>
    {:else}
      <div class="flex h-full items-center justify-center">
        <p class="opacity-70">This widget does not have an app URL.</p>
      </div>
    {/if}
  </div>
</div>
