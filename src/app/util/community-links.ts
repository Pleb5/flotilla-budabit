import type {Parsed, ParsedLink} from "@welshman/content"
import {isLink} from "@welshman/content"
import {parseCommunityInput, type ParsedCommunityInput} from "@app/core/community"

const NCOMMUNITY_CANDIDATE_RE = /ncommunity:\/\/[^\s<>"'`]+/gi

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

export type CommunityLinkToken = {
  type: "community"
  value: ParsedCommunityInput
  raw: string
}

export type ParsedWithCommunity = Parsed | CommunityLinkToken

export const isCommunityLinkToken = (parsed: unknown): parsed is CommunityLinkToken =>
  Boolean(parsed && typeof parsed === "object" && (parsed as {type?: string}).type === "community")

const hasValidBoundaryBefore = (src: string, index: number) =>
  ALLOWED_BOUNDARY_BEFORE.has(index > 0 ? src[index - 1] : "")

const hasValidBoundaryAfter = (src: string, index: number) =>
  ALLOWED_BOUNDARY_AFTER.has(index < src.length ? src[index] : "")

const trimTrailingBoundary = (value: string) => {
  let next = value

  while (/[.,!?;:]$/.test(next)) next = next.slice(0, -1)
  while (/[)\]}]$/.test(next)) next = next.slice(0, -1)

  return next
}

export const parseNcommunityLink = (value: string): ParsedCommunityInput | undefined => {
  const trimmed = trimTrailingBoundary(value.trim())

  return trimmed.startsWith("ncommunity://") ? parseCommunityInput(trimmed) : undefined
}

export const findNcommunityLinkStart = (src: string) => {
  NCOMMUNITY_CANDIDATE_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = NCOMMUNITY_CANDIDATE_RE.exec(src))) {
    const index = match.index
    const raw = trimTrailingBoundary(match[0])
    const parsed = parseNcommunityLink(raw)

    if (!parsed) continue
    if (!hasValidBoundaryBefore(src, index)) continue
    if (!hasValidBoundaryAfter(src, index + raw.length)) continue

    NCOMMUNITY_CANDIDATE_RE.lastIndex = 0
    return index
  }

  return -1
}

export const getNcommunityLinkAtStart = (src: string): CommunityLinkToken | undefined => {
  NCOMMUNITY_CANDIDATE_RE.lastIndex = 0
  const match = NCOMMUNITY_CANDIDATE_RE.exec(src)
  NCOMMUNITY_CANDIDATE_RE.lastIndex = 0
  if (!match || match.index !== 0) return undefined

  const raw = trimTrailingBoundary(match[0])
  const value = parseNcommunityLink(raw)
  if (!value) return undefined
  if (!hasValidBoundaryAfter(src, raw.length)) return undefined

  return {type: "community", value, raw}
}

export const communityLinkTokenFromParsedLink = (parsed: ParsedLink): CommunityLinkToken | undefined => {
  const raw = parsed.raw || parsed.value.url.toString()
  const value = parseNcommunityLink(raw)

  return value ? {type: "community", value, raw: trimTrailingBoundary(raw)} : undefined
}

export const replaceCommunityLinks = (content: Parsed[]): ParsedWithCommunity[] =>
  content.map(parsed => (isLink(parsed) ? communityLinkTokenFromParsedLink(parsed) || parsed : parsed))
