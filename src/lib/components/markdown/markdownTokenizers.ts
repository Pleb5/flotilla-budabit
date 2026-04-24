/**
 * Markdown tokenizers for custom inline elements
 */

import type {TokenizerAndRendererExtension, Tokens} from "marked"
import {nip19} from "nostr-tools"
import type {TrustedEvent} from "@welshman/util"
import {shortenNostrUri} from "./markdownUtils.js"

export interface NostrTokenizerOptions {
  event?: TrustedEvent
  url?: string
  minimalQuote?: boolean
  depth?: number
  hideMediaAtDepth?: number
}

export interface EmailTokenizerOptions {
  // Future: add options if needed
}

const NOSTR_INLINE_REGEX = /(?:nostr:\s*)?n(?:event|ote|pub|profile|addr)1[ac-hj-np-z02-9]{6,}/g
const NOSTR_START_REGEX = /^(?:nostr:\s*)?(n(?:event|ote|pub|profile|addr)1[ac-hj-np-z02-9]{6,})/
const ALLOWED_BOUNDARY_BEFORE = new Set([
  "",
  " ",
  "\t",
  "\n",
  "\r",
  "(",
  "[",
  "{",
  "<",
  '"',
  "'",
  "`",
])
const ALLOWED_BOUNDARY_AFTER = new Set([
  "",
  " ",
  "\t",
  "\n",
  "\r",
  ")",
  "]",
  "}",
  ">",
  '"',
  "'",
  "`",
  ".",
  ",",
  "!",
  "?",
  ";",
  ":",
])

const hasValidBoundaryBefore = (src: string, index: number) =>
  ALLOWED_BOUNDARY_BEFORE.has(index > 0 ? src[index - 1] : "")

const hasValidBoundaryAfter = (src: string, index: number) => {
  const char = index < src.length ? src[index] : ""
  const nextChar = index + 1 < src.length ? src[index + 1] : ""

  if (char === "?" || char === "#") {
    return nextChar === "" || /\s|[)}\]>"'`.,!?;:]/.test(nextChar)
  }

  return ALLOWED_BOUNDARY_AFTER.has(char)
}

const findStandaloneNostrStart = (src: string) => {
  NOSTR_INLINE_REGEX.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = NOSTR_INLINE_REGEX.exec(src))) {
    const index = match.index
    const raw = match[0]

    if (!hasValidBoundaryBefore(src, index)) continue
    if (!hasValidBoundaryAfter(src, index + raw.length)) continue

    return index
  }

  return -1
}

/**
 * Creates a Nostr tokenizer extension
 */
export function createNostrTokenizer(
  options: NostrTokenizerOptions = {},
): TokenizerAndRendererExtension {
  const {event, url, minimalQuote = false, depth = 0, hideMediaAtDepth = 1} = options

  return {
    name: "nostr",
    level: "inline",
    start(src: string) {
      return findStandaloneNostrStart(src)
    },
    tokenizer(src: string) {
      const match = NOSTR_START_REGEX.exec(src)
      if (match) {
        const [fullMatch, fullId] = match

        if (!hasValidBoundaryAfter(src, fullMatch.length)) return

        return {
          type: "nostr",
          raw: fullMatch,
          text: fullMatch,
          fullId: fullId,
          prefix: "",
          userName: null,
          tokens: [],
        }
      }
    },
    renderer(token: Tokens.Generic) {
      const {fullId, userName, pubkey} = token
      let linkUrl = `/${fullId}`
      let external = false

      try {
        const decoded = nip19.decode(fullId)
        const decodedType = decoded.type as string

        // For note, nevent and naddr, use ContentQuote if event is provided
        if (event && decodedType === "note") {
          const noteId = decoded.data as unknown as string
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
        }

        if (event && decodedType === "nevent") {
          const eventData = decoded.data as any
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
        }

        if (event && decodedType === "naddr") {
          const addrData = decoded.data as any
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

        // Handle other Nostr entity types
        switch (decodedType) {
          case "note":
            linkUrl = `https://coracle.social/notes/${fullId}`
            external = true
            break
          case "nevent":
            linkUrl = `https://coracle.social/notes/${fullId}`
            external = true
            break
          case "nprofile":
            external = true
            linkUrl = `https://coracle.social/people/${fullId}`
            if (pubkey) {
              return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
            }
            break
          case "npub":
            linkUrl = `/people/${fullId}`
            if (pubkey) {
              return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
            }
            break
          case "naddr":
            external = true
            linkUrl = `https://coracle.social/${fullId}`
            break
        }
      } catch (err) {
        console.error("Failed to decode in renderer:", err, fullId)
        linkUrl = `/${fullId}`
      }

      const linkText = userName ? `@${userName}` : shortenNostrUri("", fullId)
      const externalAttributes = external ? 'target="_blank" rel="noopener noreferrer"' : ""
      return `<a href="${linkUrl}" ${externalAttributes} class="link" title="${fullId}">${linkText}</a>`
    },
  }
}

/**
 * Creates an email tokenizer extension
 */
export function createEmailTokenizer(
  _options: EmailTokenizerOptions = {},
): TokenizerAndRendererExtension {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+/

  return {
    name: "email",
    level: "inline",
    start(src: string) {
      const match = src.match(emailRegex)
      return match ? match.index! : -1
    },
    tokenizer(src: string) {
      const match = emailRegex.exec(src)
      if (match) {
        const [fullMatch] = match
        return {
          type: "email",
          raw: fullMatch,
          text: fullMatch,
          href: `mailto:${fullMatch}`,
          isNip05: false,
          tokens: [],
        }
      }
    },
    renderer(token: Tokens.Generic) {
      if (token.isNip05) {
        const {pubkey} = token
        if (pubkey) {
          return `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`
        }
        return `<a href="mailto:${token.text}" class="link">${token.text}</a>`
      } else {
        return `<a href="${token.href}" class="link">${token.text}</a>`
      }
    },
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
