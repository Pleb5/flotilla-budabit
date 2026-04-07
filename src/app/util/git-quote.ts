import type {TrustedEvent} from "@welshman/util"
import {getTagValue} from "@welshman/util"
import {parse, isAddress, isEvent, isNewline, isText} from "@welshman/content"
import type {Parsed} from "@welshman/content"
import {
  GIT_COMMENT,
  GIT_ISSUE,
  GIT_PATCH,
  GIT_PULL_REQUEST,
  GIT_REPO_ANNOUNCEMENT,
  GIT_REPO_STATE,
} from "@nostr-git/core/events"

const GIT_PERMALINK = 1623

export type QuoteValue = {
  id?: string
  kind?: number
  pubkey?: string
  identifier?: string
  relays?: string[]
}

type EventLike = Pick<TrustedEvent, "content" | "tags"> & Partial<Pick<TrustedEvent, "kind">>

const isQuote = (parsed: Parsed) => isEvent(parsed) || isAddress(parsed)

const isBoundary = (parsed?: Parsed) => {
  if (!parsed || isNewline(parsed)) return true
  if (isText(parsed)) return !parsed.value.trim()

  return false
}

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim()

const truncateText = (text: string, max = 220) => {
  const normalized = normalizeText(text)
  if (!normalized) return ""
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, max).trimEnd()}...`
}

const dropLeadingQuote = (tokens: Parsed[]) => {
  if (!tokens[0] || !isQuote(tokens[0])) return tokens

  let index = 0

  while (index < tokens.length) {
    const token = tokens[index]

    if (isQuote(token) || isBoundary(token)) {
      index += 1
      continue
    }

    break
  }

  return tokens.slice(index)
}

const hasVisibleReplyToken = (parsed: Parsed) => {
  if (isNewline(parsed) || isQuote(parsed)) return false
  if (isText(parsed)) return Boolean(parsed.value.trim())

  return true
}

const getTokenText = (parsed: Parsed) => {
  if (isNewline(parsed) || isQuote(parsed)) return ""

  const value = (parsed as {value?: unknown}).value
  if (typeof value === "string") return value

  const raw = (parsed as {raw?: unknown}).raw
  if (typeof raw === "string") return raw

  return ""
}

const parseAddress = (address: string) => {
  const parts = address.split(":")
  if (parts.length < 3) return null

  const [kindText, pubkey, ...identifierParts] = parts
  const kind = Number.parseInt(kindText, 10)
  const identifier = identifierParts.join(":")

  if (Number.isNaN(kind) || !pubkey || !identifier) return null

  return {kind, pubkey, identifier}
}

export const getLeadingQuoteValue = (event: EventLike): QuoteValue | null => {
  const [first] = parse(event as TrustedEvent)
  return first && isQuote(first) ? (first.value as QuoteValue) : null
}

export const getTrimmedReplyPreview = (event: EventLike, max = 220) => {
  const tokens = dropLeadingQuote(parse(event as TrustedEvent))

  if (!tokens.some(hasVisibleReplyToken)) return ""

  return truncateText(tokens.map(getTokenText).join(""), max)
}

export const getCommentRootQuoteValue = (event?: TrustedEvent | null): QuoteValue | null => {
  if (!event || event.kind !== GIT_COMMENT) return null

  const relay = getTagValue("R", event.tags)
  const relays = relay ? [relay] : []
  const address = getTagValue("A", event.tags)

  if (address) {
    const parsed = parseAddress(address)
    if (parsed) return {...parsed, relays}
  }

  const id = getTagValue("E", event.tags)
  if (id) return {id, relays}

  return null
}

export const getGitQuoteFallback = (event?: TrustedEvent | null) => {
  if (!event) return ""

  if (event.kind === GIT_REPO_ANNOUNCEMENT || event.kind === GIT_REPO_STATE) {
    return getTagValue("name", event.tags) || getTagValue("d", event.tags) || "Repository"
  }

  if (event.kind === GIT_ISSUE) {
    return getTagValue("subject", event.tags) || "Issue"
  }

  if (event.kind === GIT_PULL_REQUEST) {
    return getTagValue("subject", event.tags) || "Pull Request"
  }

  if (event.kind === GIT_PATCH) {
    return getTagValue("subject", event.tags) || "Patch"
  }

  if (event.kind === GIT_PERMALINK) {
    return "permalink"
  }

  return ""
}
