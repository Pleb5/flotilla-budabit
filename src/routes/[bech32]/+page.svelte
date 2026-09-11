<script lang="ts">
  import {untrack} from "svelte"
  import * as nip19 from "nostr-tools/nip19"
  import type {TrustedEvent} from "@welshman/util"
  import {repository} from "@welshman/app"
  import {makeLoader, LOCAL_RELAY_URL} from "@welshman/net"
  import {Router} from "@welshman/router"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import EventFallback from "@app/components/EventFallback.svelte"
  import {
    getDedicatedEventPath,
    goToEventPath,
    makeExactCommunityPath,
    makeProfilePath,
  } from "@app/util/routes"
  import {entityLink, parseEventReference} from "@app/util/nostr-links"
  import {clip} from "@app/util/toast"
  import {parseCommunityNaddr} from "@app/core/community"
  import {INDEXER_RELAYS} from "@app/core/state"
  import {getRepoAnnouncementRelays} from "@app/core/git-state"
  import {refreshPubkeyOutboxRelays} from "@app/core/community-state"
  import {getEventRelayHints, normalizeRelayHints} from "@app/util/event-links"

  const getAuthorRelays = (author?: string) => {
    if (!author) return []

    try {
      return Router.get().FromPubkey(author).getUrls() || []
    } catch {
      return []
    }
  }

  const loadReference = makeLoader({delay: 0, timeout: 8000, threshold: 1})
  const bech32 = $derived($page.params.bech32 || "")
  let retry = $state(0)
  let status = $state<"loading" | "ready" | "unavailable" | "invalid">("loading")
  let event = $state.raw<TrustedEvent>()
  let relays = $state<string[]>([])
  let queriedRelays = $state<string[]>([])

  $effect(() => {
    const reference = bech32
    void retry
    return untrack(() => {
      const controller = new AbortController()
      const referenceRelays = normalizeRelayHints(parseEventReference(reference)?.relays)
      let current: TrustedEvent | undefined
      let active = true
      event = undefined
      status = "loading"
      relays = []
      queriedRelays = []

      // Includes outbox discovery in the deadline, not only the final event request.
      const deadline = setTimeout(() => {
        if (active && !current) status = "unavailable"
        controller.abort()
      }, 8000)

      const acceptEvent = (candidate: TrustedEvent) => {
        if (!active || controller.signal.aborted) return
        if (
          current &&
          (candidate.created_at < current.created_at ||
            (candidate.created_at === current.created_at && candidate.id >= current.id))
        )
          return
        current = candidate
        event = candidate
        status = "ready"
        // Search relays are not canonical event hints. In particular, indexers
        // must not be added to repo URLs or copied event references.
        relays = getEventRelayHints(candidate, {relays: referenceRelays})
        void getDedicatedEventPath(candidate, relays)
          .then(path => {
            if (active && current?.id === candidate.id && path && path !== entityLink(reference)) {
              return goToEventPath(candidate, path, {replaceState: true})
            }
          })
          .catch(() => {
            // Missing surrounding context must not prevent viewing the event itself.
          })
      }

      void (async () => {
        try {
          const community = parseCommunityNaddr(reference)
          if (community) return await goto(makeExactCommunityPath(community), {replaceState: true})
          const decoded = nip19.decode(reference)
          if (decoded.type === "npub" || decoded.type === "nprofile") {
            return await goto(makeProfilePath(reference), {replaceState: true})
          }
          const pointer = parseEventReference(reference)
          if (!pointer) {
            status = "invalid"
            return
          }

          let searchRelays = normalizeRelayHints(
            pointer.relays,
            getAuthorRelays(pointer.author),
            pointer.kind === 30617 ? getRepoAnnouncementRelays(pointer.relays) : [],
            INDEXER_RELAYS,
          )
          const cached = repository.query(pointer.filters)[0] as TrustedEvent | undefined
          if (cached) acceptEvent(cached)

          if (decoded.type === "naddr" && pointer.kind === 30617 && pointer.relays.length === 0) {
            const outbox = await refreshPubkeyOutboxRelays(
              pointer.author!,
              getRepoAnnouncementRelays(),
            )
            if (!active || controller.signal.aborted) return
            searchRelays = normalizeRelayHints(outbox, searchRelays)
          }
          await loadReference({
            relays: [LOCAL_RELAY_URL, ...searchRelays],
            filters: pointer.filters,
            signal: controller.signal,
            onEvent: acceptEvent,
            onStart: url => {
              if (active && url !== LOCAL_RELAY_URL && !queriedRelays.includes(url)) {
                queriedRelays = [...queriedRelays, url]
              }
            },
          })
          if (active && !current) status = "unavailable"
        } catch {
          if (active && !current)
            status = parseEventReference(reference) ? "unavailable" : "invalid"
        } finally {
          clearTimeout(deadline)
        }
      })()

      return () => {
        active = false
        clearTimeout(deadline)
        controller.abort()
      }
    })
  })
</script>

<svelte:head><title>Event · Budabit</title></svelte:head>

<PageBar showTopMenuWidgets={false}>
  {#snippet title()}<h1 class="font-semibold">Event</h1>{/snippet}
</PageBar>
<PageContent>
  <div class="mx-auto w-full max-w-3xl p-4 pt-6">
    {#if event}
      {#key event.id}<EventFallback {event} {relays} />{/key}
    {:else if status === "loading"}
      <div role="status" class="p-6"><Spinner loading>Loading event…</Spinner></div>
    {:else}
      <section
        data-event-resolution={status}
        class="space-y-4 rounded-xl border border-base-content/15 bg-base-100 p-5">
        <h2 class="text-lg font-semibold">
          {status === "invalid" ? "Invalid Nostr reference" : "Event could not be loaded"}
        </h2>
        <p class="text-sm opacity-70">
          {status === "invalid"
            ? "This link is not a supported Nostr event or profile reference. Check that the full reference was copied."
            : "No event was found during this attempt. It may be unavailable, or the relays may not have responded. This does not mean the event was deleted."}
        </p>
        <code class="block break-all rounded-lg bg-base-200 p-3 text-xs">{bech32}</code>
        <div class="flex flex-wrap gap-3">
          {#if status !== "invalid"}<Button class="btn btn-primary btn-sm" onclick={() => retry++}
              >Retry</Button
            >{/if}
          <Button
            class="btn btn-ghost btn-sm"
            onclick={() => clip(status === "invalid" ? bech32 : `nostr:${bech32}`)}
            >Copy reference</Button>
        </div>
        {#if queriedRelays.length > 0}
          <details class="text-xs opacity-70">
            <summary class="cursor-pointer">Relays queried</summary>
            <ul class="mt-2 space-y-1 break-all">
              {#each queriedRelays as relay}<li>{relay}</li>{/each}
            </ul>
          </details>
        {/if}
      </section>
    {/if}
  </div>
</PageContent>
