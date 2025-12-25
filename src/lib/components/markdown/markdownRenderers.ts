/**
 * Custom renderers for marked
 */

import type {Tokens, Renderer} from "marked"
import {nip19} from "nostr-tools"
import hljs from "highlight.js"
import type {TrustedEvent} from "@welshman/util"
import {shortenUrl, isMediaUrl, isStandaloneUrl} from "./markdownUtils.js"

export interface RendererOptions {
  event?: TrustedEvent
  url?: string
  minimalQuote?: boolean
  depth?: number
  hideMediaAtDepth?: number
}

/**
 * Creates custom renderers for marked
 */
export function createRenderers(options: RendererOptions = {}): Partial<Renderer> {
  const {event, url, minimalQuote = false, depth = 0, hideMediaAtDepth = 1} = options

  return {
    image(token: Tokens.Image): string {
      const {href, title, text} = token
      const alt = text || title || ""
      return `<img src="${href}" alt="${alt}" class="my-4 h-auto max-w-full rounded-lg" />`
    },

    link(token: Tokens.Link): string {
      const {href, text} = token

      // Check if href is a nostr URI
      const nostrMatch = href.match(/^(nostr:)?(n(?:event|ote|pub|profile|addr)1[ac-hj-np-z02-9]{6,})$/)
      if (nostrMatch) {
        return renderNostrLink(nostrMatch[2], text, event, url, minimalQuote, depth, hideMediaAtDepth)
      }

      // Regular URL handling
      const isMedia = isMediaUrl(href)
      const isStandalone = isStandaloneUrl(text, href)

      // Use ContentLinkBlock for media URLs or standalone URLs (when event is provided)
      if (event && (isMedia || isStandalone)) {
        return `<span class="markdown-link-block-placeholder" data-url="${href}" data-event-id="${event.id}"></span>`
      }

      // For inline links, render as regular link
      const displayText = shortenUrl(href, text)
      return `<a href="${href}" class="link" title="${href}" target="_blank" rel="noopener noreferrer">${displayText}</a>`
    },

    list(this: Renderer, token: Tokens.List): string {
      const listItems: string = token.items
        .map((item): string => {
          const itemContent: string = this.parser.parseInline(item.tokens)
          return `<li>${itemContent}</li>`
        })
        .join("\n")

      const listClass = token.ordered ? "list-decimal list-inside" : "list-disc list-inside"

      return token.ordered
        ? `<ol class="${listClass}">${listItems}</ol>`
        : `<ul class="${listClass}">${listItems}</ul>`
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
      if (result.type === "nprofile") {
        pubkey = result.data.pubkey
      } else if (result.type === "npub") {
        pubkey = result.data
      }

      if (pubkey) {
        return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
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

