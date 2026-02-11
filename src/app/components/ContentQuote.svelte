<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {Router} from "@welshman/router"
  import type {TrustedEvent} from "@welshman/util"
  import {Address, MESSAGE} from "@welshman/util"
  import {FileCode, GitCommit} from "@lucide/svelte"
  import {githubPermalinkDiffId} from "@nostr-git/core/git"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import NoteContentMinimal from "@app/components/NoteContentMinimal.svelte"
  import {deriveEvent, entityLink} from "@app/core/state"
  import {goToEvent} from "@app/util/routes"
  import { Button as GitButton } from "@nostr-git/ui"
  import {
    GIT_COMMENT,
    GIT_ISSUE,
    GIT_PATCH,
    GIT_PULL_REQUEST,
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
  } from "@nostr-git/core/events"
  import hljs from "highlight.js/lib/core"
  import javascript from "highlight.js/lib/languages/javascript"
  import typescript from "highlight.js/lib/languages/typescript"
  import python from "highlight.js/lib/languages/python"
  import rust from "highlight.js/lib/languages/rust"
  import go from "highlight.js/lib/languages/go"
  import java from "highlight.js/lib/languages/java"
  import cpp from "highlight.js/lib/languages/cpp"
  import c from "highlight.js/lib/languages/c"
  import csharp from "highlight.js/lib/languages/csharp"
  import ruby from "highlight.js/lib/languages/ruby"
  import php from "highlight.js/lib/languages/php"
  import css from "highlight.js/lib/languages/css"
  import scss from "highlight.js/lib/languages/scss"
  import xml from "highlight.js/lib/languages/xml"
  import json from "highlight.js/lib/languages/json"
  import yaml from "highlight.js/lib/languages/yaml"
  import markdown from "highlight.js/lib/languages/markdown"
  import bash from "highlight.js/lib/languages/bash"
  import sql from "highlight.js/lib/languages/sql"
  import plaintext from "highlight.js/lib/languages/plaintext"

  hljs.registerLanguage("javascript", javascript)
  hljs.registerLanguage("typescript", typescript)
  hljs.registerLanguage("python", python)
  hljs.registerLanguage("rust", rust)
  hljs.registerLanguage("go", go)
  hljs.registerLanguage("java", java)
  hljs.registerLanguage("cpp", cpp)
  hljs.registerLanguage("c", c)
  hljs.registerLanguage("csharp", csharp)
  hljs.registerLanguage("ruby", ruby)
  hljs.registerLanguage("php", php)
  hljs.registerLanguage("css", css)
  hljs.registerLanguage("scss", scss)
  hljs.registerLanguage("xml", xml)
  hljs.registerLanguage("html", xml)
  hljs.registerLanguage("json", json)
  hljs.registerLanguage("yaml", yaml)
  hljs.registerLanguage("markdown", markdown)
  hljs.registerLanguage("bash", bash)
  hljs.registerLanguage("sql", sql)
  hljs.registerLanguage("plaintext", plaintext)

  type Props = {
    value: any
    event: TrustedEvent
    url?: string
  }

  const {value, event, url}: Props = $props()

  const {id, identifier, kind, pubkey, relays = []} = value
  const idOrAddress = id || new Address(kind, pubkey, identifier).toString()
  const mergedRelays = Router.get().Quote(event, idOrAddress, relays).getUrls()

  if (url) {
    mergedRelays.push(url)
  }

  const quote = deriveEvent(idOrAddress, mergedRelays)
  const entity = id
    ? nip19.neventEncode({id, relays: mergedRelays})
    : new Address(kind, pubkey, identifier, mergedRelays).toNaddr()

  const onclick = () => {
    if ($quote) {
      goToEvent($quote)
    } else {
      window.open(entityLink(entity))
    }
  }

  let isOpenPending = $state(false)
  const maxPreviewChars = 1200
  const maxSnippetChars = 220
  let copyState = $state<"idle" | "copied" | "error">("idle")
  let copyTimeout: ReturnType<typeof setTimeout> | null = null

  const onOpen = () => {
    isOpenPending = true
  }

  const setCopyState = (state: "idle" | "copied" | "error") => {
    copyState = state
    if (copyTimeout) clearTimeout(copyTimeout)
    if (state !== "idle") {
      copyTimeout = setTimeout(() => {
        copyState = "idle"
      }, 1500)
    }
  }

  const copyPermalinkContent = async (evt: TrustedEvent) => {
    const text = evt?.content || ""
    if (!text) return
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      console.warn("Clipboard API not available")
      setCopyState("error")
      return
    }
    try {
      await navigator.clipboard.writeText(text)
      setCopyState("copied")
    } catch (error) {
      console.error("Failed to copy permalink content", error)
      setCopyState("error")
    }
  }

  const getTagValue = (evt: TrustedEvent, name: string) =>
    evt.tags?.find(tag => tag[0] === name)?.[1] || ""

  const getTag = (evt: TrustedEvent, name: string) => evt.tags?.find(tag => tag[0] === name)

  const getTagValueAny = (evt: TrustedEvent, names: string[]) => {
    for (const name of names) {
      const value = getTagValue(evt, name)
      if (value) return value
    }
    return ""
  }

  const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim()

  const truncateText = (text: string, max = maxSnippetChars) => {
    const normalized = normalizeText(text)
    if (!normalized) return ""
    if (normalized.length <= max) return normalized
    return `${normalized.slice(0, max).trimEnd()}...`
  }

  const parseRepoAddress = (address: string) => {
    const parts = address.split(":")
    if (parts.length < 3) return null
    const [kindStr, pubkey, ...identifierParts] = parts
    const kind = Number.parseInt(kindStr, 10)
    const identifier = identifierParts.join(":")
    if (!kind || !pubkey || !identifier) return null
    return {kind, pubkey, identifier}
  }

  const getRepoLabelFromAddress = (address: string) => {
    if (!address) return ""
    const parsed = parseRepoAddress(address)
    if (parsed?.identifier) return parsed.identifier
    const last = address.split("/").pop() || address
    return last.replace(/\.git$/, "")
  }

  const getFilePath = (evt: TrustedEvent) =>
    getTagValue(evt, "file") || getTagValue(evt, "path") || getTagValue(evt, "f")

  const getLineRange = (evt: TrustedEvent) => {
    const tag = getTag(evt, "lines")
    if (!tag) return {start: null, end: null}
    const start = Number.parseInt(tag[1] || "", 10)
    const end = Number.parseInt(tag[2] || "", 10)
    return {
      start: Number.isNaN(start) ? null : start,
      end: Number.isNaN(end) ? null : end,
    }
  }

  const getLineLabel = (evt: TrustedEvent) => {
    const {start, end} = getLineRange(evt)
    if (!start) return ""
    if (end && end !== start) return `L${start}-L${end}`
    return `L${start}`
  }

  const getFileLanguage = (filepath: string) => {
    const ext = filepath.split(".").pop()?.toLowerCase()
    const langMap: Record<string, string> = {
      js: "javascript",
      ts: "typescript",
      jsx: "javascript",
      tsx: "typescript",
      py: "python",
      rb: "ruby",
      go: "go",
      rs: "rust",
      java: "java",
      cpp: "cpp",
      c: "c",
      cs: "csharp",
      php: "php",
      html: "html",
      css: "css",
      scss: "scss",
      sass: "scss",
      json: "json",
      xml: "xml",
      yaml: "yaml",
      yml: "yaml",
      md: "markdown",
      sh: "bash",
      bash: "bash",
      zsh: "bash",
      fish: "bash",
    }
    return langMap[ext || ""] || "plaintext"
  }

  const highlightPreview = (content: string, language: string) => {
    if (!content) return ""
    try {
      return hljs.highlight(content, {language, ignoreIllegals: true}).value
    } catch {
      return hljs.highlight(content, {language: "plaintext", ignoreIllegals: true}).value
    }
  }

  const getDisplayRepo = (evt: TrustedEvent, repoAddressOverride = "") => {
    const repoAddress = repoAddressOverride || getTagValue(evt, "repo") || getTagValue(evt, "a")
    if (repoAddress) return getRepoLabelFromAddress(repoAddress)
    return ""
  }

  const getCommitShort = (evt: TrustedEvent) => {
    const commit = getTagValue(evt, "commit")
    return commit ? commit.slice(0, 8) : ""
  }

  const getContentPreview = (evt: TrustedEvent) => {
    const text = evt?.content || ""
    if (!text) return ""
    if (text.length <= maxPreviewChars) return text
    const head = text.slice(0, maxPreviewChars)
    const lastNewline = head.lastIndexOf("\n")
    const trimmed = lastNewline > 200 ? head.slice(0, lastNewline) : head
    return `${trimmed}\n…`
  }

  const isContentTruncated = (evt: TrustedEvent) =>
    (evt?.content?.length || 0) > maxPreviewChars

  const buildRepoHrefFromAddress = (repoAddress: string, relay?: string) => {
    if (!repoAddress || !relay) return ""
    const parsed = parseRepoAddress(repoAddress)
    if (!parsed) return ""
    try {
      const naddr = nip19.naddrEncode({
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.identifier,
        relays: [],
      })
      return `/spaces/${encodeURIComponent(relay)}/git/${naddr}`
    } catch {
      return ""
    }
  }

  const buildRepoHrefFromEvent = (evt: TrustedEvent, relay?: string) => {
    if (!relay) return ""
    try {
      const naddr = Address.fromEvent(evt).toNaddr()
      return `/spaces/${encodeURIComponent(relay)}/git/${naddr}`
    } catch {
      return ""
    }
  }

  const getCommentRootId = (evt: TrustedEvent) => getTagValueAny(evt, ["E", "e"])

  const getCommentRootKind = (evt: TrustedEvent) => {
    const raw = getTagValueAny(evt, ["K", "k"])
    const kind = Number.parseInt(raw, 10)
    return Number.isNaN(kind) ? null : kind
  }

  const getCommentContextLabel = (rootKind: number | null) => {
    if (rootKind === GIT_ISSUE) return "Issue"
    if (rootKind === GIT_PATCH) return "Patch"
    if (rootKind === GIT_PULL_REQUEST) return "Pull Request"
    return "Thread"
  }

  const getCommentPreview = (evt: TrustedEvent) => {
    const text = evt?.content || ""
    if (!text) return ""
    const main = text.split("\n---\n")[0]
    return truncateText(main)
  }

  const getIssuePreview = (evt: TrustedEvent) => truncateText(evt?.content || "")

  const getPatchPreview = (evt: TrustedEvent) => {
    const commit = getTagValue(evt, "commit")
    if (commit) return `Commit ${commit.slice(0, 8)}`
    const baseBranch = getTagValue(evt, "base-branch")
    if (baseBranch) return `Base ${baseBranch}`
    return ""
  }

  const getRepoPreview = (evt: TrustedEvent) => truncateText(getTagValue(evt, "description"))

  const getGitShareCard = (evt: TrustedEvent, relay?: string) => {
    if (!evt) return null
    if (evt.kind === GIT_REPO_ANNOUNCEMENT || evt.kind === GIT_REPO_STATE) {
      return {
        label: "Repository",
        title: getTagValue(evt, "name") || getTagValue(evt, "d") || "Repository",
        meta: [] as string[],
        preview: getRepoPreview(evt),
        href: buildRepoHrefFromEvent(evt, relay),
      }
    }

    if (evt.kind === GIT_ISSUE) {
      const repoAddress = getTagValue(evt, "a")
      const repoLabel = getDisplayRepo(evt, repoAddress)
      const baseHref = buildRepoHrefFromAddress(repoAddress, relay)
      return {
        label: "Issue",
        title: getTagValue(evt, "subject") || "Issue",
        meta: repoLabel ? [repoLabel] : [],
        preview: getIssuePreview(evt),
        href: baseHref ? `${baseHref}/issues/${evt.id}` : "",
      }
    }

    if (evt.kind === GIT_PATCH || evt.kind === GIT_PULL_REQUEST) {
      const repoAddress = getTagValue(evt, "a")
      const repoLabel = getDisplayRepo(evt, repoAddress)
      const baseHref = buildRepoHrefFromAddress(repoAddress, relay)
      return {
        label: evt.kind === GIT_PULL_REQUEST ? "Pull Request" : "Patch",
        title: getTagValue(evt, "subject") || (evt.kind === GIT_PULL_REQUEST ? "Pull Request" : "Patch"),
        meta: repoLabel ? [repoLabel] : [],
        preview: getPatchPreview(evt),
        href: baseHref ? `${baseHref}/patches/${evt.id}` : "",
      }
    }

    if (evt.kind === GIT_COMMENT) {
      const repoAddress = getTagValue(evt, "repo")
      const repoLabel = getDisplayRepo(evt, repoAddress)
      const rootId = getCommentRootId(evt)
      const rootKind = getCommentRootKind(evt)
      const contextLabel = getCommentContextLabel(rootKind)
      const baseHref = buildRepoHrefFromAddress(repoAddress, relay)
      let href = ""
      if (baseHref) {
        if (rootKind === GIT_ISSUE) {
          href = `${baseHref}/issues/${rootId}#comment-${evt.id}`
        } else if (rootKind === GIT_PATCH || rootKind === GIT_PULL_REQUEST) {
          href = `${baseHref}/patches/${rootId}#comment-${evt.id}`
        } else if (rootId) {
          href = `${baseHref}#comment-${evt.id}`
        } else {
          href = baseHref
        }
      }
      return {
        label: "Comment",
        title: `Comment on ${contextLabel}`,
        meta: repoLabel ? [repoLabel] : [],
        preview: getCommentPreview(evt),
        href,
      }
    }

    return null
  }

  const buildPermalinkHref = (evt: TrustedEvent, relay?: string, diffHash = "") => {
    const repoAddress = getTagValue(evt, "a")
    const base = buildRepoHrefFromAddress(repoAddress, relay)
    if (!base) return ""
    const commit = getTagValue(evt, "commit")
    const parentCommit = getTagValue(evt, "parent-commit")
    const filePath = getFilePath(evt)
    const {start, end} = getLineRange(evt)
    const lineAnchor = start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : ""
    const patchId = getTagValue(evt, "e")
    const diffAnchor = diffHash
      ? `#diff-${diffHash}${start ? `R${start}${end && end !== start ? `-R${end}` : ""}` : ""}`
      : ""

    if (parentCommit) {
      if (filePath && !diffHash) return ""
      if (commit) return `${base}/commits/${commit}${diffAnchor}`
      if (patchId) return `${base}/patches/${patchId}${diffAnchor}`
      return `${base}${diffAnchor}`
    }
    if (filePath) return `${base}/code?path=${encodeURIComponent(filePath)}${lineAnchor}`
    if (commit) return `${base}/commits/${commit}`
    if (patchId) return `${base}/patches/${patchId}`
    return base
  }

  let diffHash = $state("")

  $effect(() => {
    if (!$quote) return
    const parentCommit = getTagValue($quote, "parent-commit")
    const filePath = getFilePath($quote)
    if (!parentCommit || !filePath) {
      diffHash = ""
      return
    }
    let cancelled = false
    githubPermalinkDiffId(filePath)
      .then(hash => {
        if (!cancelled) diffHash = hash
      })
      .catch(() => {
        if (!cancelled) diffHash = ""
      })
    return () => {
      cancelled = true
    }
  })

  const gitCard = $derived.by(() => ($quote ? getGitShareCard($quote, url) : null))
</script>

{#if $quote && $quote.kind === 1623}
  {@const permalinkHref = buildPermalinkHref($quote, url, diffHash)}
  {@const displayRepo = getDisplayRepo($quote)}
  {@const filePath = getFilePath($quote)}
  {@const lineLabel = getLineLabel($quote)}
  {@const commitShort = getCommitShort($quote)}
  {@const parentCommit = getTagValue($quote, "parent-commit")}
  {@const isDiff = Boolean(parentCommit)}
  {@const kindLabel = isDiff ? "Diff" : "Code"}
  {@const kindTitle = isDiff ? "Diff permalink" : "Code permalink"}
  {@const kindIcon = isDiff ? GitCommit : FileCode}
  {@const kindIconClass = isDiff ? "text-amber-500" : "text-blue-500"}
  {@const kindBadgeClass = isDiff
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20"
    : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20"}
  {@const contentPreview = getContentPreview($quote)}
  {@const isTruncated = isContentTruncated($quote)}
  {@const highlightLanguage = filePath ? getFileLanguage(filePath) : "plaintext"}
  {@const highlightedPreview = highlightPreview(contentPreview, highlightLanguage)}
  <div class="my-2 block w-full max-w-full text-left">
    <div class="rounded-lg border bg-card p-3 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0 flex items-start gap-2">
          <svelte:component this={kindIcon} class={`h-4 w-4 mt-0.5 ${kindIconClass}`} />
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <div class="text-sm font-semibold">{kindTitle}</div>
              <span
                class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindBadgeClass}`}
              >
                {kindLabel}
              </span>
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            {#if displayRepo}
              <span class="font-mono">{displayRepo}</span>
            {/if}
            {#if filePath}
              <span class="font-mono truncate" title={filePath}>{filePath}</span>
            {/if}
            {#if lineLabel}
              <span class="font-mono">{lineLabel}</span>
            {/if}
            {#if commitShort}
              <span class="font-mono">{commitShort}</span>
            {/if}
            </div>
          </div>
        </div>
        <div class="flex items-center gap-2">
          {#if permalinkHref}
            <GitButton
              variant="outline"
              size="sm"
              class="shrink-0"
              href={permalinkHref}
              onclick={onOpen}
              aria-busy={isOpenPending}
            >
              {#if isOpenPending}
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {/if}
              Open
            </GitButton>
          {/if}
          <GitButton
            variant="outline"
            size="sm"
            class="shrink-0"
            onclick={() => copyPermalinkContent($quote)}
            disabled={!$quote?.content}
            aria-live="polite"
          >
            {#if copyState === "copied"}
              Copied
            {:else if copyState === "error"}
              Copy failed
            {:else}
              Copy
            {/if}
          </GitButton>
        </div>
      </div>
      {#if contentPreview}
        <div class="mt-3 rounded border bg-muted/30 p-3 permalink-preview">
          <pre class="whitespace-pre-wrap font-mono text-xs leading-snug">
            <code class="hljs">{@html highlightedPreview}</code>
          </pre>
          {#if isTruncated}
            <div class="mt-2 text-[11px] text-muted-foreground">Excerpt truncated</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
  {:else if gitCard}
    {@const openHref = gitCard.href || entityLink(entity)}
    <div class="my-2 block w-full max-w-full text-left">
      <div class="rounded-lg border bg-card p-3 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="text-sm font-semibold">{gitCard.label}</div>
            {#if gitCard.meta?.length}
              <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {#each gitCard.meta as item}
                  <span class="font-mono truncate" title={item}>{item}</span>
                {/each}
              </div>
            {/if}
          </div>
          <div class="flex items-center gap-2">
            <GitButton
              variant="outline"
              size="sm"
              class="shrink-0"
              href={openHref}
              onclick={onOpen}
              aria-busy={isOpenPending}
            >
              {#if isOpenPending}
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {/if}
              Open
            </GitButton>
          </div>
        </div>
        {#if gitCard.title}
          <div class="mt-2 text-sm font-medium line-clamp-2">{gitCard.title}</div>
        {/if}
        {#if gitCard.preview}
          <div class="mt-2 text-sm text-muted-foreground line-clamp-3">{gitCard.preview}</div>
        {/if}
      </div>
    </div>
  {:else}
    <Button class="my-2 block w-full max-w-full text-left" {onclick}>
    {#if $quote}
      {#if $quote.kind === MESSAGE}
        <div
          class="border-l-2 border-solid border-l-primary py-1 pl-2 opacity-90"
          style="background-color: color-mix(in srgb, var(--primary) 10%, var(--base-300) 90%);">
          <NoteContentMinimal trimParent {url} event={$quote} />
        </div>
      {:else}
        <NoteCard event={$quote} {url} class="bg-alt rounded-box p-4">
          <NoteContentMinimal {url} event={$quote} />
        </NoteCard>
      {/if}
    {:else}
      <div class="rounded-box p-4">
        <Spinner loading>Loading event...</Spinner>
      </div>
    {/if}
  </Button>
{/if}

<style>
  :global(.permalink-preview .hljs) {
    background: transparent !important;
    color: inherit !important;
  }

  :global(.permalink-preview .hljs-keyword),
  :global(.permalink-preview .hljs-selector-tag),
  :global(.permalink-preview .hljs-literal),
  :global(.permalink-preview .hljs-title),
  :global(.permalink-preview .hljs-section),
  :global(.permalink-preview .hljs-type) {
    color: hsl(var(--primary));
  }

  :global(.permalink-preview .hljs-string),
  :global(.permalink-preview .hljs-attr),
  :global(.permalink-preview .hljs-attribute),
  :global(.permalink-preview .hljs-template-tag),
  :global(.permalink-preview .hljs-template-variable) {
    color: hsl(var(--accent-foreground));
  }

  :global(.permalink-preview .hljs-number),
  :global(.permalink-preview .hljs-symbol),
  :global(.permalink-preview .hljs-bullet) {
    color: hsl(var(--secondary-foreground));
  }

  :global(.permalink-preview .hljs-comment),
  :global(.permalink-preview .hljs-quote) {
    color: hsl(var(--muted-foreground));
    font-style: italic;
  }
</style>
