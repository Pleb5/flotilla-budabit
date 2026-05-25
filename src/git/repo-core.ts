import type {Event as NostrEvent} from "nostr-tools"
import type {
  RepoStateEvent,
  CommentEvent,
  LabelEvent,
  StatusEvent,
  IssueEvent,
  PullRequestEvent,
  PullRequestUpdateEvent,
  UserGraspListEvent,
} from "../events/index.js"
import {buildRepoKey, parseEucTag, GitIssueStatus, parseRepoStateEvent} from "../events/index.js"
import {assembleIssueThread, resolveIssueStatus, type IssueThread} from "../events/nip34/issues.js"
import {buildRepoSubscriptions, type RepoSubscriptions} from "../git/subscriptions.js"

// ============================================================
// Types Re-Exports
// ============================================================

export type RepoContext = {
  repoEvent?: NostrEvent
  repoStateEvent?: RepoStateEvent
  repo?: any // generic metadata; flows does not parse RepoAnnouncementEvent
  issues?: IssueEvent[]
  repoStateEventsArr?: RepoStateEvent[]
  statusEventsArr?: StatusEvent[]
  commentEventsArr?: CommentEvent[]
  labelEventsArr?: LabelEvent[]
  maintainers?: string[]
  pullRequests?: PullRequestEvent[]
  pullRequestUpdates?: PullRequestUpdateEvent[]
  userGraspLists?: UserGraspListEvent[]
}

// EffectiveLabelsV2 used for compatibility, simplified placeholder
export type EffectiveLabelsV2 = {
  byNamespace: Record<string, Set<string>>
  flat: Set<string>
  legacyT: Set<string>
}

// ============================================================
// Helper Utilities
// ============================================================

function getOwnerPubkey(ctx: RepoContext): string {
  const owner = ctx.repo?.owner?.trim?.() ?? ""
  if (owner) return owner
  return (ctx.repoEvent?.pubkey || "").trim()
}

function isTrusted(ctx: RepoContext, pubkey?: string): boolean {
  if (!pubkey) return false
  const owner = getOwnerPubkey(ctx)
  if (pubkey === owner) return true
  return (ctx.maintainers || ctx.repo?.maintainers || []).includes(pubkey)
}

function toLabelSet(arr: string[] | undefined): Set<string> {
  return new Set(arr || [])
}

// ============================================================
// RepoCore: Main Orchestrator
// ============================================================

export class RepoCore {
  // Repo identity helpers
  static getOwnerPubkey(ctx: RepoContext): string {
    return getOwnerPubkey(ctx)
  }

  static isTrusted(ctx: RepoContext, pubkey?: string): boolean {
    return isTrusted(ctx, pubkey)
  }

  static trustedMaintainers(ctx: RepoContext): string[] {
    const out = new Set<string>(ctx.repo?.maintainers || ctx.maintainers || [])
    const owner = getOwnerPubkey(ctx)
    if (owner) out.add(owner)
    return Array.from(out)
  }

  static selectOwnerRepoStateEvent(
    ctx: RepoContext,
    events: RepoStateEvent[] = [],
  ): RepoStateEvent | undefined {
    const owner = getOwnerPubkey(ctx)
    if (!owner) return undefined

    const ownerEvents = events
      .filter(event => event.pubkey === owner)
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))
    return ownerEvents[ownerEvents.length - 1]
  }

  static getRepoStateRefs(
    event?: RepoStateEvent,
  ): Map<string, {commitId: string; type: "heads" | "tags"; fullRef: string}> {
    const out = new Map<string, {commitId: string; type: "heads" | "tags"; fullRef: string}>()
    if (!event) return out

    const parsed = parseRepoStateEvent(event) as any
    let refs = parsed?.refs || []
    if (!refs || refs.length === 0) {
      const tags: any[] = (event as any).tags || []
      let lastRef: string | null = null
      const legacyRefs: any[] = []
      for (const tag of tags) {
        if (tag[0] !== "r") continue
        if (tag[2] === "ref") lastRef = tag[1]
        else if (tag[2] === "commit" && lastRef) {
          legacyRefs.push({ref: lastRef, commit: tag[1]})
          lastRef = null
        }
      }
      refs = legacyRefs
    }

    for (const ref of refs) {
      const fullRef: string = ref.ref ?? (ref.type && ref.name ? `refs/${ref.type}/${ref.name}` : "")
      if (!fullRef) continue
      const match = /^refs\/(heads|tags)\/(.+)$/.exec(fullRef)
      if (!match) continue
      const type = match[1] as "heads" | "tags"
      const name = match[2]
      if (type === "tags" && name.endsWith("^{}")) continue
      out.set(`${type}:${name}`, {commitId: ref.commit || "", type, fullRef})
    }

    return out
  }

  static assembleIssueThread(args: {
    root: NostrEvent
    comments: NostrEvent[]
    statuses: NostrEvent[]
  }): IssueThread {
    return assembleIssueThread(args)
  }

  static resolveIssueStatus(
    thread: IssueThread,
    rootAuthor: string,
    maintainers: Set<string>,
  ): {final: NostrEvent | undefined; reason: string} {
    return resolveIssueStatus(thread, rootAuthor, maintainers)
  }

  // Issue / PR threads & statuses
  static resolveStatusFor(
    ctx: RepoContext,
    rootId: string,
  ): {
    state: "open" | "draft" | "closed" | "merged" | "resolved"
    by: string
    at: number
    eventId: string
  } | null {
    const allStatus = ctx.statusEventsArr || []
    if (allStatus.length === 0) return null

    const rootAuthor = RepoCore.findRootAuthor(ctx, rootId)
    const rootIsIssue = !!(ctx.issues || []).find(i => i.id === rootId)
    const kindToState = (kind: number): "open" | "draft" | "closed" | "merged" | "resolved" => {
      if (kind === 1630) return "open"
      if (kind === 1633) return "draft"
      if (kind === 1632) return "closed"
      if (kind === 1631) return rootIsIssue ? "resolved" : "merged"
      return "open"
    }

    const events = allStatus
      .filter(ev => (ev.tags || []).some((t: string[]) => t[0] === "e" && t[1] === rootId))
      .filter(ev => isTrusted(ctx, ev.pubkey) || (!!rootAuthor && ev.pubkey === rootAuthor))
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0))

    const last = events[events.length - 1]
    if (!last) return null
    const state = kindToState((last as any).kind)
    return {
      state,
      by: last.pubkey,
      at: (last as any).created_at || 0,
      eventId: last.id,
    }
  }

  static findRootAuthor(ctx: RepoContext, rootId: string): string | undefined {
    const root =
      (ctx.issues || []).find(i => i.id === rootId) ||
      (ctx.pullRequests || []).find(pr => pr.id === rootId)
    return root?.pubkey
  }

  static getIssueThread(
    ctx: RepoContext,
    rootId: string,
  ): {rootId: string; comments: CommentEvent[]} {
    const out: CommentEvent[] = []
    if (!ctx.commentEventsArr) return {rootId, comments: out}

    for (const ev of ctx.commentEventsArr) {
      const tags = (ev.tags || []) as string[][]
      const hasE = tags.some(t => (t[0] === "e" || t[0] === "E") && t[1] === rootId)
      if (hasE) out.push(ev)
    }

    return {
      rootId,
      comments: out.sort((a, b) => (a.created_at || 0) - (b.created_at || 0)),
    }
  }

  // Basic label integration (stubbed with simple structure)
  static getEffectiveLabelsFor(
    ctx: RepoContext,
    target: {id?: string; address?: string; euc?: string},
  ): EffectiveLabelsV2 {
    const legacyT = new Set<string>()
    const byNamespace: Record<string, Set<string>> = {}
    const flat = new Set<string>()

    const rootEvt = target.id
      ? (ctx.issues || []).find(i => i.id === target.id) ||
        (ctx.pullRequests || []).find(pr => pr.id === target.id)
      : undefined

    if (!rootEvt) {
      return {byNamespace, flat, legacyT}
    }

    // Extract legacy "t" tags
    const tTags: string[] = []
    if (rootEvt?.tags) {
      for (const t of rootEvt.tags as any[][]) {
        if (t[0] === "t") {
          legacyT.add(t[1])
          tTags.push(t[1])
        }
      }
    }

    // Extract self-labels (author's own "l" tags on the event)
    const selfLabels: Array<{L?: string; l: string; targetKind: number}> = []
    const namespaces = (rootEvt.tags as any[][]).filter(t => t[0] === "L").map(t => t[1])

    for (const tag of rootEvt.tags as any[][]) {
      if (tag[0] !== "l") continue
      const [_, value, mark] = tag as [string, string, string?]
      const ns = mark && namespaces.includes(mark) ? mark : undefined
      selfLabels.push({L: ns, l: value, targetKind: rootEvt.kind})
    }

    // Extract external labels (kind 1985 events targeting this event)
    const externalLabels: Array<{namespace: string; value: string}> = []
    const labelEvents = ctx.labelEventsArr || []

    for (const labelEvt of labelEvents) {
      // Check if this label event targets our root event
      const targets = (labelEvt.tags || []) as string[][]

      // Check for target in various formats:
      // Standard: ["e", "id"], ["a", "address"], ["r", "euc"]
      // Non-standard: ["L", "id", "e"] (used in tests)
      const hasTarget = targets.some(
        t =>
          (t[0] === "e" && t[1] === target.id) ||
          (t[0] === "a" && t[1] === target.address) ||
          (t[0] === "r" && t[1] === target.euc) ||
          (t[0] === "L" && t[1] === target.id && t[2] === "e"),
      )

      if (!hasTarget) continue

      // Extract namespace declarations (standard format)
      const labelNamespaces = targets.filter(t => t[0] === "L" && t.length === 2).map(t => t[1])

      for (const tag of targets) {
        if (tag[0] !== "l") continue
        const [_, value, mark] = tag as [string, string, string?]
        const ns = mark && labelNamespaces.includes(mark) ? mark : "ugc"
        externalLabels.push({namespace: ns, value})
      }
    }

    // Merge all labels
    const push = (ns: string | undefined, value: string) => {
      // Check if the value itself contains namespace information (e.g., "org.nostr.git.type:feature")
      let namespace = ns || "ugc"
      let labelValue = value

      // If no explicit namespace provided AND value contains namespace markers,
      // try to extract namespace from value
      if (!ns) {
        // Check for complex namespace patterns (e.g., "org.nostr.git.type:feature" or "ugc/custom:needs-review")
        // Only split if the namespace part contains dots or multiple slashes, indicating a structured namespace
        const colonIdx = value.indexOf(":")
        const slashIdx = value.indexOf("/")

        if (colonIdx > 0) {
          const potentialNs = value.substring(0, colonIdx)
          // Only treat as namespace if it has dots (e.g., "org.nostr.git.type") or multiple segments
          if (potentialNs.includes(".") || potentialNs.includes("/")) {
            namespace = potentialNs
            labelValue = value.substring(colonIdx + 1)
          }
          // Otherwise keep the whole value (e.g., "type:feature" stays as "type:feature" in ugc namespace)
        } else if (slashIdx > 0) {
          const potentialNs = value.substring(0, slashIdx)
          // Only treat first part as namespace if it suggests a structured namespace
          if (potentialNs.includes(".") || value.lastIndexOf("/") > slashIdx) {
            // Multiple slashes means nested namespace
            const lastSlash = value.lastIndexOf("/")
            namespace = value.substring(0, lastSlash)
            labelValue = value.substring(lastSlash + 1)
          }
        }
      }

      byNamespace[namespace] = byNamespace[namespace] || new Set<string>()
      byNamespace[namespace].add(labelValue)
      flat.add(`${namespace}/${labelValue}`)
    }

    for (const s of selfLabels) push(s.L, s.l)
    for (const e of externalLabels) push(e.namespace, e.value)
    for (const t of tTags) push("#t", t)

    return {byNamespace, flat, legacyT}
  }

  static getRepoLabels(ctx: RepoContext): EffectiveLabelsV2 {
    const address = ctx.repoEvent ? `30617:${getOwnerPubkey(ctx)}:${ctx.repo?.name || ""}` : ""
    return RepoCore.getEffectiveLabelsFor(ctx, {address})
  }

  static getIssueLabels(ctx: RepoContext, rootId: string): EffectiveLabelsV2 {
    return RepoCore.getEffectiveLabelsFor(ctx, {id: rootId})
  }

  static getPullRequestLabels(ctx: RepoContext, rootId: string): EffectiveLabelsV2 {
    return RepoCore.getEffectiveLabelsFor(ctx, {id: rootId})
  }

  static getMaintainerBadge(ctx: RepoContext, pubkey: string): "owner" | "maintainer" | null {
    if (!pubkey) return null
    const owner = getOwnerPubkey(ctx)
    if (pubkey === owner) return "owner"
    if ((ctx.repo?.maintainers || []).includes(pubkey)) return "maintainer"
    return null
  }

  static getRecommendedFilters(ctx: RepoContext): any[] {
    const filters: any[] = []
    const a = ctx.repoEvent ? `30617:${getOwnerPubkey(ctx)}:${ctx.repo?.name || ""}` : undefined
    if (a) {
      filters.push({
        kinds: [30617, 1618, 1619, 1621, 1630, 1631, 1632, 1633, 10317],
        "#a": [a],
      })
    }

    const roots = [...(ctx.issues || []), ...(ctx.pullRequests || [])].map(e => e.id)
    if (roots.length > 0) filters.push({"#e": roots})

    const euc = (ctx.repoEvent?.tags || []).find(t => t[0] === "r" && t[2] === "euc")?.[1]
    if (euc) filters.push({"#r": [euc]})
    return filters
  }

  // Subscriptions wrapper
  static buildRepoSubscriptions(args: {
    addressA?: string
    rootEventId?: string
    euc?: string
  }): RepoSubscriptions {
    return buildRepoSubscriptions(args)
  }

  // Shared-types convenience
  static buildRepoKey(pubkey: string, name?: string): string {
    return buildRepoKey(pubkey, name)
  }

  static parseEucFromTags(tags: string[][]): string | undefined {
    return parseEucTag(tags)
  }

  // Convert Nostr issue final status to GitIssueStatus enum
  static summarizeIssueStatus(
    thread: IssueThread,
    rootAuthor: string,
    maintainers: Set<string>,
  ): {
    status: GitIssueStatus
    by?: string
    at?: number
    eventId?: string
    reason: string
  } {
    const {final, reason} = resolveIssueStatus(thread, rootAuthor, maintainers)
    const mapKindToEnum = (k?: number): GitIssueStatus => {
      switch (k) {
        case 1632:
          return GitIssueStatus.CLOSED
        case 1631:
          return GitIssueStatus.RESOLVED
        case 1630:
          return GitIssueStatus.OPEN
        case 1633:
          return GitIssueStatus.DRAFT
        default:
          return GitIssueStatus.OPEN
      }
    }
    return {
      status: mapKindToEnum(final?.kind),
      by: final?.pubkey,
      at: final?.created_at,
      eventId: final?.id,
      reason,
    }
  }
}
