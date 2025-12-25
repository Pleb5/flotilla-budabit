import type { EffectiveLabelsV2 } from "@nostr-git/core"
import { createRoleLabelEvent } from "@nostr-git/shared-types"

export type NormalizedEffectiveLabelsView = {
  flat: Set<string>
  byNamespace: Record<string, Set<string>>
}

export const ROLE_NS = "org.nostr.git.role"

export type RoleName = "assignee" | "reviewer"

/**
 * Remove namespace prefixes and leading "#" to create human-friendly labels.
 */
export function toNaturalLabel(label: string): string {
  if (typeof label !== "string") return ""
  const trimmed = label.trim()
  if (!trimmed) return ""
  const idx = trimmed.lastIndexOf("/")
  if (idx >= 0 && idx < trimmed.length - 1) {
    return trimmed.slice(idx + 1)
  }
  return trimmed.replace(/^#/, "")
}

/**
 * Utility to coerce various iterable or single values into a string Set.
 */
function toStringSet(value: unknown): Set<string> {
  if (!value) return new Set<string>()
  if (value instanceof Set) {
    return new Set(Array.from(value).filter(v => typeof v === "string") as string[])
  }
  if (Array.isArray(value)) {
    return new Set(value.filter(v => typeof v === "string") as string[])
  }
  if (typeof value === "string") {
    return new Set([value])
  }
  return new Set<string>()
}

/**
 * Normalize an EffectiveLabelsV2-like object into a consistent structure with Sets.
 */
export function normalizeEffectiveLabels(eff?: Partial<EffectiveLabelsV2> | any | null): NormalizedEffectiveLabelsView {
  const flat = toStringSet(eff?.flat)
  const byNamespace: Record<string, Set<string>> = {}
  
  if (eff && typeof eff.byNamespace === "object") {
    for (const ns of Object.keys(eff.byNamespace)) {
      byNamespace[ns] = toStringSet(eff.byNamespace[ns])
    }
  }
  
  return { flat, byNamespace }
}

export function buildRoleLabelEvent(params: {
  rootId: string
  role: RoleName
  pubkeys: string[]
  repoAddr?: string
  created_at?: number
}): {
  kind: number
  content: string
  created_at: number
  tags: string[][]
  pubkey: string
  id: string
  sig: string
} {
  const { rootId, role, pubkeys, repoAddr, created_at } = params
  return createRoleLabelEvent({
    rootId,
    role,
    pubkeys,
    repoAddr,
    created_at,
    namespace: ROLE_NS,
  }) as any
}

/**
 * Convert any iterable of labels to a normalized string array.
 */
export function toNaturalArray(values?: Iterable<string> | null): string[] {
  if (!values) return []
  const out = new Set<string>()
  for (const val of values) {
    if (typeof val === "string") {
      out.add(toNaturalLabel(val))
    }
  }
  return Array.from(out)
}

export function extractRoleAssignments(
  events: any[],
  rootId?: string | null
): { assignees: Set<string>; reviewers: Set<string> } {
  const assignees = new Set<string>()
  const reviewers = new Set<string>()
  if (!Array.isArray(events)) return { assignees, reviewers }

  for (const ev of events) {
    if (!ev || ev.kind !== 1985 || !Array.isArray(ev.tags)) continue
    const hasRoleNs = ev.tags.some(
      (t: string[]) => t[0] === "L" && t[1] === ROLE_NS
    )
    if (!hasRoleNs) continue
    if (rootId && !ev.tags.some((t: string[]) => t[0] === "e" && t[1] === rootId)) continue

    const roleTags = ev.tags.filter(
      (t: string[]) => t[0] === "l" && t[2] === ROLE_NS
    )
    const hasAssignee = roleTags.some((t: string[]) => t[1] === "assignee")
    const hasReviewer = roleTags.some((t: string[]) => t[1] === "reviewer")
    const people = ev.tags.filter((t: string[]) => t[0] === "p").map((t: string[]) => t[1])
    if (hasAssignee) for (const p of people) assignees.add(p)
    if (hasReviewer) for (const p of people) reviewers.add(p)
  }
  return { assignees, reviewers }
}

/**
 * Group normalized labels by known namespaces for streamlined UI usage.
 */
export function groupLabels(view: NormalizedEffectiveLabelsView): {
  Status: string[]
  Type: string[]
  Area: string[]
  Tags: string[]
  Role: string[]
  Other: string[]
} {
  const groupSets = {
    Status: new Set<string>(),
    Type: new Set<string>(),
    Area: new Set<string>(),
    Tags: new Set<string>(),
    Role: new Set<string>(),
    Other: new Set<string>(),
  }

  const namespaceToGroup = (ns: string): keyof typeof groupSets => {
    if (ns === "org.nostr.git.status") return "Status"
    if (ns === "org.nostr.git.type") return "Type"
    if (ns === "org.nostr.git.area") return "Area"
    if (ns === "#t") return "Tags"
    if (ns === ROLE_NS) return "Role"
    return "Other"
  }

  for (const ns of Object.keys(view.byNamespace)) {
    const group = namespaceToGroup(ns)
    for (const val of view.byNamespace[ns]) {
      groupSets[group].add(toNaturalLabel(val))
    }
  }

  return {
    Status: Array.from(groupSets.Status),
    Type: Array.from(groupSets.Type),
    Area: Array.from(groupSets.Area),
    Tags: Array.from(groupSets.Tags),
    Role: Array.from(groupSets.Role),
    Other: Array.from(groupSets.Other),
  }
}