/**
 * Custom renderers for marked
 */

import type {Tokens, Renderer} from "marked"
import {nip19} from "nostr-tools"
import hljs from "highlight.js"
import type {TrustedEvent} from "@welshman/util"
import {shortenUrl, isMediaUrl} from "./markdownUtils.js"
import {parseNcommunityLink} from "@app/util/community-links"
import type {ParsedCommunityInput} from "@app/core/community"
import {getCashuTokenInfo} from "@app/util/cashu-token"

export interface RendererOptions {
  event?: TrustedEvent
  url?: string
  minimalQuote?: boolean
  depth?: number
  hideMediaAtDepth?: number
  communitySectionName?: string
}

/**
 * Creates custom renderers for marked
 */
export function createRenderers(options: RendererOptions = {}): Partial<Renderer> {
  const {event, url, minimalQuote = false, depth = 0, hideMediaAtDepth = 1} = options
  const renderInlineTokens = (renderer: Renderer, tokens: Tokens.Generic[]) => {
    const parser = (renderer as any).parser

    if (parser?.parseInline) return parser.parseInline(tokens)
    if (parser?.parse) return parser.parse(tokens)

    return ""
  }

  const createStandaloneLinkPreview = (link: Tokens.Link) => {
    if (!event || !isPreviewableUrl(link.href)) return ""

    return createLinkBlockPlaceholder(link.href, event.id)
  }

  const splitLines = (tokens: Tokens.Generic[] = []) => {
    const lines: Tokens.Generic[][] = [[]]

    for (const token of tokens) {
      if (token.type === "br") {
        lines.push([])
      } else {
        lines[lines.length - 1].push(token)
      }
    }

    return lines
  }

  const getOnlyLink = (tokens: Tokens.Generic[] = []) => {
    const contentTokens = tokens.filter(
      token => !(token.type === "text" && `${token.text || ""}`.trim() === ""),
    )

    return contentTokens.length === 1 && contentTokens[0].type === "link"
      ? (contentTokens[0] as Tokens.Link)
      : null
  }

  const getTrailingLineLink = (tokens: Tokens.Generic[] = []) => {
    const link = tokens[tokens.length - 1]
    const lineBreak = tokens[tokens.length - 2]
    const prefixTokens = tokens.slice(0, -2)

    if (!link || link.type !== "link" || lineBreak?.type !== "br" || prefixTokens.length === 0) {
      return null
    }

    return {link: link as Tokens.Link, prefixTokens}
  }

  const renderParagraphLinesWithLinkPreviews = (renderer: Renderer, tokens: Tokens.Generic[]) => {
    const lines = splitLines(tokens)
    const renderedLines = lines.map(line => {
      const onlyLink = getOnlyLink(line)
      const preview = onlyLink ? createStandaloneLinkPreview(onlyLink) : ""

      return preview || (line.length > 0 ? `<p>${renderInlineTokens(renderer, line)}</p>` : "")
    })

    return renderedLines.some(line => line.includes("markdown-link-block-placeholder"))
      ? renderedLines.join("")
      : ""
  }

  return {
    paragraph(this: Renderer, token: Tokens.Paragraph): string {
      const linePreviews = renderParagraphLinesWithLinkPreviews(
        this,
        token.tokens as Tokens.Generic[],
      )
      if (linePreviews) return linePreviews

      const onlyLink = getOnlyLink(token.tokens as Tokens.Generic[])
      if (onlyLink) {
        const preview = createStandaloneLinkPreview(onlyLink)
        if (preview) return preview
      }

      const trailingLineLink = getTrailingLineLink(token.tokens as Tokens.Generic[])
      if (trailingLineLink) {
        const preview = createStandaloneLinkPreview(trailingLineLink.link)
        if (preview) {
          const prefix = renderInlineTokens(this, trailingLineLink.prefixTokens)

          return `<p>${prefix}</p>${preview}`
        }
      }

      return `<p>${renderInlineTokens(this, token.tokens as Tokens.Generic[])}</p>`
    },

    image(token: Tokens.Image): string {
      const {href, title, text} = token
      const alt = text || title || ""
      return `<img src="${href}" alt="${alt}" class="my-4 h-auto max-w-full rounded-lg" />`
    },

    link(token: Tokens.Link): string {
      const {href, text} = token

      const cashu = getCashuTokenInfo(href)
      if (cashu) {
        return createCashuPlaceholder(cashu.token)
      }

      const community = parseNcommunityLink(href)
      if (community) {
        return createCommunityPlaceholder(community)
      }

      // Check if href is a nostr URI
      const nostrMatch = href.match(
        /^(?:nostr:\s*)?(n(?:event|ote|pub|profile|addr)1[ac-hj-np-z02-9]{6,})$/,
      )
      if (nostrMatch) {
        return renderNostrLink(
          nostrMatch[1],
          text,
          event,
          url,
          minimalQuote,
          depth,
          hideMediaAtDepth,
        )
      }

      // Regular URL handling
      // Inline links should stay inline. Paragraph rendering promotes links that are on their
      // own line to previews so normal prose does not get split by a block card.
      const displayText = shortenUrl(href, text)
      return `<a href="${href}" class="link" title="${href}" target="_blank" rel="noopener noreferrer">${displayText}</a>`
    },

    list(this: Renderer, token: Tokens.List): string {
      const listItems: string = token.items
        .map((item): string => {
          const itemContent: string = this.parser.parse(item.tokens)
          return `<li>${itemContent}</li>`
        })
        .join("\n")

      return token.ordered ? `<ol>${listItems}</ol>` : `<ul>${listItems}</ul>`
    },

    code(token: Tokens.Code): string {
      const validLang = token.lang || "plaintext"
      const highlightedCode = hljs.highlight(token.text, {
        language: validLang,
      }).value

      return `<pre class="hljs"><code class="language-${validLang}">${highlightedCode}</code></pre>`
    },
  }
}

function isPreviewableUrl(url: string): boolean {
  return /^(https?:)?\/\//i.test(url) || isMediaUrl(url)
}

function createLinkBlockPlaceholder(href: string, eventId: string): string {
  return `<span class="markdown-link-block-placeholder" data-url="${href}" data-event-id="${eventId}"></span>`
}

function createCashuPlaceholder(token: string): string {
  return `<span class="markdown-cashu-placeholder" data-token="${encodeURIComponent(token)}"></span>`
}

/**
 * Renders a Nostr link
 */
function renderNostrLink(
  fullId: string,
  text: string | undefined,
  event: TrustedEvent | undefined,
  url: string | undefined,
  minimalQuote: boolean,
  depth: number,
  hideMediaAtDepth: number,
): string {
  try {
    const result: any = nip19.decode(fullId)

    if (result.type === "nprofile" || result.type === "npub") {
      let pubkey = ""
      let relays: string[] = []
      if (result.type === "nprofile") {
        pubkey = result.data.pubkey
        relays = Array.isArray(result.data.relays) ? result.data.relays : []
      } else if (result.type === "npub") {
        pubkey = result.data
      }

      if (pubkey) {
        const relayData = encodeURIComponent(JSON.stringify(relays))
        return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url="" data-relays="${relayData}"></span>`
      }
    }

    // For note, nevent and naddr, use ContentQuote if event is provided
    if (event && (result.type === "note" || result.type === "nevent" || result.type === "naddr")) {
      if (result.type === "note") {
        const noteId = result.data as string
        if (noteId) {
          return createQuotePlaceholder({
            type: "note",
            id: noteId,
            relays: [],
            eventId: event.id,
            url: url || "",
            minimal: minimalQuote,
            depth,
            hideMedia: hideMediaAtDepth,
          })
        }
      } else if (result.type === "nevent") {
        const eventData = result.data as any
        const eventId = eventData?.id
        if (eventId) {
          const relays = eventData.relays || []
          return createQuotePlaceholder({
            type: "nevent",
            id: eventId,
            relays,
            eventId: event.id,
            url: url || "",
            minimal: minimalQuote,
            depth,
            hideMedia: hideMediaAtDepth,
          })
        }
      } else if (result.type === "naddr") {
        const addrData = result.data as any
        if (addrData?.kind && addrData?.pubkey && addrData?.identifier !== undefined) {
          const relays = addrData.relays || []
          return createNaddrQuotePlaceholder({
            kind: addrData.kind,
            pubkey: addrData.pubkey,
            identifier: addrData.identifier,
            relays,
            eventId: event.id,
            url: url || "",
            minimal: minimalQuote,
            depth,
            hideMedia: hideMediaAtDepth,
          })
        }
      }
    }

    // Fallback to regular link if no event or not nevent/naddr
    let linkUrl = `/${fullId}`
    let external = false

    if (result.type === "nevent" || result.type === "note") {
      linkUrl = `https://coracle.social/notes/${fullId}`
      external = true
    } else if (result.type === "naddr") {
      const data = result.data as any
      if (data.kind === 30617) {
        linkUrl = `/${fullId}`
      } else {
        external = true
        linkUrl = `https://coracle.social/${fullId}`
      }
    }

    const externalAttributes = external ? 'target="_blank" rel="noopener noreferrer"' : ""
    const linkText = text || fullId
    return `<a href="${linkUrl}" ${externalAttributes} class="link" title="${fullId}">${linkText}</a>`
  } catch (err) {
    console.error("Failed to decode nostr link:", err, fullId)
    return `<a href="/${fullId}" class="link">${fullId}</a>`
  }
}

function createCommunityPlaceholder(community: ParsedCommunityInput): string {
  const relaysAttr = JSON.stringify(community.relays || []).replace(/"/g, "&quot;")

  return `<span class="markdown-community-placeholder" data-pubkey="${community.pubkey}" data-relays="${relaysAttr}"></span>`
}

/**
 * Helper to create quote placeholder HTML
 */
function createQuotePlaceholder(options: {
  type: "note" | "nevent"
  id: string
  relays: string[]
  eventId: string
  url: string
  minimal: boolean
  depth: number
  hideMedia: number
}): string {
  const {type, id, relays, eventId, url, minimal, depth, hideMedia} = options
  const relaysAttr = JSON.stringify(relays).replace(/"/g, "&quot;")
  return `<span class="markdown-quote-placeholder" data-type="${type}" data-id="${id}" data-relays="${relaysAttr}" data-event-id="${eventId}" data-url="${url}" data-minimal="${minimal}" data-depth="${depth}" data-hide-media="${hideMedia}"></span>`
}

/**
 * Helper to create naddr quote placeholder HTML
 */
function createNaddrQuotePlaceholder(options: {
  kind: number
  pubkey: string
  identifier: string
  relays: string[]
  eventId: string
  url: string
  minimal: boolean
  depth: number
  hideMedia: number
}): string {
  const {kind, pubkey, identifier, relays, eventId, url, minimal, depth, hideMedia} = options
  const relaysAttr = JSON.stringify(relays).replace(/"/g, "&quot;")
  return `<span class="markdown-quote-placeholder" data-type="naddr" data-kind="${kind}" data-pubkey="${pubkey}" data-identifier="${identifier}" data-relays="${relaysAttr}" data-event-id="${eventId}" data-url="${url}" data-minimal="${minimal}" data-depth="${depth}" data-hide-media="${hideMedia}"></span>`
}
