<script lang="ts">
  import {pubkey, signer} from "@welshman/app"
  import {onDestroy} from "svelte"
  import {get} from "svelte/store"
  import {
    PrivateCommunityAccess,
    privateAccessHeading,
    type PrivateAccessView,
  } from "@app/core/private-community-access"
  import type {PrivateCommunityScope} from "@app/core/private-community-scope"
  import {clearActiveExactCommunity} from "@app/core/community-state"
  import {pushModal} from "@app/util/modal"
  import LogIn from "@app/components/LogIn.svelte"

  const {scope}: {scope: PrivateCommunityScope} = $props()
  let access = $state<PrivateAccessView>({access: "consent", relays: {}, events: []})
  let controller: PrivateCommunityAccess | undefined
  let unsubscribe: (() => void) | undefined
  // A private route never supplies its definition to global community stores.
  clearActiveExactCommunity()
  $effect(() => {
    const identity = $pubkey
    const availableSigner = $signer
    controller?.dispose()
    unsubscribe?.()
    access = {access: "consent", relays: {}, events: []}
    controller =
      identity && availableSigner ? new PrivateCommunityAccess(scope, identity) : undefined
    unsubscribe = controller?.view.subscribe(value => {
      access = value
    })
    return () => {
      controller?.dispose()
      unsubscribe?.()
    }
  })
  onDestroy(() => {
    controller?.dispose()
    unsubscribe?.()
  })
  const heading = $derived(privateAccessHeading($pubkey, Boolean($signer), access.access))
  const busy = $derived(["signing", "awaiting-ack", "checking"].includes(access.access))
  const content = $derived(
    access.events.filter(event => ![5, 1984, 30000, 32222].includes(event.kind)),
  )
  const authenticate = () => {
    if (get(pubkey) && controller) void controller.start()
  }
</script>

<svelte:head
  ><title>Private community · Budabit</title><meta
    name="referrer"
    content="no-referrer" /></svelte:head>

<main
  class="mx-auto w-full max-w-3xl space-y-5 p-6"
  data-testid="private-community-access"
  data-access={access.access}>
  <header class="space-y-2">
    <p class="text-sm opacity-70">Invitation-only relay access</p>
    <h1 class="text-2xl font-semibold">{heading}</h1>
    <p>
      Only the relays below will receive this invitation's requests. Authentication reveals your
      public key to them; it does not grant membership or trust unsigned events.
    </p>
  </header>
  <ul class="space-y-1 break-all" aria-label="Invitation relays">
    {#each scope.relays as relay}<li>
        <code>{relay}</code>{#if access.relays[relay]}
          — {access.relays[relay]}{/if}
      </li>{/each}
  </ul>
  {#if scope.error}<p role="alert">{scope.error}</p>
  {:else if !$pubkey || !$signer}
    <button class="rounded border px-4 py-2" onclick={() => pushModal(LogIn)}
      >{!$pubkey ? "Sign in" : "Connect signer"}</button>
  {:else}
    {#if access.access === "denied"}<p role="status">
        Your key authenticated, but it is not currently eligible to read. Ask an owner or moderator
        for a role, then retry. You do not need to sign again while this connection remains
        authenticated.
      </p>{/if}
    {#if access.access === "unavailable"}<p role="status">
        Authentication or the relay's read policy could not be confirmed. This is not evidence of an
        empty community. Retry when the relay or signer is available.
      </p>{/if}
    {#if access.access === "revoked"}<p role="alert">
        The authenticated connection was lost. Private content has been cleared. Reconnect to check
        whether you still have access.
      </p>{/if}
    {#if access.access === "partial"}<p role="status">
        Some relay results are unavailable, the history limit was reached, or the definition is
        missing. Authority and history are not complete. No empty-community conclusion can be drawn.
      </p>{/if}
    {#if access.access === "signing"}<p role="status">
        Approve the NIP-42 request in your signer. Signing can take up to 90 seconds.
      </p>{/if}
    <div class="flex flex-wrap gap-3">
      {#if !busy}<button class="rounded border px-4 py-2" onclick={authenticate}
          >{access.access === "consent" ? "Authenticate and check access" : "Retry access"}</button
        >{/if}
      <button class="rounded border px-4 py-2" onclick={() => controller?.cancel()}>Cancel</button>
      {#if !busy}<button class="rounded border px-4 py-2" onclick={() => pushModal(LogIn)}
          >Switch account</button
        >{/if}
    </div>
  {/if}
  {#if ["ready", "partial"].includes(access.access) && access.definition}
    <section class="space-y-4" aria-label="Private community history">
      <h2 class="text-xl font-semibold">{access.definition.metadata.name}</h2>
      <p class="whitespace-pre-wrap">{access.definition.metadata.description || ""}</p>
      <p class="text-sm opacity-70">
        Private history is memory-only. External media, widgets, Git hosting, Blossom uploads and
        zaps are not loaded here. Read access is not encryption and cannot prevent copying.
      </p>
      {#each content as event (event.id)}
        <article class="space-y-2 rounded border p-4">
          <p class="break-all text-xs opacity-70">{event.pubkey} · kind {event.kind}</p>
          <p class="whitespace-pre-wrap break-words">{event.content}</p>
        </article>
      {/each}
      {#if !content.length && access.access === "ready"}<p>
          No retained posts were returned by these relays.
        </p>{/if}
    </section>
  {/if}
</main>
