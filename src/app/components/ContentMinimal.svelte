<script lang="ts">
  import {fromNostrURI} from "@welshman/util"
  import {nthEq} from "@welshman/lib"
  import {
    parse,
    truncate,
    renderAsHtml,
    isText,
    isEmoji,
    isTopic,
    isCode,
    isCashu,
    isInvoice,
    isLink,
    isProfile,
    isEvent,
    isAddress,
    isNewline,
  } from "@welshman/content"
  import type {Parsed} from "@welshman/content"
  import Link from "@lib/components/Link.svelte"
  import Danger from "@assets/icons/danger-triangle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ContentToken from "@app/components/ContentToken.svelte"
  import ContentEmoji from "@app/components/ContentEmoji.svelte"
  import ContentCode from "@app/components/ContentCode.svelte"
  import ContentLinkInline from "@app/components/ContentLinkInline.svelte"
  import ContentNewline from "@app/components/ContentNewline.svelte"
  import ContentTopic from "@app/components/ContentTopic.svelte"
  import ContentMention from "@app/components/ContentMention.svelte"
  import GitQuoteFallback from "@app/components/GitQuoteFallback.svelte"
  import {entityLink, userSettingsValues} from "@app/core/state"

  interface Props {
    event: any
    trimParent?: boolean
    url?: string
  }

  const {event, trimParent = false, url}: Props = $props()

  const fullContent = parse(event)

  const isBoundary = (i: number) => {
    const parsed = fullContent[i]

    if (!parsed || isNewline(parsed)) return true
    if (isText(parsed)) return Boolean(parsed.value.match(/^\s+$/))

    return false
  }

  const isStart = (i: number) => isBoundary(i - 1)

  const isEnd = (i: number) => isBoundary(i + 1)

  const isStartAndEnd = (i: number) => isStart(i) && isEnd(i)

  const isQuote = (p: Parsed) => isEvent(p) || isAddress(p)

  const ignoreWarning = () => {
    warning = null
  }

  let warning = $state(
    $userSettingsValues.hide_sensitive && event.tags.find(nthEq(0, "content-warning"))?.[1],
  )

  const dropWhile = <T,>(f: (x: T) => boolean, xs: Iterable<T>) => {
    const result: T[] = []

    for (const x of xs) {
      if (result.length === 0 && f(x)) {
        continue
      }

      result.push(x)
    }

    return result
  }

  const hasVisibleContent = (parsed: Parsed) => {
    if (isNewline(parsed)) return false
    if (isText(parsed)) return Boolean(parsed.value.trim())

    return true
  }

  const leadingQuote = $derived.by(() =>
    trimParent && fullContent.length > 0 && isQuote(fullContent[0]) ? fullContent[0] : null,
  )

  const trimmedContent = $derived.by(() => {
    if (leadingQuote) {
      return dropWhile(p => isQuote(p) || isNewline(p), fullContent)
    }

    return fullContent
  })

  const shortContent = $derived.by(() => {
    return truncate(trimmedContent, {minLength: 200, maxLength: 300, mediaLength: 20})
  })

  const showQuoteFallback = $derived.by(
    () => Boolean(leadingQuote) && !trimmedContent.some(hasVisibleContent),
  )
</script>

<div class="relative">
  {#if warning}
    <div class="card2 card2-sm bg-alt row-2">
      <Icon icon={Danger} />
      <p>
        This note has been flagged by the author as "{warning}".<br />
        <Button class="link" onclick={ignoreWarning}>Show anyway</Button>
      </p>
    </div>
  {:else}
    <div class="overflow-hidden text-ellipsis break-words">
      {#if showQuoteFallback && leadingQuote}
        <GitQuoteFallback {event} value={leadingQuote.value} {url} />
      {:else}
        {#each shortContent as parsed, i}
          {#if isNewline(parsed)}
            <ContentNewline value={parsed.value} />
          {:else if isTopic(parsed)}
            <ContentTopic value={parsed.value} />
          {:else if isEmoji(parsed)}
            <ContentEmoji value={parsed.value} />
          {:else if isCode(parsed)}
            <ContentCode
              value={parsed.value}
              isBlock={isStartAndEnd(i) || parsed.value.includes("\n")} />
          {:else if isCashu(parsed) || isInvoice(parsed)}
            <ContentToken value={parsed.value} />
          {:else if isLink(parsed)}
            <ContentLinkInline value={parsed.value} />
          {:else if isProfile(parsed)}
            <ContentMention value={parsed.value} {url} />
          {:else if isQuote(parsed)}
            <Link
              external
              class="overflow-hidden text-ellipsis whitespace-nowrap underline"
              href={entityLink(parsed.raw)}>
              {fromNostrURI(parsed.raw).slice(0, 16) + "…"}
            </Link>
          {:else}
            {@html renderAsHtml(parsed)}
          {/if}
        {/each}
      {/if}
    </div>
  {/if}
</div>
