import type {RepoCommunityBinding} from "@nostr-git/core/events"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import type {PreferredCommunityRef} from "@app/util/community-preferences"
import type {RepoCiWatcher} from "./types"

/** Only validated, non-renounced memberships enter here, never starred-only communities.
 * Definitions have already passed the canonical kind-32222 protocol parser.
 */
export function selectRepoCiWatchers(
  refs: readonly ActiveUserCommunityRef[],
  preferences: readonly PreferredCommunityRef[],
  association?: RepoCommunityBinding,
): RepoCiWatcher[] {
  const order = new Map(preferences.map((ref, index) => [ref.communityAddress, index]))
  const roleOrder = {admin: 0, moderator: 1, member: 2}
  const candidates = refs
    .flatMap(ref => {
      const role = (["admin", "moderator", "member"] as const).find(role =>
        ref.roles.includes(role),
      )
      if (!role) return []
      const repoMatch = Boolean(
        association &&
        (association.address
          ? association.address === ref.community.address
          : association.communityId === ref.community.communityId),
      )
      return ref.definition.ciRepoWatchers.map(watcher => ({
        pubkey: watcher.pubkey,
        relays: [...watcher.relays],
        communityAddress: ref.community.address,
        communityName: ref.definition.metadata.name || ref.community.communityId,
        role,
        repoMatch,
      }))
    })
    .sort(
      (a, b) =>
        Number(b.repoMatch) - Number(a.repoMatch) ||
        roleOrder[a.role] - roleOrder[b.role] ||
        (order.get(a.communityAddress) ?? Infinity) - (order.get(b.communityAddress) ?? Infinity) ||
        a.communityAddress.localeCompare(b.communityAddress) ||
        a.pubkey.localeCompare(b.pubkey),
    )
  const byPubkey = new Map<string, RepoCiWatcher>()
  for (const candidate of candidates) {
    const existing = byPubkey.get(candidate.pubkey)
    if (existing) existing.relays = [...new Set([...existing.relays, ...candidate.relays])]
    else byPubkey.set(candidate.pubkey, candidate)
  }
  return [...byPubkey.values()]
}
