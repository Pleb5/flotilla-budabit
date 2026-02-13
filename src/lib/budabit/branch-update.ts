export type BranchChange = {
  name: string
  oldOid?: string
  newOid?: string
  change: "added" | "updated" | "removed"
}

export type RepoUpdateForKey = {
  repoId: string
  updates: BranchChange[]
}

export type RepoStateLike = {
  created_at?: number
}

export const diffBranchHeads = (current: Map<string, string>, remote: Map<string, string>) => {
  const updates: BranchChange[] = []
  for (const [ref, newOid] of remote.entries()) {
    const oldOid = current.get(ref)
    const name = ref.replace("refs/heads/", "")
    if (!oldOid) {
      updates.push({name, newOid, change: "added"})
    } else if (oldOid !== newOid) {
      updates.push({name, oldOid, newOid, change: "updated"})
    }
  }
  for (const [ref, oldOid] of current.entries()) {
    if (remote.has(ref)) continue
    const name = ref.replace("refs/heads/", "")
    updates.push({name, oldOid, change: "removed"})
  }
  return updates
}

export const buildBranchUpdateDedupeKey = (repos: RepoUpdateForKey[]) =>
  repos
    .map(repo => {
      const sortedUpdates = [...repo.updates].sort((a, b) => a.name.localeCompare(b.name))
      const updateKey = sortedUpdates
        .map(update => [update.name, update.change, update.oldOid || "", update.newOid || ""].join(":"))
        .join("|")
      return `${repo.repoId}:${updateKey}`
    })
    .sort()
    .join("||")

export const overlayLatestRepoStates = <T extends RepoStateLike>(
  base: Map<string, T>,
  optimistic: Record<string, T>,
) => {
  const out = new Map(base)
  for (const [repoId, optimisticState] of Object.entries(optimistic)) {
    const existing = out.get(repoId)
    const existingTime = existing?.created_at || 0
    const optimisticTime = optimisticState?.created_at || 0
    if (!existing || optimisticTime >= existingTime) {
      out.set(repoId, optimisticState)
    }
  }
  return out
}
