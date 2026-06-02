import {GIT_LABEL, type LabelEvent, type Label, type NostrEvent} from "./nip32.js"
import type {NostrTag} from "../nip34/nip34.js"

export type LabelTag =
  | ["L", string]
  | ["l", string]
  | ["l", string, string]
  | ["l", string, string, "del"]
export type TargetTag =
  | ["e", string]
  | ["a", string]
  | ["p", string]
  | ["r", string]
  | ["t", string]
export type LabelEventTag = LabelTag | TargetTag | NostrTag

export function isLabelEvent(evt: {kind: number}): evt is LabelEvent {
  return evt?.kind === GIT_LABEL
}

export interface RoleLabelEvent {
  id: string
  role?: string
  namespace?: string
  people: string[]
  rootId?: string
  repoAddr?: string
  author: {pubkey: string}
  createdAt: string
  raw: LabelEvent
}

export function parseRoleLabelEvent(event: LabelEvent): RoleLabelEvent {
  const namespaces = getLabelNamespaces(event)
  const roleTag = (event.tags as string[][]).find(
    t => t[0] === "l" && (!!t[2] || namespaces.length),
  )
  const role = roleTag?.[1]
  const ns = roleTag?.[2] || namespaces[0]
  const people = (event.tags as string[][]).filter(t => t[0] === "p").map(t => t[1])
  const root = (event.tags as string[][]).find(t => t[0] === "e")?.[1]
  const repoAddr = (event.tags as string[][]).find(t => t[0] === "a")?.[1]
  return {
    id: (event as NostrEvent).id,
    role,
    namespace: ns,
    people,
    rootId: root,
    repoAddr,
    author: {pubkey: (event as NostrEvent).pubkey},
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}

export function createRoleLabelEvent(opts: {
  rootId: string
  role: string
  pubkeys: string[]
  repoAddr?: string
  namespace?: string // defaults to org.nostr.git.role
  created_at?: number
  content?: string
}): LabelEvent {
  const ns = opts.namespace ?? "org.nostr.git.role"
  return createLabelEvent({
    content: opts.content ?? "",
    created_at: opts.created_at,
    namespaces: [ns],
    labels: [{namespace: ns, value: opts.role}],
    e: [opts.rootId],
    a: opts.repoAddr ? [opts.repoAddr] : [],
    p: opts.pubkeys,
  })
}

export function getLabelNamespaces(event: {tags: string[][]}): string[] {
  return event.tags.filter(t => t[0] === "L").map(t => t[1])
}

export function getLabelValues(event: {tags: string[][]}): Label[] {
  const namespaces = getLabelNamespaces(event)
  const out: Label[] = []
  for (const tag of event.tags) {
    if (tag[0] !== "l") continue
    const [_, value, mark, opTag] = tag as [string, string, string?, string?]
    const ns = mark && namespaces.includes(mark) ? mark : undefined
    out.push({namespace: ns, value, mark, op: opTag === "del" ? "del" : "add"})
  }
  return out
}

export function createLabelEvent(opts: {
  labels?: Array<{namespace?: string; value: string; op?: "add" | "del"}>
  namespaces?: string[]
  e?: string[]
  a?: string[]
  p?: string[]
  r?: string[]
  t?: string[]
  content?: string
  created_at?: number
  extraTags?: NostrTag[]
}): LabelEvent {
  const tags: LabelEventTag[] = []

  // namespace marks
  for (const ns of opts.namespaces || []) tags.push(["L", ns])

  // labels
  for (const l of opts.labels || []) {
    if (l.namespace && l.op === "del") tags.push(["l", l.value, l.namespace, "del"])
    else if (l.namespace) tags.push(["l", l.value, l.namespace])
    else tags.push(["l", l.value])
  }

  // targets
  for (const id of opts.e || []) tags.push(["e", id])
  for (const a of opts.a || []) tags.push(["a", a])
  for (const p of opts.p || []) tags.push(["p", p])
  for (const r of opts.r || []) tags.push(["r", r])
  for (const t of opts.t || []) tags.push(["t", t])

  if (opts.extraTags) tags.push(...opts.extraTags)

  const event: LabelEvent = {
    kind: GIT_LABEL,
    content: opts.content ?? "",
    created_at: opts.created_at ?? Math.floor(Date.now() / 1000),
    tags: tags as unknown as string[][],
    pubkey: "",
    id: "",
    sig: "",
  }
  return event
}

export interface ParsedLabelEvent {
  id: string
  labels: Label[]
  targets: {
    e: string[]
    a: string[]
    p: string[]
    r: string[]
    t: string[]
  }
  author: {pubkey: string}
  createdAt: string
  raw: LabelEvent
}

export function parseLabelEvent(event: LabelEvent): ParsedLabelEvent {
  const labels = getLabelValues(event)
  const targets = {
    e: [] as string[],
    a: [] as string[],
    p: [] as string[],
    r: [] as string[],
    t: [] as string[],
  }
  for (const tag of event.tags as string[][]) {
    if (tag[0] === "e") targets.e.push(tag[1])
    else if (tag[0] === "a") targets.a.push(tag[1])
    else if (tag[0] === "p") targets.p.push(tag[1])
    else if (tag[0] === "r") targets.r.push(tag[1])
    else if (tag[0] === "t") targets.t.push(tag[1])
  }
  return {
    id: (event as NostrEvent).id,
    labels,
    targets,
    author: {pubkey: (event as NostrEvent).pubkey},
    createdAt: new Date(event.created_at * 1000).toISOString(),
    raw: event,
  }
}
