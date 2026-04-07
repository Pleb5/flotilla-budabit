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
    ? Array.from(
        new Set([
          ...Router.get().Quote(event, idOrAddress, value?.relays || []).getUrls(),
          ...(url ? [url] : []),
        ]),
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
