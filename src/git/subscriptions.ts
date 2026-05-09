// Core: subscription strategy builder (redundant filters + dedupe rules)

export type RepoSubscriptions = {
  filters: any[]
  notes: string[] // human notes on dedupe expectations
}

type FilterShape = Record<string, unknown>

function isMergeable(filter: FilterShape): boolean {
  // Mergeable if filter only has tag/ids constraints and no time/limit options
  const reserved = new Set(["since", "until", "limit"])
  return Object.keys(filter).every(k => !reserved.has(k))
}

function normalizeFilter(filter: FilterShape): string {
  const keys = Object.keys(filter).sort()
  const norm: Record<string, unknown> = {}
  for (const k of keys) {
    const v = (filter as any)[k]
    if (Array.isArray(v)) {
      norm[k] = [...v].sort()
    } else if (typeof v === "object" && v && Array.isArray((v as any)[k])) {
      // not expected; keep as-is
      norm[k] = v
    } else {
      norm[k] = v
    }
  }
  return JSON.stringify(norm)
}

function mergeFilters(a: FilterShape, b: FilterShape): FilterShape | undefined {
  // Only merge if they have exactly the same keys
  const aKeys = Object.keys(a).sort()
  const bKeys = Object.keys(b).sort()
  if (aKeys.length !== bKeys.length) return undefined
  if (!aKeys.every((k, i) => k === bKeys[i])) return undefined
  // Merge array fields by union, keep scalars identical
  const out: Record<string, any> = {}
  for (const k of aKeys) {
    const av = (a as any)[k]
    const bv = (b as any)[k]
    if (Array.isArray(av) && Array.isArray(bv)) {
      out[k] = Array.from(new Set([...av, ...bv]))
    } else if (JSON.stringify(av) === JSON.stringify(bv)) {
      out[k] = av
    } else {
      // conflict on scalar -> cannot merge
      return undefined
    }
  }
  return out
}

export function buildRepoSubscriptions(args: {
  addressA?: string
  rootEventId?: string
  euc?: string
}): RepoSubscriptions {
  const candidates: FilterShape[] = []
  const notes: string[] = []

  const STACKING_KINDS = [1618, 1619, 30410, 30411, 30412]
  const enableStackingFilters =
    (globalThis as {process?: {env?: Record<string, string | undefined>}}).process?.env
      ?.ENABLE_STACKING_FILTERS === "true"

  // Build candidate filters
  if (args.addressA) {
    candidates.push({"#a": [args.addressA]})
    notes.push("Subscribe by repo address (#a)")
    if (enableStackingFilters) {
      // Optional: stacking/collab focused subscription with kinds
      candidates.push({"#a": [args.addressA], kinds: STACKING_KINDS})
      notes.push("Subscribe by repo address with stack/merge kinds")
    }
  }
  if (args.rootEventId) {
    // Fetch the root event itself
    candidates.push({ids: [args.rootEventId]})
    // Fetch events referencing the root (thread/status)
    candidates.push({"#e": [args.rootEventId]})
    if (enableStackingFilters) {
      // Stacking/merge metadata for root
      candidates.push({"#e": [args.rootEventId], kinds: [30411, 30412]})
    }
    notes.push("Subscribe by root id: ids (direct) and #e (referenced)")
  }
  if (args.euc) {
    candidates.push({"#r": [args.euc]})
    notes.push("Subscribe by r:euc grouping key")
  }

  // Dedupe step 1: eliminate exact duplicates
  const seen = new Set<string>()
  const uniques: FilterShape[] = []
  for (const f of candidates) {
    const key = normalizeFilter(f)
    if (!seen.has(key)) {
      seen.add(key)
      uniques.push(f)
    }
  }

  // Dedupe step 2: merge mergeable filters sharing identical key sets
  const merged: FilterShape[] = []
  const byShape = new Map<string, FilterShape>() // key is sorted keys joined
  for (const f of uniques) {
    const mergeable = isMergeable(f)
    const shapeKey = Object.keys(f).sort().join("|")
    if (mergeable && byShape.has(shapeKey)) {
      const prev = byShape.get(shapeKey)!
      const m = mergeFilters(prev, f)
      if (m) {
        byShape.set(shapeKey, m)
      } else {
        // conflicting scalars; keep both
        merged.push(f)
      }
    } else if (mergeable) {
      byShape.set(shapeKey, f)
    } else {
      merged.push(f)
    }
  }
  // Flush maps to array
  merged.push(...byShape.values())

  // Preserve stable order: ids, #e, #a, #r (roughly useful)
  const order = ["ids", "#e", "#a", "#r"]
  const filters = merged.sort((fa, fb) => {
    const aKey = Object.keys(fa)[0]
    const bKey = Object.keys(fb)[0]
    return order.indexOf(aKey) - order.indexOf(bKey)
  })

  return {filters, notes}
}
