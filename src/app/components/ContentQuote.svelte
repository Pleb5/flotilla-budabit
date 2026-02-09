<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {Router} from "@welshman/router"
  import type {TrustedEvent} from "@welshman/util"
  import {Address, MESSAGE} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import NoteContentMinimal from "@app/components/NoteContentMinimal.svelte"
  import {deriveEvent, entityLink} from "@app/core/state"
  import {goToEvent} from "@app/util/routes"
  import { Button as GitButton } from "@nostr-git/ui"
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

  let isPermalinkOpening = $state(false)
  const maxPreviewChars = 1200
  let copyState = $state<"idle" | "copied" | "error">("idle")
  let copyTimeout: ReturnType<typeof setTimeout> | null = null

  const onPermalinkOpen = () => {
    isPermalinkOpening = true
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

  const parseRepoAddress = (address: string) => {
    const parts = address.split(":")
    if (parts.length < 3) return null
    const [kindStr, pubkey, ...identifierParts] = parts
    const kind = Number.parseInt(kindStr, 10)
    const identifier = identifierParts.join(":")
    if (!kind || !pubkey || !identifier) return null
    return {kind, pubkey, identifier}
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

  const getDisplayRepo = (evt: TrustedEvent) => {
    const repoAddress = getTagValue(evt, "a")
    if (repoAddress) return repoAddress.split(":").slice(-1)[0] || repoAddress
    const repoUrl = getTagValue(evt, "repo")
    if (!repoUrl) return ""
    const last = repoUrl.split("/").pop() || repoUrl
    return last.replace(/\.git$/, "")
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

  const buildPermalinkHref = (evt: TrustedEvent, relay?: string) => {
    const repoAddress = getTagValue(evt, "a")
    if (!repoAddress || !relay) return ""
    const parsed = parseRepoAddress(repoAddress)
    if (!parsed) return ""
    let naddr = ""
    try {
      naddr = nip19.naddrEncode({
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.identifier,
        relays: [],
      })
    } catch {
      return ""
    }
    const base = `/spaces/${encodeURIComponent(relay)}/git/${naddr}`
    const commit = getTagValue(evt, "commit")
    const parentCommit = getTagValue(evt, "parent-commit")
    const filePath = getFilePath(evt)
    const {start, end} = getLineRange(evt)
    const lineAnchor = start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : ""
    const patchId = getTagValue(evt, "e")

    if (parentCommit) {
      if (commit) return `${base}/commits/${commit}`
      if (patchId) return `${base}/patches/${patchId}`
      return base
    }
    if (filePath) return `${base}/code?path=${encodeURIComponent(filePath)}${lineAnchor}`
    if (commit) return `${base}/commits/${commit}`
    if (patchId) return `${base}/patches/${patchId}`
    return base
  }
</script>

{#if $quote && $quote.kind === 1623}
  {@const permalinkHref = buildPermalinkHref($quote, url)}
  {@const displayRepo = getDisplayRepo($quote)}
  {@const filePath = getFilePath($quote)}
  {@const lineLabel = getLineLabel($quote)}
  {@const commitShort = getCommitShort($quote)}
  {@const contentPreview = getContentPreview($quote)}
  {@const isTruncated = isContentTruncated($quote)}
  {@const highlightLanguage = filePath ? getFileLanguage(filePath) : "plaintext"}
  {@const highlightedPreview = highlightPreview(contentPreview, highlightLanguage)}
  <div class="my-2 block w-full max-w-full text-left">
    <div class="rounded-lg border bg-card p-3 shadow-sm">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="text-sm font-semibold">Permalink</div>
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
        <div class="flex items-center gap-2">
          {#if permalinkHref}
            <GitButton
              variant="outline"
              size="sm"
              class="shrink-0"
              href={permalinkHref}
              onclick={onPermalinkOpen}
              aria-busy={isPermalinkOpening}
            >
              {#if isPermalinkOpening}
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
