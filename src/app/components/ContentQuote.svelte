<style>
  /* Snippet line layout */
  .permalink-preview {
    -webkit-overflow-scrolling: touch;
  }

  .cq-snippet-lines {
    font-family:
      ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
    font-size: 0.6875rem;
    min-width: max-content;
    padding: 3px 0;
  }

  .cq-snippet-line {
    display: flex;
    align-items: baseline;
    min-width: 100%;
    width: max-content;
    line-height: 1.45;
  }

  .cq-snippet-num {
    flex-shrink: 0;
    min-width: 2.5ch;
    padding: 0 0.5ch;
    text-align: right;
    color: hsl(var(--ng-muted-foreground) / 0.45);
    user-select: none;
  }

  .cq-snippet-diff-ind {
    flex-shrink: 0;
    width: 1.5ch;
    text-align: center;
    user-select: none;
    opacity: 0.5;
  }

  :global(.cq-snippet-code) {
    flex: 0 0 auto;
    margin: 0 !important;
    padding: 0 0.5ch !important;
    white-space: pre;
    word-break: normal;
    font: inherit;
    line-height: inherit;
  }

  :global(.cq-snippet-code code) {
    padding: 0 !important;
    margin: 0 !important;
    font: inherit;
    line-height: inherit;
  }

  :global(.cq-diff-add) {
    background-color: rgba(34, 197, 94, 0.12);
    border-left: 2px solid rgb(22, 163, 74);
  }

  :global(.cq-diff-del) {
    background-color: rgba(239, 68, 68, 0.12);
    border-left: 2px solid rgb(220, 38, 38);
  }

  :global(.dark .cq-diff-add) {
    background-color: rgba(34, 197, 94, 0.15);
    border-left-color: rgb(34, 197, 94);
  }

  :global(.dark .cq-diff-del) {
    background-color: rgba(239, 68, 68, 0.15);
    border-left-color: rgb(239, 68, 68);
  }
</style>

<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {Router} from "@welshman/router"
  import type {TrustedEvent} from "@welshman/util"
  import {Address, EVENT_DATE, EVENT_TIME, MESSAGE, THREAD, ZAP_GOAL} from "@welshman/util"
  import {FileCode, GitCommit} from "@lucide/svelte"
  import {githubPermalinkDiffId} from "@nostr-git/core/git"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ShareCircle from "@assets/icons/share-circle.svg?dataurl"
  import {getInteractiveCardTarget} from "@lib/html"
  import Spinner from "@lib/components/Spinner.svelte"
  import ExtensionIcon from "@app/components/ExtensionIcon.svelte"
  import NoteCard from "@app/components/NoteCard.svelte"
  import NoteContentMinimal from "@app/components/NoteContentMinimal.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import ModeratedContent from "@app/components/community/ModeratedContent.svelte"
  import {deriveEvent, entityLink} from "@app/core/state"
  import {SMART_WIDGET_KIND} from "@app/core/community-feeds"
  import {enableExtension, installWidgetFromEvent} from "@app/core/commands"
  import {activeCommunityReportState} from "@app/core/community-state"
  import {getPreferredRepoPublicationAddress} from "@app/core/repo-publication"
  import {parseCommunityDefinitionAddress} from "@app/core/community"
  import {
    getCommunityCensorReason,
    getCommunityReportEventAddress,
  } from "@app/core/community-reports"
  import {goToEvent, goToEventPath, makeGitPath} from "@app/util/routes"
  import {makeRepoHrefFromEvent} from "@app/util/repo-links"
  import {pushToast} from "@app/util/toast"
  import {getCopySuccessMessage} from "@nostr-git/ui/clipboard"
  import {getQuoteRelayHints, getQuoteTagRelayHints} from "@app/util/git-quote"
  import {makeEventNevent} from "@app/util/event-links"
  import {makeEventShareEntityForEvent} from "@app/util/event-share"
  import {parseSmartWidget} from "@app/extensions/registry"
  import {getWidgetLineId} from "@app/extensions/widget-identity"
  import {effectiveExtensionSettings} from "@app/extensions/settings"
  import {clearCommunityWidgetSlotCache} from "@app/extensions/community-widget-slots"
  import type {SmartWidgetEvent} from "@app/extensions/types"
  import {
    Button as GitButton,
    highlightCodeLines,
    getHighlightLanguageForPath,
    highlightCodeSnippet,
  } from "@nostr-git/ui"
  import {
    GIT_COMMENT,
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
    parseRepoCommunityBinding,
  } from "@nostr-git/core/events"

  type Props = {
    value: any
    event: TrustedEvent
    url?: string
    communitySectionName?: string
  }

  const {value, event, url, communitySectionName = ""}: Props = $props()

  const {id, identifier, kind, pubkey, relays = []} = value
  const idOrAddress = id || new Address(kind, pubkey, identifier).toString()
  const authorRelays = pubkey ? Router.get().FromPubkey(pubkey).getUrls() : []
  const referenceRelays = getQuoteRelayHints(relays, getQuoteTagRelayHints(event, idOrAddress))
  const mergedRelays = getQuoteRelayHints(
    referenceRelays,
    Router.get().Quote(event, idOrAddress, relays).getUrls(),
    authorRelays,
    url ? [url] : undefined,
  )

  const quote = deriveEvent(idOrAddress, mergedRelays)
  const censorReason = $derived.by(() => {
    if (!communitySectionName) return undefined

    return getCommunityCensorReason({
      reportState: $activeCommunityReportState,
      eventId: $quote?.id || id,
      eventAddress: $quote ? getCommunityReportEventAddress($quote) : id ? "" : idOrAddress,
      pubkey: $quote?.pubkey || pubkey,
      sectionName: communitySectionName,
    })
  })
  const fallbackEntity = id
    ? makeEventNevent({id, kind, pubkey}, {relays: referenceRelays})
    : new Address(kind, pubkey, identifier, referenceRelays).toNaddr()
  const entity = $derived.by(() => ($quote ? makeEventShareEntityForEvent($quote) : fallbackEntity))

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
  let shareState = $state<"idle" | "copied" | "error">("idle")
  let shareTimeout: ReturnType<typeof setTimeout> | null = null
  let quoteTimedOut = $state(false)

  const isPlainLeftClick = (event: MouseEvent) =>
    event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey

  const openInternalHref = (event: MouseEvent, href: string) => {
    if (!href || typeof window === "undefined") return

    event.stopPropagation()
    if (!isPlainLeftClick(event)) return

    try {
      const target = new URL(href, window.location.origin)
      if (target.origin !== window.location.origin) return

      event.preventDefault()
      isOpenPending = true

      if (!$quote) {
        isOpenPending = false
        return
      }
      void goToEventPath($quote, `${target.pathname}${target.search}${target.hash}`)
        .catch(error => {
          console.error("Failed to open quoted git item", error)
          pushToast({message: "Failed to open quoted git item.", theme: "error"})
        })
        .finally(() => {
          isOpenPending = false
        })
    } catch {
      isOpenPending = false
    }
  }

  const openHrefValue = (href: string) => {
    if (!href || typeof window === "undefined") return

    try {
      const target = new URL(href, window.location.origin)

      if (target.origin !== window.location.origin) {
        window.open(href)
        return
      }

      isOpenPending = true
      if (!$quote) {
        isOpenPending = false
        return
      }
      void goToEventPath($quote, `${target.pathname}${target.search}${target.hash}`)
        .catch(error => {
          console.error("Failed to open quoted git item", error)
          pushToast({message: "Failed to open quoted git item.", theme: "error"})
        })
        .finally(() => {
          isOpenPending = false
        })
    } catch {
      isOpenPending = false
    }
  }

  const openCardHref = (event: MouseEvent, href: string) => {
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return
    event.stopPropagation()
    if (!isPlainLeftClick(event)) return

    event.preventDefault()
    openHrefValue(href)
  }

  const openCardHrefFromKeyboard = (event: KeyboardEvent, href: string) => {
    if (event.key !== "Enter" && event.key !== " ") return
    if (getInteractiveCardTarget(event.target, event.currentTarget)) return

    event.stopPropagation()
    event.preventDefault()
    openHrefValue(href)
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

  const setShareState = (state: "idle" | "copied" | "error") => {
    shareState = state
    if (shareTimeout) clearTimeout(shareTimeout)
    if (state !== "idle") {
      shareTimeout = setTimeout(() => {
        shareState = "idle"
      }, 1500)
    }
  }

  const shareTitle = $derived(
    shareState === "copied" ? "Copied" : shareState === "error" ? "Copy failed" : "Share",
  )

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

  const copyShareLink = async (link: string, event?: Event) => {
    event?.stopPropagation()
    if (!link) return
    if (typeof navigator === "undefined" || !navigator.clipboard) {
      console.warn("Clipboard API not available")
      setShareState("error")
      pushToast({message: "Failed to copy to clipboard", theme: "error", timeout: 3000})
      return
    }
    try {
      await navigator.clipboard.writeText(link)
      setShareState("copied")
      pushToast({message: getCopySuccessMessage(link), timeout: 2000})
    } catch (error) {
      console.error("Failed to copy share link", error)
      setShareState("error")
      pushToast({message: "Failed to copy to clipboard", theme: "error", timeout: 3000})
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
    const tag = getTag(evt, "lines") || getTag(evt, "line")
    if (!tag) return {start: null, end: null}
    const raw = tag[1] || ""
    const parts = raw.split("-")
    const start = Number.parseInt(parts[0] || "", 10)
    const end = Number.parseInt(parts[1] || tag[2] || "", 10)
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

  const highlightPreview = (content: string, language: string) =>
    highlightCodeSnippet(content, language)

  type DiffLine = {type: "+" | "-" | " "; content: string; lineNum: number | null}

  const parseDiffLines = (text: string, startLine: number | null): DiffLine[] => {
    const raw = text.split("\n").map(line => {
      if (line === "…") return {type: " " as const, content: line}
      if (line.startsWith("+")) return {type: "+" as const, content: line.slice(1)}
      if (line.startsWith("-")) return {type: "-" as const, content: line.slice(1)}
      if (line.startsWith(" ")) return {type: " " as const, content: line.slice(1)}
      return {type: " " as const, content: line}
    })
    let oldNum = startLine ?? 1
    let newNum = startLine ?? 1
    return raw.map(r => {
      if (r.content === "…") return {...r, lineNum: null}
      if (r.type === "+") return {...r, lineNum: newNum++}
      if (r.type === "-") return {...r, lineNum: oldNum++}
      oldNum++
      return {...r, lineNum: newNum++}
    })
  }

  const getDiffLineClass = (type: "+" | "-" | " ") => {
    switch (type) {
      case "+":
        return "cq-diff-add"
      case "-":
        return "cq-diff-del"
      default:
        return ""
    }
  }

  const getDisplayRepo = (evt: TrustedEvent, repoAddressOverride = "") => {
    const repoAddress = repoAddressOverride || getTagValue(evt, "repo") || getTagValue(evt, "a")
    if (repoAddress) return getRepoLabelFromAddress(repoAddress)
    return ""
  }

  const getGitRepoAddress = (evt: TrustedEvent) => {
    try {
      return getPreferredRepoPublicationAddress(evt)
    } catch {
      return ""
    }
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

  const isContentTruncated = (evt: TrustedEvent) => (evt?.content?.length || 0) > maxPreviewChars

  const getTagRelayHints = (evt: TrustedEvent, names: string[], value = "") =>
    getQuoteRelayHints(
      ...(evt.tags || [])
        .filter(tag => names.includes(tag[0]) && (!value || tag[1] === value))
        .map(tag => tag.slice(2)),
    )

  const getRepoEventRelayHints = (evt: TrustedEvent, relays: string[] = []) =>
    getQuoteRelayHints(
      relays,
      ...(evt.tags || []).filter(tag => tag[0] === "relays").map(tag => tag.slice(1)),
    )

  const buildRepoHrefFromAddress = (repoAddress: string, relays: string[] = []) => {
    const parsed = parseRepoAddress(repoAddress)
    if (!parsed) return ""

    try {
      const relayHints = getQuoteRelayHints(relays)
      const naddr = nip19.naddrEncode({
        kind: parsed.kind,
        pubkey: parsed.pubkey,
        identifier: parsed.identifier,
        relays: relayHints.length > 0 ? relayHints : undefined,
      })

      return makeGitPath(undefined, naddr)
    } catch {
      return ""
    }
  }

  const buildRepoHrefFromEvent = (evt: TrustedEvent, relays: string[] = []) => {
    if (!evt.pubkey) return ""

    return makeRepoHrefFromEvent(evt, {relays: getRepoEventRelayHints(evt, relays)})
  }

  const getCommentRootId = (evt: TrustedEvent) => getTagValueAny(evt, ["E", "e"])

  const getCommentRootKind = (evt: TrustedEvent) => {
    const raw = getTagValueAny(evt, ["K", "k"])
    const kind = Number.parseInt(raw, 10)
    return Number.isNaN(kind) ? null : kind
  }

  const getCommentContextLabel = (rootKind: number | null) => {
    if (rootKind === GIT_ISSUE) return "Issue"
    if (rootKind === GIT_PULL_REQUEST) return "Pull Request"
    return "Thread"
  }

  const isCommunityCommentRootKind = (rootKind: number | null) =>
    rootKind === THREAD ||
    rootKind === EVENT_DATE ||
    rootKind === EVENT_TIME ||
    rootKind === ZAP_GOAL

  const getCommentPreview = (evt: TrustedEvent) => {
    const text = evt?.content || ""
    if (!text) return ""
    const main = text.split("\n---\n")[0]
    return truncateText(main)
  }

  const getIssuePreview = (evt: TrustedEvent) => truncateText(evt?.content || "")

  const getPullRequestPreview = (evt: TrustedEvent) => {
    const commit = getTagValue(evt, "commit")
    if (commit) return `Commit ${commit.slice(0, 8)}`
    const baseBranch = getTagValue(evt, "base-branch")
    if (baseBranch) return `Base ${baseBranch}`
    return ""
  }

  const getRepoPreview = (evt: TrustedEvent) => truncateText(getTagValue(evt, "description"))

  const getRepoCommunityMeta = (evt: TrustedEvent) => {
    const community = parseRepoCommunityBinding(evt)
    const pointer = community ? parseCommunityDefinitionAddress(community.address) : undefined
    if (!pointer) return ""
    return `Community: ${pointer.ownerPubkey.slice(0, 6)}:${pointer.communityId.slice(0, 6)}...`
  }

  const getGitShareCard = (evt: TrustedEvent, relays: string[] = []) => {
    if (!evt) return null
    if (evt.kind === GIT_REPO_ANNOUNCEMENT || evt.kind === GIT_REPO_STATE) {
      return {
        label: "Repository",
        title: getTagValue(evt, "name") || getTagValue(evt, "d") || "Repository",
        meta: [getRepoCommunityMeta(evt)].filter(Boolean) as string[],
        preview: getRepoPreview(evt),
        href: buildRepoHrefFromEvent(evt, relays),
      }
    }

    if (evt.kind === GIT_ISSUE) {
      const repoAddress = getTagValue(evt, "a")
      const repoLabel = getDisplayRepo(evt, repoAddress)
      const baseHref = buildRepoHrefFromAddress(
        repoAddress,
        getQuoteRelayHints(relays, getTagRelayHints(evt, ["a"], repoAddress)),
      )
      return {
        label: "Issue",
        title: getTagValue(evt, "subject") || "Issue",
        meta: repoLabel ? [repoLabel] : [],
        preview: getIssuePreview(evt),
        href: baseHref ? `${baseHref}/issues/${evt.id}` : "",
      }
    }

    if (evt.kind === GIT_PULL_REQUEST) {
      const repoAddress = getTagValue(evt, "a")
      const repoLabel = getDisplayRepo(evt, repoAddress)
      const baseHref = buildRepoHrefFromAddress(
        repoAddress,
        getQuoteRelayHints(relays, getTagRelayHints(evt, ["a"], repoAddress)),
      )
      return {
        label: "Pull Request",
        title: getTagValue(evt, "subject") || "Pull Request",
        meta: repoLabel ? [repoLabel] : [],
        preview: getPullRequestPreview(evt),
        href: baseHref ? `${baseHref}/prs/${evt.id}` : "",
      }
    }

    if (evt.kind === GIT_COMMENT) {
      const rootKind = getCommentRootKind(evt)
      if (isCommunityCommentRootKind(rootKind)) return null
      if (rootKind !== GIT_ISSUE && rootKind !== GIT_PULL_REQUEST) return null

      const repoAddress = getGitRepoAddress(evt)
      const repoLabel = getDisplayRepo(evt, repoAddress)
      const rootId = getCommentRootId(evt)
      const contextLabel = getCommentContextLabel(rootKind)
      const baseHref = buildRepoHrefFromAddress(
        repoAddress,
        getQuoteRelayHints(relays, getTagRelayHints(evt, ["A", "a", "q", "repo"], repoAddress)),
      )
      if (!baseHref) return null
      const filePath = getFilePath(evt)
      const line = getLineRange(evt)
      const targetLine = line.end || line.start
      const inlineLocationLabel = filePath
        ? `${filePath}${targetLine ? `:${line.start && line.end && line.end !== line.start ? `${line.start}-${line.end}` : targetLine}` : ""}`
        : ""
      let href = ""
      if (baseHref) {
        if (rootKind === GIT_ISSUE) {
          href = `${baseHref}/issues/${rootId}#comment-${evt.id}`
        } else if (rootKind === GIT_PULL_REQUEST) {
          href = `${baseHref}/prs/${rootId}#comment-${evt.id}`
        } else if (rootId) {
          href = `${baseHref}#comment-${evt.id}`
        } else {
          href = baseHref
        }
      }
      return {
        label: filePath ? "Inline Comment" : "Comment",
        title: filePath ? `Inline comment on ${contextLabel}` : `Comment on ${contextLabel}`,
        meta: [repoLabel, inlineLocationLabel].filter(Boolean),
        preview: getCommentPreview(evt),
        href,
      }
    }

    return null
  }

  const buildPermalinkHref = (evt: TrustedEvent, relays: string[] = [], diffHash = "") => {
    const repoTag = getTagValue(evt, "repo")
    const repoAddress = getTagValue(evt, "a") || (parseRepoAddress(repoTag) ? repoTag : "")
    const base = buildRepoHrefFromAddress(
      repoAddress,
      getQuoteRelayHints(relays, getTagRelayHints(evt, ["a"], repoAddress)),
    )
    if (!base) return ""
    const commit = getTagValue(evt, "commit")
    const parentCommit = getTagValue(evt, "parent-commit")
    const filePath = getFilePath(evt)
    const {start, end} = getLineRange(evt)
    const lineAnchor = start ? `#L${start}${end && end !== start ? `-L${end}` : ""}` : ""
    const prId = getTagValue(evt, "e")
    const diffAnchor = diffHash
      ? `#diff-${diffHash}${start ? `R${start}${end && end !== start ? `-R${end}` : ""}` : ""}`
      : ""

    if (parentCommit) {
      if (filePath && !diffHash) return ""
      if (commit) return `${base}/commits/${commit}${diffAnchor}`
      if (prId) return `${base}/prs/${prId}${diffAnchor}`
      return `${base}${diffAnchor}`
    }
    if (filePath) return `${base}/code?path=${encodeURIComponent(filePath)}${lineAnchor}`
    if (commit) return `${base}/commits/${commit}`
    if (prId) return `${base}/prs/${prId}`
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

  $effect(() => {
    const target = idOrAddress
    const quoteEvent = $quote

    quoteTimedOut = false
    if (quoteEvent || !target) return

    const timeout = window.setTimeout(() => {
      quoteTimedOut = true
    }, 7000)

    return () => window.clearTimeout(timeout)
  })

  const gitCard = $derived.by(() => ($quote ? getGitShareCard($quote, mergedRelays) : null))
  const smartWidget = $derived.by<SmartWidgetEvent | undefined>(() => {
    if (!$quote || $quote.kind !== SMART_WIDGET_KIND) return undefined

    try {
      return parseSmartWidget($quote)
    } catch (error) {
      console.warn("Failed to parse quoted Smart Widget", error)
      return undefined
    }
  })
  const smartWidgetId = $derived(smartWidget ? getWidgetLineId(smartWidget) : "")
  const smartWidgetInstalled = $derived(
    Boolean(smartWidgetId && $effectiveExtensionSettings.installed?.widget?.[smartWidgetId]),
  )
  let smartWidgetInstalling = $state(false)

  const installSmartWidget = async (clickEvent: Event) => {
    clickEvent.preventDefault()
    clickEvent.stopPropagation()
    if (!$quote || !smartWidget || smartWidgetInstalled || smartWidgetInstalling) return

    smartWidgetInstalling = true
    try {
      const installed = installWidgetFromEvent($quote, {
        naddr: fallbackEntity,
        relays: mergedRelays,
      })
      await enableExtension(getWidgetLineId(installed))
      clearCommunityWidgetSlotCache()
      pushToast({
        theme: "success",
        message: `Installed and enabled widget ${installed.content || installed.identifier}`,
      })
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Install failed",
      })
    } finally {
      smartWidgetInstalling = false
    }
  }

  const handlePermalinkOpen = (event: MouseEvent, href: string) => {
    openInternalHref(event, href)
  }
</script>

{#snippet shareButton()}
  <GitButton
    variant="outline"
    size="sm"
    class="w-9 shrink-0 justify-center p-0"
    onclick={event => copyShareLink(entity, event)}
    disabled={!entity}
    data-stop-link
    data-stop-tap
    aria-label="Share"
    title={shareTitle}>
    <Icon icon={ShareCircle} size={4} />
  </GitButton>
{/snippet}

{#if censorReason}
  <div class="my-2 block w-full max-w-full text-left">
    <ModeratedContent reason={censorReason} compact />
  </div>
{:else if $quote && $quote.kind === 1623}
  {@const permalinkHref = buildPermalinkHref($quote, mergedRelays, diffHash)}
  {@const displayRepo = getDisplayRepo($quote)}
  {@const filePath = getFilePath($quote)}
  {@const lineLabel = getLineLabel($quote)}
  {@const commitShort = getCommitShort($quote)}
  {@const parentCommit = getTagValue($quote, "parent-commit")}
  {@const isDiff = Boolean(parentCommit)}
  {@const kindLabel = isDiff ? "Diff" : "Code"}
  {@const kindTitle = isDiff ? "Diff permalink" : "Code permalink"}
  {@const kindIcon = isDiff ? GitCommit : FileCode}
  {@const KindIcon = kindIcon}
  {@const kindIconClass = isDiff ? "text-amber-500" : "text-blue-500"}
  {@const kindBadgeClass = isDiff
    ? "bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/20"
    : "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/20"}
  {@const contentPreview = getContentPreview($quote)}
  {@const isTruncated = isContentTruncated($quote)}
  {@const highlightLanguage = filePath ? getHighlightLanguageForPath(filePath) : "plaintext"}
  <div class="my-2 block w-full max-w-full text-left">
    <div class="rounded-lg border bg-card p-3 shadow-sm">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div class="flex min-w-0 items-start gap-2">
          <KindIcon class={`mt-0.5 h-4 w-4 ${kindIconClass}`} />
          <div class="min-w-0">
            <div class="flex min-w-0 flex-wrap items-center gap-2">
              <div class="text-sm font-semibold">{kindTitle}</div>
              <span
                class={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${kindBadgeClass}`}>
                {kindLabel}
              </span>
            </div>
            <div
              class="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {#if displayRepo}
                <span class="max-w-full truncate font-mono" title={displayRepo}>{displayRepo}</span>
              {/if}
              {#if filePath}
                <span class="max-w-full truncate font-mono" title={filePath}>{filePath}</span>
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
        <div
          class="grid w-full grid-cols-[2.25rem_minmax(0,1fr)_minmax(0,1fr)] gap-2 sm:flex sm:w-auto sm:flex-nowrap sm:items-center">
          {@render shareButton()}
          {#if permalinkHref}
            <GitButton
              variant="outline"
              size="sm"
              class="min-w-0 shrink-0 justify-center sm:w-auto"
              href={permalinkHref}
              onclick={event => handlePermalinkOpen(event, permalinkHref)}
              aria-busy={isOpenPending}>
              {#if isOpenPending}
                <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
              {/if}
              Open
            </GitButton>
          {/if}
          <GitButton
            variant="outline"
            size="sm"
            class="min-w-0 shrink-0 justify-center sm:w-auto"
            onclick={() => copyPermalinkContent($quote)}
            disabled={!$quote?.content}
            aria-live="polite">
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
        {@const lineRange = getLineRange($quote)}
        {@const diffLines = isDiff ? parseDiffLines(contentPreview, lineRange.start) : []}
        {@const codeLines = !isDiff
          ? contentPreview
              .split("\n")
              .map((l, i) => ({num: (lineRange.start ?? 1) + i, content: l}))
          : []}
        {@const highlightedDiffLines = highlightCodeLines(
          diffLines.map(line => line.content),
          highlightLanguage,
        )}
        {@const highlightedCodeLines = highlightCodeLines(
          codeLines.map(line => line.content),
          highlightLanguage,
        )}
        <div
          class="permalink-preview mt-3 max-w-full overflow-x-auto rounded border border-border/40 bg-muted/30">
          {#if isDiff && diffLines.length > 0}
            <div class="cq-snippet-lines">
              {#each diffLines as line, index}<div
                  class="cq-snippet-line {getDiffLineClass(line.type)}">
                  <span class="cq-snippet-num">{line.lineNum ?? ""}</span><span
                    class="cq-snippet-diff-ind">{line.type === " " ? "\u00a0" : line.type}</span>
                  <pre class="cq-snippet-code"><span class="hljs"
                      >{@html highlightedDiffLines[index] ??
                        highlightPreview(line.content, highlightLanguage)}</span></pre>
                </div>{/each}
            </div>
          {:else if codeLines.length > 0}
            <div class="cq-snippet-lines">
              {#each codeLines as line, index}<div class="cq-snippet-line">
                  <span class="cq-snippet-num">{line.num}</span>
                  <pre class="cq-snippet-code"><span class="hljs"
                      >{@html highlightedCodeLines[index] ??
                        highlightPreview(line.content, highlightLanguage)}</span></pre>
                </div>{/each}
            </div>
          {/if}
          {#if isTruncated}
            <div class="px-3 pb-2 pt-1 text-[11px] text-muted-foreground">Excerpt truncated</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{:else if smartWidget}
  <div class="my-2 block w-full min-w-0 max-w-full text-left" data-smart-widget-quote>
    <div class="w-full min-w-0 rounded-lg border bg-card p-3 shadow-sm">
      <div class="flex min-w-0 items-start gap-3">
        <div class="rounded-lg bg-primary/10 p-2 text-primary">
          <ExtensionIcon
            icon={smartWidget.iconUrl || smartWidget.imageUrl || "Puzzle"}
            size={22}
            class="h-[22px] w-[22px] object-cover" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <strong class="truncate text-sm"
              >{smartWidget.content || smartWidget.identifier}</strong>
            <span class="badge badge-outline badge-sm">Smart Widget</span>
            <span class="badge badge-ghost badge-sm capitalize">{smartWidget.widgetType}</span>
          </div>
          <div class="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs opacity-70">
            <span class="truncate font-mono">{smartWidget.identifier}</span>
            {#if smartWidget.slot?.label}
              <span>{smartWidget.slot.label}</span>
            {/if}
          </div>
          {#if smartWidget.pubkey}
            <div class="mt-2 flex items-center gap-1 text-xs opacity-80">
              <span>Published by</span>
              <ProfileLink
                pubkey={smartWidget.pubkey}
                relays={mergedRelays}
                unstyled
                class="underline" />
            </div>
          {/if}
          {#if smartWidget.permissions?.length}
            <div class="mt-2 text-xs opacity-70">
              Requests: {smartWidget.permissions.join(", ")}
            </div>
          {/if}
        </div>
      </div>
      <div class="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button
          class="btn btn-square btn-ghost btn-sm"
          onclick={event => copyShareLink(entity, event)}
          aria-label="Share"
          title={shareTitle}
          data-stop-tap>
          <Icon icon={ShareCircle} size={4} />
        </Button>
        <Button
          class="btn btn-primary btn-sm"
          onclick={installSmartWidget}
          disabled={smartWidgetInstalled || smartWidgetInstalling}
          data-stop-tap>
          {smartWidgetInstalled
            ? "Installed"
            : smartWidgetInstalling
              ? "Installing..."
              : "Install Widget"}
        </Button>
      </div>
    </div>
  </div>
{:else if gitCard}
  {@const openHref = gitCard.href || entityLink(entity)}
  {@const isCommentQuote = $quote?.kind === GIT_COMMENT}
  <div class="my-2 block w-full min-w-0 max-w-full text-left">
    <div
      class="w-full min-w-0 cursor-pointer rounded-lg border bg-card p-3 shadow-sm"
      role="link"
      tabindex="0"
      onclick={event => openCardHref(event, openHref)}
      onkeydown={event => openCardHrefFromKeyboard(event, openHref)}>
      <div
        class={isCommentQuote
          ? "grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3"
          : "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"}>
        <div class="min-w-0">
          <div class="text-sm font-semibold">{gitCard.label}</div>
          {#if gitCard.meta?.length}
            <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {#each gitCard.meta as item}
                <span class="max-w-full truncate font-mono" title={item}>{item}</span>
              {/each}
            </div>
          {/if}
        </div>
        {#if isCommentQuote}
          {@render shareButton()}
        {/if}
        <div
          class={isCommentQuote
            ? "col-span-2 grid w-full grid-cols-1"
            : "grid w-full grid-cols-[2.25rem_minmax(0,1fr)] gap-2 sm:flex sm:w-auto sm:flex-nowrap sm:items-center"}>
          {#if !isCommentQuote}
            {@render shareButton()}
          {/if}
          <GitButton
            variant="outline"
            size="sm"
            class="min-w-0 shrink-0 justify-center sm:w-auto"
            href={openHref}
            onclick={event => openInternalHref(event, openHref)}
            aria-busy={isOpenPending}>
            {#if isOpenPending}
              <span class="loading loading-spinner loading-xs" aria-hidden="true"></span>
            {/if}
            Open
          </GitButton>
        </div>
      </div>
      {#if gitCard.title}
        <div class="mt-2 line-clamp-2 text-sm font-medium">{gitCard.title}</div>
      {/if}
      {#if gitCard.preview}
        <div class="mt-2 line-clamp-3 text-sm text-muted-foreground">{gitCard.preview}</div>
      {/if}
    </div>
  </div>
{:else if quoteTimedOut}
  <Button class="my-2 block w-full max-w-full text-left" {onclick}>
    <div class="rounded-box p-4 text-sm text-muted-foreground">
      <div class="font-medium text-foreground">Unable to load quoted event</div>
      <div class="mt-1">Open the link to retry with the full relay context.</div>
    </div>
  </Button>
{:else}
  <Button class="my-2 block w-full max-w-full text-left" {onclick}>
    {#if $quote}
      {#if $quote.kind === MESSAGE}
        <div
          class="border-l-2 border-solid border-l-primary py-1 pl-2 opacity-90"
          style="background-color: color-mix(in srgb, var(--primary) 10%, var(--base-300) 90%);">
          <div class="line-clamp-3 max-h-12 overflow-hidden" data-quoted-event-preview>
            <NoteContentMinimal trimParent {url} event={$quote} />
          </div>
        </div>
      {:else}
        <NoteCard event={$quote} {url} class="bg-alt rounded-box p-4">
          <div class="line-clamp-3 max-h-12 overflow-hidden" data-quoted-event-preview>
            <NoteContentMinimal {url} event={$quote} />
          </div>
        </NoteCard>
      {/if}
    {:else}
      <div class="rounded-box p-4">
        <Spinner loading>Loading event...</Spinner>
      </div>
    {/if}
  </Button>
{/if}
