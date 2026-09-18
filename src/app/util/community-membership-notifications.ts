import {synced} from "@welshman/store"
import type {TrustedEvent} from "@welshman/util"
import {kv} from "@app/core/storage"
import {getProfileListPubkeys, normalizePubkey} from "@app/core/community"
import {findProfileListEvent} from "@app/core/community-permissions"
import type {ActiveUserCommunityRef} from "@app/core/community-membership"
import {makeExactCommunityPath} from "@app/util/routes"
import {buildNotificationSearchText, type NotificationRow} from "@app/util/notification-display"

type MembershipObservation = {id: string; createdAt: number; granted: boolean}
type MembershipAccountState = {
  observations: Record<string, MembershipObservation>
  rows: Array<NotificationRow & {communityAddress: string}>
}
export type CommunityMembershipNotificationState = Record<string, MembershipAccountState>

// Replaceable profile lists do not retain the prior grant on relays. Remember the
// user's observed grants so an unrelated list edit isn't a new membership notice,
// and a removal can still be detected after a reload or loss of the final grant.
export const communityMembershipNotificationState = synced<CommunityMembershipNotificationState>({
  key: "notificationCenter.communityMembership",
  defaultValue: {},
  storage: kv,
})

export const updateCommunityMembershipNotifications = (
  state: CommunityMembershipNotificationState,
  account: string | undefined,
  refs: ActiveUserCommunityRef[],
  profileListEvents: TrustedEvent[],
): CommunityMembershipNotificationState => {
  const viewer = normalizePubkey(account || "")
  if (!viewer) return state
  const previous = state[viewer] || {observations: {}, rows: []}
  let observations = previous.observations
  let rows = previous.rows

  for (const ref of refs) {
    const sectionsByAddress = new Map<string, string[]>()
    for (const section of ref.definition.sections) {
      for (const list of section.profileLists) {
        sectionsByAddress.set(list.address, [
          ...(sectionsByAddress.get(list.address) || []),
          section.name,
        ])
      }
    }
    for (const [address, sections] of sectionsByAddress) {
      const event = findProfileListEvent({address}, profileListEvents)
      if (!event) continue
      const key = `${ref.community.address}:${address}`
      const current = observations[key]
      if (
        current &&
        (event.created_at < current.createdAt ||
          (event.created_at === current.createdAt && event.id >= current.id))
      )
        continue

      const granted = getProfileListPubkeys(event).includes(viewer)
      if (observations === previous.observations) observations = {...observations}
      observations[key] = {id: event.id, createdAt: event.created_at, granted}
      if ((current?.granted || false) === granted || event.pubkey === viewer) continue

      const path = makeExactCommunityPath(ref.community, "access")
      const title = granted ? "Community access granted" : "Community grant removed"
      const contextLabel = sections.join(", ")
      const preview = granted
        ? `You have a publishing grant for ${contextLabel}.`
        : `Your publishing grant for ${contextLabel} was removed. Other grants may still provide access.`
      const row = {
        id: `community-membership:${ref.community.address}:${event.id}`,
        communityAddress: ref.community.address,
        eventId: event.id,
        actorPubkey: event.pubkey,
        source: "community" as const,
        sourceLabel: "Communities",
        type: "community" as const,
        title,
        preview,
        action: granted ? "granted you publishing access in" : "removed your publishing grant in",
        contextLabel,
        actionLabel: "Open access settings",
        path,
        readPath: path,
        expandable: false,
        createdAt: event.created_at,
        searchText: buildNotificationSearchText(title, preview, contextLabel, event.pubkey),
      }
      rows = [row, ...rows.filter(existing => existing.id !== row.id)]
        .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
        .slice(0, 200)
    }
  }

  return observations === previous.observations ? state : {...state, [viewer]: {observations, rows}}
}
