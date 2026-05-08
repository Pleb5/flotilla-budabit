<script lang="ts">
  import Self from "@app/components/GitQuoteFallback.svelte"
  import {Router} from "@welshman/router"
  import type {TrustedEvent} from "@welshman/util"
  import {Address} from "@welshman/util"
  import {GIT_COMMENT} from "@nostr-git/core/events"
  import {deriveEvent} from "@app/core/state"
  import {
    getCommentRootQuoteValue,
    getGitQuoteFallback,
    getQuoteRelayHints,
    getQuoteTagRelayHints,
    getTrimmedReplyPreview,
    type QuoteValue,
  } from "@app/util/git-quote"

  interface Props {
    event: TrustedEvent
    value: QuoteValue | null | undefined
    url?: string
  }

  const {event, value, url}: Props = $props()

  const idOrAddress =
    value?.id ||
    (value?.kind && value.pubkey && value.identifier !== undefined
      ? new Address(value.kind, value.pubkey, value.identifier).toString()
      : "")

  const mergedRelays = idOrAddress
    ? getQuoteRelayHints(
        value?.relays || [],
        getQuoteTagRelayHints(event, idOrAddress),
        Router.get().Quote(event, idOrAddress, value?.relays || []).getUrls(),
        value?.pubkey ? Router.get().FromPubkey(value.pubkey).getUrls() : [],
        url ? [url] : undefined,
      )
    : []

  const quote = deriveEvent(idOrAddress, mergedRelays)
  const fallback = $derived.by(() => getGitQuoteFallback($quote))
  const commentPreview = $derived.by(() => {
    if ($quote?.kind !== GIT_COMMENT) return ""

    return getTrimmedReplyPreview({...$quote, content: $quote.content.split("\n---\n")[0]})
  })

  const commentRootValue = $derived.by(() => {
    if (!$quote || $quote.kind !== GIT_COMMENT || commentPreview) return null

    return getCommentRootQuoteValue($quote)
  })
</script>

{#if fallback}
  <span class="opacity-70">{fallback}</span>
{:else if commentPreview}
  <span class="opacity-70">{commentPreview}</span>
{:else if commentRootValue && $quote}
  <Self event={$quote} value={commentRootValue} {url} />
{/if}
