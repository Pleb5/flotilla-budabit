<script lang="ts">
  import cx from "classnames"
  import {onMount} from "svelte"
  import type {Snippet} from "svelte"
  import {groupBy, map, sum, uniq, uniqBy, batch, displayList} from "@welshman/lib"
  import {
    REPORT,
    REACTION,
    ZAP_RESPONSE,
    getReplyFilters,
    getEmojiTags,
    getEmojiTag,
    fromMsats,
    getTag,
    DELETE,
    normalizeRelayUrl,
  } from "@welshman/util"
  import type {TrustedEvent, EventContent, Filter, Zap} from "@welshman/util"
  import {deriveArray, deriveEventsById, deriveItemsByKey} from "@welshman/store"
  import {load} from "@welshman/net"
  import {pubkey, repository, tracker, getValidZap, displayProfileByPubkey} from "@welshman/app"
  import {isMobile, preventDefault, stopPropagation} from "@lib/html"
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Reaction from "@app/components/Reaction.svelte"
  import ReportDetails from "@app/components/ReportDetails.svelte"
  import {REACTION_KINDS} from "@app/core/state"
  import {pushModal} from "@app/util/modal"

  interface Props {
    event: TrustedEvent
    deleteReaction: (event: TrustedEvent) => void
    createReaction: (event: EventContent) => void
    url?: string
    relays?: string[]
    scopeH?: string
    reactionClass?: string
    noTooltip?: boolean
    readOnly?: boolean
    children?: Snippet
  }

  const {
    event,
    deleteReaction,
    createReaction,
    url = "",
    relays = [],
    scopeH = "",
    reactionClass = "",
    noTooltip = false,
    readOnly = false,
    children,
  }: Props = $props()

  const normalizeRelay = (relay: string) => {
    try {
      return normalizeRelayUrl(relay)
    } catch {
      return ""
    }
  }

  const loadRelays = $derived.by(() => {
    const candidates = relays.length > 0 ? relays : url ? [url] : []
    return uniq(candidates.map(normalizeRelay).filter(Boolean))
  })

  const relaySet = $derived.by(() => new Set(relays.map(normalizeRelay).filter(Boolean)))

  const hasScopeH = $derived.by(() => Boolean(scopeH))

  const withScopeH = (filters: Filter[]) =>
    hasScopeH ? filters.map(filter => ({...filter, "#h": [scopeH]})) : filters

  const matchesRelayScope = (event: TrustedEvent) => {
    if (relaySet.size === 0) return true

    for (const relay of tracker.getRelays(event.id)) {
      if (relaySet.has(normalizeRelay(relay))) {
        return true
      }
    }

    return false
  }

  const matchesScopeH = (event: TrustedEvent) => !scopeH || getTag("h", event.tags)?.[1] === scopeH

  const matchesScope = (event: TrustedEvent) => matchesRelayScope(event) && matchesScopeH(event)

  const reports = deriveArray(
    deriveEventsById({repository, filters: [{kinds: [REPORT], "#e": [event.id]}]}),
  )

  const reactions = deriveArray(
    deriveEventsById({repository, filters: [{kinds: [REACTION], "#e": [event.id]}]}),
  )

  const zaps = deriveArray(
    deriveItemsByKey<Zap>({
      repository,
      getKey: zap => zap.response.id,
      filters: [{kinds: [ZAP_RESPONSE], "#e": [event.id]}],
      eventToItem: (response: TrustedEvent) => getValidZap(response, event),
    }),
  )

  const scopedReports = $derived.by(() => Array.from($reports.values()).filter(matchesScope))

  const scopedReactions = $derived.by(() => Array.from($reactions.values()).filter(matchesScope))

  const scopedZaps = $derived.by(() =>
    Array.from($zaps.values()).filter(zap => matchesRelayScope(zap.response) && matchesScopeH(zap.request)),
  )

  const onReactionClick = (events: TrustedEvent[]) => {
    const reaction = events.find(e => e.pubkey === $pubkey)

    if (reaction) {
      deleteReaction(reaction)
    } else {
      const [event] = events

      createReaction({
        content: event.content,
        tags: getEmojiTags(event.content.replace(/:/g, ""), event.tags),
      })
    }
  }

  const onReportClick = () => pushModal(ReportDetails, {url: url || loadRelays[0] || "", event})

  const reportReasons = $derived(uniq(map(e => getTag("e", e.tags)?.[2], scopedReports)))

  const getReactionKey = (e: TrustedEvent) => getEmojiTag(e.content, e.tags)?.join("") || e.content

  const groupedReactions = $derived(
    groupBy(
      getReactionKey,
      uniqBy(e => `${e.pubkey}${getReactionKey(e)}`, scopedReactions),
    ),
  )

  const groupedZaps = $derived(groupBy(e => getReactionKey(e.request), scopedZaps))

  onMount(() => {
    const controller = new AbortController()

    if (loadRelays.length > 0) {
      load({
        relays: loadRelays,
        signal: controller.signal,
        filters: withScopeH(getReplyFilters([event], {kinds: REACTION_KINDS}) as Filter[]),
        onEvent: batch(300, (events: TrustedEvent[]) => {
          load({
            relays: loadRelays,
            filters: withScopeH(getReplyFilters(events, {kinds: [DELETE]}) as Filter[]),
          })
        }),
      })
    }

    return () => {
      controller.abort()
    }
  })
</script>

{#if scopedReactions.length > 0 || scopedZaps.length || scopedReports.length > 0}
  <div class="flex min-w-0 flex-wrap gap-2">
    {#if (url || loadRelays.length > 0) && scopedReports.length > 0}
      <button
        type="button"
        data-tip={`This content has been reported as "${displayList(reportReasons)}".`}
        class="btn btn-error btn-xs tooltip-right flex items-center gap-1 rounded-full font-normal"
        class:tooltip={!noTooltip && !isMobile}
        onclick={stopPropagation(preventDefault(onReportClick))}>
        <Icon icon={Danger} />
        <span>{scopedReports.length}</span>
      </button>
    {/if}
    {#each groupedZaps.entries() as [key, zaps]}
      {@const amount = fromMsats(sum(zaps.map(zap => zap.invoiceAmount)))}
      {@const pubkeys = uniq(zaps.map(zap => zap.request.pubkey))}
      {@const isOwn = $pubkey && pubkeys.includes($pubkey)}
      {@const info = displayList(pubkeys.map(pubkey => displayProfileByPubkey(pubkey)))}
      {@const tooltip = `${info} zapped`}
      <button
        type="button"
        data-tip={tooltip}
        class={cx(
          reactionClass,
          "flex-inline btn btn-outline btn-neutral btn-xs flex items-center gap-1 rounded-full text-xs font-normal",
          {
            tooltip: !noTooltip && !isMobile,
            "border-neutral-content/20": !isOwn,
            "btn-primary": isOwn,
          },
        )}>
        <Reaction event={zaps[0].request} />
        <span>{amount}</span>
      </button>
    {/each}
    {#each groupedReactions.entries() as [key, events]}
      {@const pubkeys = events.map(e => e.pubkey)}
      {@const isOwn = $pubkey && pubkeys.includes($pubkey)}
      {@const info = displayList(pubkeys.map(pubkey => displayProfileByPubkey(pubkey)))}
      {@const tooltip = `${info} reacted`}
      {@const onClick = () => onReactionClick(events)}
      <button
        type="button"
        data-tip={tooltip}
        class={cx(
          reactionClass,
          "flex-inline btn btn-outline btn-neutral btn-xs gap-1 rounded-full font-normal",
          {
            tooltip: !noTooltip && !isMobile,
            "border-neutral-content/20": !isOwn,
            "btn-primary": isOwn,
            "cursor-default": readOnly,
          },
        )}
        onclick={readOnly ? undefined : stopPropagation(preventDefault(onClick))}>
        <Reaction event={events[0]} />
        {#if events.length > 1}
          <span>{events.length}</span>
        {/if}
      </button>
    {/each}
    {@render children?.()}
  </div>
{/if}
