// NIP-22: Comment Event Types for Nostr
// https://github.com/nostr-protocol/nips/blob/master/22.md

import {NostrEvent} from "nostr-tools"

// -------------------
// Comment Event (kind: 1111)
// -------------------
export const GIT_COMMENT = 1111

/**
 * NIP-22 Comment event tag types.
 * See: https://github.com/nostr-protocol/nips/blob/master/22.md
 */
export type CommentTag =
  // Root scope references (must use uppercase for root)
  | ["A", string, ...string[]] // Root address (e.g., 30023:pubkey:identifier)
  | ["E", string, ...string[]] // Root event id
  | ["I", string, ...string[]] // Root external id (e.g., url, podcast guid)
  | ["K", string] // Root kind (number or string)
  | ["P", string, ...string[]] // Root pubkey
  | ["R", string] // Root relay

  // Parent references (must use lowercase for parent)
  | ["a", string, ...string[]] // Parent address
  | ["e", string, ...string[]] // Parent event id
  | ["i", string, ...string[]] // Parent external id
  | ["k", string] // Parent kind
  | ["p", string, ...string[]] // Parent pubkey
  | ["r", string] // Parent relay

  // Optional: citation and mention tags per NIP-21
  | ["q", string, ...string[]] // Cited event or address
  | ["p", string, ...string[]] // Mentioned pubkey
  | ["imeta", ...string[]]
  | ["t", string]
  | ["f", string]
  | ["c", string]
  | ["line", string]
  | ["line", string, "del"]
  | ["l", string]
  | ["repo", string]

/**
 * NIP-22 Comment Event
 */
export type CommentEvent = NostrEvent & {
  kind: 1111
  content: string
  tags: CommentTag[]
  sig?: string | undefined
}

export interface CreateCommentOpts {
  content: string
  root: {type: "A" | "E" | "I"; value: string; kind: string; pubkey?: string; relay?: string}
  parent?: {type: "a" | "e" | "i"; value: string; kind: string; pubkey?: string; relay?: string}
  authorPubkey?: string
  created_at?: number
  id?: string
  extraTags?: CommentTag[]
}

export type CommentTargetEvent = {
  id: string
  kind: number | string
  pubkey?: string
  relay?: string
}

export interface CreateGitCommentOpts {
  content: string
  root: CommentTargetEvent
  parent?: CommentTargetEvent
  authorPubkey?: string
  created_at?: number
  id?: string
  repoRefs?: string[]
  relayHint?: string
  extraTags?: CommentTag[]
}

export interface CreateGitInlineCommentOpts extends CreateGitCommentOpts {
  filePath: string
  commitId?: string
  line?: string
  lineSide?: "del"
}

/**
 * Create a NIP-22 Comment Event (kind 1111) with developer-friendly API.
 */
export function createCommentEvent(opts: CreateCommentOpts): CommentEvent {
  const tags: CommentTag[] = []

  // Add root reference tag
  const {
    type: rootType,
    value: rootValue,
    kind: rootKind,
    pubkey: rootPubkey,
    relay: rootRelay,
  } = opts.root
  tags.push([rootType, rootValue])
  if (rootKind) tags.push(["K", rootKind])
  if (rootPubkey) tags.push(["P", rootPubkey])
  if (rootRelay) tags.push(["R", rootRelay])

  // Add parent reference tag if provided
  if (opts.parent) {
    const {
      type: parentType,
      value: parentValue,
      kind: parentKind,
      pubkey: parentPubkey,
      relay: parentRelay,
    } = opts.parent
    tags.push([parentType, parentValue])
    if (parentKind) tags.push(["k", parentKind])
    if (parentPubkey) tags.push(["p", parentPubkey])
    if (parentRelay) tags.push(["r", parentRelay])
  }

  // Add any extra tags
  if (opts.extraTags) {
    tags.push(...opts.extraTags)
  }

  return {
    kind: 1111,
    content: opts.content,
    tags,
    pubkey: opts.authorPubkey || "",
    created_at: opts.created_at || Math.floor(Date.now() / 1000),
    id: opts.id || "",
    sig: "",
  }
}

const appendRelayAndPubkey = (base: string[], relay?: string, pubkey?: string) => {
  if (!relay && !pubkey) return base
  return [...base, relay || "", ...(pubkey ? [pubkey] : [])]
}

const appendRelay = (base: string[], relay?: string) => (relay ? [...base, relay] : base)

/**
  * Create a NIP-22 comment for NIP-34 git threads.
 * Root tags always point at the original issue/PR, while parent tags point at
 * the immediate event being replied to. Repo references are encoded as q-tags.
 */
export function createGitCommentEvent(opts: CreateGitCommentOpts): CommentEvent {
  const parent = opts.parent || opts.root
  const rootRelay = opts.root.relay || opts.relayHint
  const parentRelay = parent.relay || opts.relayHint
  const tags: CommentTag[] = [
    appendRelayAndPubkey(["E", opts.root.id], rootRelay, opts.root.pubkey) as CommentTag,
    ["K", String(opts.root.kind)],
    ...(opts.root.pubkey
      ? ([appendRelay(["P", opts.root.pubkey], rootRelay) as CommentTag] as CommentTag[])
      : []),
    appendRelayAndPubkey(["e", parent.id], parentRelay, parent.pubkey) as CommentTag,
    ["k", String(parent.kind)],
    ...(parent.pubkey
      ? ([appendRelay(["p", parent.pubkey], parentRelay) as CommentTag] as CommentTag[])
      : []),
  ]

  for (const repoRef of opts.repoRefs || []) {
    if (repoRef) tags.push(appendRelay(["q", repoRef], opts.relayHint) as CommentTag)
  }

  if (opts.extraTags) tags.push(...opts.extraTags)

  return {
    kind: 1111,
    content: opts.content,
    tags,
    pubkey: opts.authorPubkey || "",
    created_at: opts.created_at || Math.floor(Date.now() / 1000),
    id: opts.id || "",
    sig: "",
  }
}

/** Create a NIP-34 inline PR review comment with f/c/line tags. */
export function createGitInlineCommentEvent(opts: CreateGitInlineCommentOpts): CommentEvent {
  const extraTags: CommentTag[] = [["f", opts.filePath]]
  if (opts.commitId) extraTags.push(["c", opts.commitId])
  if (opts.line) {
    extraTags.push(opts.lineSide === "del" ? ["line", opts.line, "del"] : ["line", opts.line])
  }

  return createGitCommentEvent({
    ...opts,
    extraTags: [...extraTags, ...(opts.extraTags || [])],
  })
}
