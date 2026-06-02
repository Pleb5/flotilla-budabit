const DEFAULT_BRANCH_FALLBACKS = ["main", "master", "develop", "dev"]

const addRefVariants = (refs: string[], seen: Set<string>, ref: string) => {
  const candidates =
    ref === "HEAD"
      ? ["HEAD"]
      : [ref, `origin/${ref}`, `refs/remotes/origin/${ref}`, `refs/heads/${ref}`]

  for (const candidate of candidates) {
    if (!candidate || seen.has(candidate)) continue
    seen.add(candidate)
    refs.push(candidate)
  }
}

export function buildCommitHistoryRefsToTry(requestedRef?: string): string[] {
  const refs: string[] = []
  const seen = new Set<string>()

  if (requestedRef && requestedRef !== "HEAD") {
    addRefVariants(refs, seen, requestedRef)
    addRefVariants(refs, seen, "HEAD")
  } else {
    addRefVariants(refs, seen, "HEAD")
  }

  for (const fallback of DEFAULT_BRANCH_FALLBACKS) {
    if (fallback === requestedRef) continue
    addRefVariants(refs, seen, fallback)
  }

  return refs
}
