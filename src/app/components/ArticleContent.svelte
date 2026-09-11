<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import Markdown from "@lib/components/Markdown.svelte"
  import {userSettingsValues} from "@app/core/state"
  import {getArticleDetails} from "@app/util/articles"

  const {
    event,
    compact = false,
    relays = [],
    url,
    communitySectionName = "",
    depth = 0,
    hideMediaAtDepth = 1,
  }: {
    event: TrustedEvent
    compact?: boolean
    relays?: string[]
    url?: string
    communitySectionName?: string
    depth?: number
    hideMediaAtDepth?: number
  } = $props()

  const article = $derived(getArticleDetails(event))
  const showMedia = $derived($userSettingsValues.show_media && depth < hideMediaAtDepth)
  let failedImage = $state("")
  const date = $derived(
    article.publishedAt === undefined ? undefined : new Date(article.publishedAt * 1000),
  )
</script>

<div
  data-article-content
  data-compact={compact}
  class="min-w-0 max-w-full space-y-4 [overflow-wrap:anywhere]">
  <header class="space-y-2">
    <div class="flex flex-wrap items-center gap-2 text-xs opacity-70">
      <span class="badge badge-outline badge-sm">{article.draft ? "Draft" : "Article"}</span>
      {#if date}
        <span
          >{article.draft ? "Draft saved" : "Published"}
          <time datetime={date.toISOString()} title={date.toLocaleString()}
            >{date.toLocaleDateString(undefined, {
              year: "numeric",
              month: "long",
              day: "numeric",
            })}</time
          ></span>
      {/if}
    </div>
    <h2
      class={compact
        ? "line-clamp-2 text-base font-semibold"
        : "text-2xl font-bold leading-tight sm:text-3xl"}>
      {article.title}
    </h2>
    {#if compact ? article.preview : article.summary}
      <p class={compact ? "line-clamp-3 text-sm opacity-70" : "text-base opacity-70"}>
        {compact ? article.preview : article.summary}
      </p>
    {/if}
  </header>
  {#if showMedia && article.image && failedImage !== article.image}
    <img
      data-article-cover
      src={article.image}
      alt={`Cover for ${article.title}`}
      class={compact
        ? "max-h-36 w-full rounded-lg object-cover"
        : "max-h-80 w-full rounded-lg object-cover"}
      loading="lazy"
      decoding="async"
      referrerpolicy="no-referrer"
      onerror={() => (failedImage = article.image)} />
  {/if}
  {#if !compact}
    {#if event.content.trim()}
      <div data-article-body class="min-w-0 max-w-full">
        <Markdown
          content={event.content}
          {event}
          {relays}
          {url}
          {communitySectionName}
          {depth}
          {hideMediaAtDepth}
          {showMedia}
          variant="body" />
      </div>
    {:else}
      <p class="text-sm opacity-70">This {article.draft ? "draft" : "article"} has no body yet.</p>
    {/if}
  {/if}
</div>
