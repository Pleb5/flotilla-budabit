<script lang="ts">
  import {pubkey, signer} from "@welshman/app"
  import {connectCommunityInvitation} from "@app/core/community-relay-access"
  import {makeExactCommunitySession, recoverCommunityBootstrap} from "@app/core/community-state"
  import type {PrivateCommunityScope} from "@app/core/private-community-scope"
  import {pushModal} from "@app/util/modal"
  import LogIn from "./LogIn.svelte"

  const {scope}: {scope: PrivateCommunityScope} = $props()
  let busy = $state(false)
  let results = $state<{relay: string; outcome: string}[]>([])
  let error = $state("")
  let controller: AbortController | undefined
  $effect(() => {
    void $pubkey
    void $signer
    results = []
    error = ""
    busy = false
    return () => controller?.abort()
  })
  const connect = async () => {
    controller?.abort()
    const attempt = new AbortController()
    controller = attempt
    busy = true
    error = ""
    try {
      const next = await connectCommunityInvitation(scope, attempt.signal)
      if (attempt.signal.aborted) return
      results = next
      if (next.some(result => result.outcome === "complete"))
        await recoverCommunityBootstrap(makeExactCommunitySession(scope.pointer))
    } catch (cause) {
      if (!attempt.signal.aborted) error = cause instanceof Error ? cause.message : String(cause)
    } finally {
      if (!attempt.signal.aborted) busy = false
    }
  }
</script>

<!-- Connection controls only. Cached content below is never gated or purged. -->
<section class="card2 m-2 space-y-2 p-4 text-sm" data-testid="community-relay-access">
  <h2 class="font-semibold">Member-only relay connection</h2>
  <p>Authenticate to fetch updates. Previously received data remains cached on this device.</p>
  {#if !$pubkey || !$signer}
    <button class="btn btn-primary btn-sm" onclick={() => pushModal(LogIn)}>
      {$pubkey ? "Connect signer" : "Sign in"}
    </button>
  {:else}
    <button
      class="btn btn-primary btn-sm"
      disabled={busy || Boolean(scope.error)}
      onclick={connect}>
      {busy ? "Waiting for signer and relay…" : "Authenticate and retry"}
    </button>
  {/if}
  {#if scope.error}<p role="alert">{scope.error}</p>{/if}
  {#each results as result (result.relay)}
    <p>
      {result.relay}:
      {result.outcome === "complete"
        ? "Connected"
        : result.outcome === "denied"
          ? "Access denied"
          : result.outcome === "policy-unavailable"
            ? "Read policy unavailable"
            : result.outcome}
    </p>
  {/each}
  {#if error}<p role="alert">{error}</p>{/if}
</section>
