import {getDecodedToken, getTokenMetadata} from "@cashu/cashu-ts"
import {ParsedType, type Parsed, type ParsedCashu, type ParsedText} from "@welshman/content"

export type CashuTokenInfo = {
  token: string
  mintUrl: string
  amount: number
  unit: string
  memo?: string
}

const CASHU_TOKEN_CANDIDATE_RE = /(?:cashu:)?cashu[ab][A-Za-z0-9_-]{20,50000}/gi
const CASHU_TOKEN_START_RE = /^(?:cashu:)?cashu[ab][A-Za-z0-9_-]{20,50000}/i

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

const hasValidBoundaryAfter = (src: string, index: number) =>
  ALLOWED_BOUNDARY_AFTER.has(index < src.length ? src[index] : "")

export const getCashuTokenInfo = (raw: string): CashuTokenInfo | undefined => {
  const token = raw.trim()
  if (!CASHU_TOKEN_START_RE.test(token) || token.match(CASHU_TOKEN_START_RE)?.[0] !== token) {
    return undefined
  }

  try {
    const metadata = getTokenMetadata(token)
    if (!metadata.mint) return undefined

    return {
      token,
      mintUrl: metadata.mint,
      amount: metadata.amount || 0,
      unit: metadata.unit || "sat",
      memo: metadata.memo,
    }
  } catch {
    try {
      const decoded = getDecodedToken(token)
      if (!decoded.mint) return undefined

      return {
        token,
        mintUrl: decoded.mint,
        amount: decoded.proofs.reduce((sum, proof) => sum + (proof.amount || 0), 0),
        unit: decoded.unit || "sat",
        memo: decoded.memo,
      }
    } catch {
      return undefined
    }
  }
}

export const findCashuTokenStart = (src: string) => {
  CASHU_TOKEN_CANDIDATE_RE.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = CASHU_TOKEN_CANDIDATE_RE.exec(src))) {
    const index = match.index
    const raw = match[0]

    if (!hasValidBoundaryBefore(src, index)) continue
    if (!hasValidBoundaryAfter(src, index + raw.length)) continue
    if (!getCashuTokenInfo(raw)) continue

    CASHU_TOKEN_CANDIDATE_RE.lastIndex = 0
    return index
  }

  CASHU_TOKEN_CANDIDATE_RE.lastIndex = 0
  return -1
}

export const getCashuTokenAtStart = (src: string): CashuTokenInfo | undefined => {
  const match = CASHU_TOKEN_START_RE.exec(src)
  if (!match || match.index !== 0) return undefined

  const raw = match[0]
  if (!hasValidBoundaryAfter(src, raw.length)) return undefined

  return getCashuTokenInfo(raw)
}

export const shortenCashuToken = (token: string) => {
  const normalized = token.startsWith("cashu:") ? token.slice("cashu:".length) : token
  return normalized.length > 22
    ? `${normalized.slice(0, 12)}...${normalized.slice(-8)}`
    : normalized
}

export const getCashuMintDisplayName = (mintUrl: string) => {
  try {
    return new URL(mintUrl).host
  } catch {
    return mintUrl
  }
}

const textToken = (value: string): ParsedText => ({type: ParsedType.Text, value, raw: value})
const cashuToken = (value: string): ParsedCashu => ({type: ParsedType.Cashu, value, raw: value})

export const splitCashuTokensFromText = (text: string): Parsed[] => {
  const result: Parsed[] = []
  let cursor = 0

  CASHU_TOKEN_CANDIDATE_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = CASHU_TOKEN_CANDIDATE_RE.exec(text))) {
    const index = match.index
    const raw = match[0]

    if (
      !hasValidBoundaryBefore(text, index) ||
      !hasValidBoundaryAfter(text, index + raw.length) ||
      !getCashuTokenInfo(raw)
    ) {
      continue
    }

    if (index > cursor) result.push(textToken(text.slice(cursor, index)))
    result.push(cashuToken(raw))
    cursor = index + raw.length
  }

  CASHU_TOKEN_CANDIDATE_RE.lastIndex = 0
  if (cursor < text.length) result.push(textToken(text.slice(cursor)))

  return result.length > 0 ? result : [textToken(text)]
}

export const replaceCashuTokens = (content: Parsed[]): Parsed[] =>
  content.flatMap(parsed =>
    parsed.type === ParsedType.Text ? splitCashuTokensFromText(parsed.value) : parsed,
  )

export const isCashuOutputsSignedError = (message: string) =>
  /outputs?\s+already\s+signed/i.test(message)

export const extractCashuMintUrl = (raw: string): string => getCashuTokenInfo(raw)?.mintUrl || ""

export const matchUntrustedCashuMint = (e: unknown): {mintUrl: string} | null => {
  if (!e || typeof e !== "object") return null

  const error = e as {code?: unknown; name?: unknown; message?: unknown; mintUrl?: unknown}
  const code = typeof error.code === "string" ? error.code : ""
  const name = typeof error.name === "string" ? error.name : ""
  const message = typeof error.message === "string" ? error.message : ""
  const looksUntrusted =
    code === "untrusted_mint" ||
    name === "UntrustedMintError" ||
    /\bis not trusted\b/i.test(message)

  if (!looksUntrusted) return null
  if (typeof error.mintUrl === "string" && error.mintUrl) return {mintUrl: error.mintUrl}

  const fromMessage = message.match(/Mint\s+(\S+)\s+is not trusted/i)
  return fromMessage?.[1] ? {mintUrl: fromMessage[1]} : null
}
