import {Lexer, type Token} from "marked"
import type {TrustedEvent} from "@welshman/util"

export const isArticleKind = (kind: number) => kind === 30023 || kind === 30024

const validTimestamp = (value: string | number) => {
  if (typeof value === "string" && !/^\d+$/.test(value)) return undefined
  const timestamp = Number(value)
  return Number.isSafeInteger(timestamp) && timestamp >= 0 && timestamp <= 8.64e12
    ? timestamp
    : undefined
}

const imageUrl = (value: string) => {
  try {
    const url = new URL(value)
    if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password)
      return url.href
  } catch {
    // A missing or malformed optional cover must not prevent reading an article.
  }
  return ""
}

const tokenText = (token: Token): string => {
  if (token.type === "html" || token.type === "def") return ""
  if (token.type === "table") {
    return [...token.header, ...token.rows.flat()].map(cell => cell.text).join(" ")
  }
  if ("items" in token && Array.isArray(token.items)) {
    return token.items.map(item => item.tokens.map(tokenText).join(" ")).join(" ")
  }
  if ("tokens" in token && Array.isArray(token.tokens)) return token.tokens.map(tokenText).join(" ")
  return "text" in token ? String(token.text) : " "
}

export const getArticlePreview = (content: string, limit = 300) => {
  // Quote previews never mount Markdown, media, or nested quotes. Bound parsing
  // even when a very large article has no author-provided summary.
  const text = Lexer.lex(content.slice(0, 16000))
    .map(tokenText)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
  return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text
}

export const getArticleDetails = (event: TrustedEvent) => {
  const tag = (name: string) => event.tags.find(tag => tag[0] === name)?.[1]?.trim() || ""
  const draft = event.kind === 30024
  const summary = tag("summary")
  return {
    draft,
    title: tag("title") || (draft ? "Untitled draft" : "Untitled article"),
    summary,
    preview: summary
      ? summary.length > 300
        ? `${summary.slice(0, 300)}…`
        : summary
      : getArticlePreview(event.content),
    image: imageUrl(tag("image")),
    publishedAt:
      (!draft ? validTimestamp(tag("published_at")) : undefined) ??
      validTimestamp(event.created_at),
  }
}
