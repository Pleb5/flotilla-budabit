import {
  parsePullRequestEvent,
  type PullRequestEvent,
  type StatusEvent,
} from "@nostr-git/core/events"
import {resolvePrTargetBranch} from "./pr-merge-targets"

/** Historical merge targets used by the optional maintainer-only fork filter. */
export function getMaintainerTargetBranches({
  repoAddresses,
  pullRequests,
  appliedStatuses,
  maintainers,
}: {
  repoAddresses: string[]
  pullRequests: PullRequestEvent[]
  appliedStatuses: StatusEvent[]
  maintainers: Set<string>
}): string[] {
  const addresses = new Set(repoAddresses.filter(Boolean))
  if (addresses.size === 0 || maintainers.size === 0) return []

  const appliedRoots = new Set(
    appliedStatuses
      .filter(status => status.kind === 1631 && maintainers.has(status.pubkey))
      .map(
        status =>
          status.tags.find(tag => tag[0] === "e" && tag[3] === "root")?.[1] ||
          status.tags.find(tag => tag[0] === "e")?.[1],
      )
      .filter(Boolean),
  )
  const targets = new Set<string>()
  for (const event of pullRequests) {
    if (!appliedRoots.has(event.id)) continue
    const pullRequest = parsePullRequestEvent(event)
    if (!addresses.has(pullRequest.repoId)) continue
    const target = resolvePrTargetBranch({
      targetBranch: pullRequest.targetBranch,
      targetBranchError: pullRequest.targetBranchError,
      normalize: branch => branch.trim(),
      // A repository's current default cannot establish a historical merge target.
    })
    if ("branch" in target) targets.add(target.branch)
  }
  return Array.from(targets).sort((a, b) => a.localeCompare(b))
}
