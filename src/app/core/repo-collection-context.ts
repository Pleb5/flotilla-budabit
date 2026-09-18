import {derived, type Unsubscriber} from "svelte/store"
import {pubkey, repository} from "@welshman/app"
import {deriveEventsById} from "@welshman/store"
import {REACTION, type TrustedEvent} from "@welshman/util"
import {
  activeUserCommunityRefs,
  activeUserCommunityProfileListEvents,
  communityMemberReportStates,
  hydratePreferredCommunityList,
} from "@app/core/community-state"
import {
  COMMUNITY_WRITE_TARGETS,
  communityWritableSectionsSupportTarget,
  filterAuthorizedCommunityTargetingEvents,
} from "@app/core/community-permissions"
import {repoAnnouncementRelaysStore} from "@app/core/git-state"
import {getRepoStarRelays} from "@app/core/repo-stars-state"
import {loadBoundedCommunityHistory} from "@app/core/requests"
import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
import {createRepoCollectionLoader} from "@app/core/repo-collection-loader"

/** Bind the layout reader to existing shared event/identity stores, once on mount. */
export const createGitRepoCollections = () => {
  const reader = createRepoCollectionLoader({
    query: filters => repository.query(filters, {shouldSort: false}) as TrustedEvent[],
    watch: (filters, onChange) => deriveEventsById({repository, filters}).subscribe(onChange),
    load: options =>
      loadBoundedCommunityHistory({
        ...options,
        priority: RELAY_REQUEST_PRIORITY.background,
      }),
  })
  let unsubscribe: Unsubscriber | undefined
  let preferredCommunitiesKey = ""
  let communitiesReady = false
  let updateScope = () => {}
  return {
    ...reader,
    start() {
      if (unsubscribe) return
      unsubscribe = derived(
        [
          pubkey,
          repoAnnouncementRelaysStore,
          activeUserCommunityRefs,
          activeUserCommunityProfileListEvents,
          communityMemberReportStates,
        ],
        values => values,
      ).subscribe(([user, relays, refs, profileListEvents, reportStates]) => {
        const personalRelays = getRepoStarRelays(relays)
        const communityOptions = refs
          .filter(ref =>
            communityWritableSectionsSupportTarget({
              definition: ref.definition,
              writableSections: ref.writableSections,
              target: COMMUNITY_WRITE_TARGETS.reaction,
            }),
          )
          .map(ref => ({
            ownerPubkey: ref.community.ownerPubkey,
            address: ref.community.address,
            communityId: ref.community.communityId,
            label: ref.definition.metadata.name,
            relays: ref.definition.relays,
          }))
        updateScope = () =>
          reader.configure({
            viewerPubkey: user || "",
            personalRelays,
            communityOptions,
            communitiesReady,
            authorizeTargets: (events, option) => {
              const ref = refs.find(ref => ref.community.address === option.address)
              return ref
                ? filterAuthorizedCommunityTargetingEvents({
                    community: ref.community,
                    definition: ref.definition,
                    profileListEvents,
                    events,
                    reportState: reportStates.get(option.address),
                    kinds: [REACTION],
                  }).filter(event => event.pubkey === user)
                : []
            },
          })
        const key = JSON.stringify([user, personalRelays.slice().sort()])
        if (key !== preferredCommunitiesKey) {
          preferredCommunitiesKey = key
          communitiesReady = !user
          // Use the existing fast preference bootstrap; per-read authentication
          // must not delay the repository grid or create signer requests per card.
          if (user)
            void hydratePreferredCommunityList({relayHints: personalRelays})
              .then(() => {
                if (preferredCommunitiesKey !== key) return
                communitiesReady = true
                updateScope()
              })
              .catch(error => {
                console.warn("[repo-collections] Failed to hydrate preferred communities", error)
              })
        }
        updateScope()
      })
    },
    dispose() {
      unsubscribe?.()
      unsubscribe = undefined
      reader.dispose()
    },
  }
}
