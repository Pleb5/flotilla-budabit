<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {request} from "@welshman/net"
  import {
    getFollows,
    getMutes,
    pubkey as sessionPubkey,
    repository,
    userFollowList,
    userMuteList,
  } from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import type {Filter} from "@welshman/util"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import {PROFILE_LIST_KIND, normalizePubkey, normalizeRelays} from "@app/core/community"
  import {
    COMMUNITY_DISCOVERY_RELAYS,
    activeUserCommunityRefs,
    communityMemberReportDeleteEvents,
    communityMemberReportEvents,
    communityMemberReportStates,
  } from "@app/core/community-state"
  import {
    getProfileFlagReportEvidence,
    getSharedProfileCommunityEvidenceGroups,
    type ProfileFlagReportEvidenceItem,
    type ProfileTrustBadgeTone,
    type SharedProfileCommunityEvidenceGroup,
    type SharedProfileCommunityEvidenceItem,
    type SharedProfileCommunityRole,
  } from "@app/core/profile-trust-badges"
  import {makeEventNevent} from "@app/util/event-links"
  import {getCommunityReportTargetPath} from "@app/util/routes"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"

  type Props = {
    pubkey: string
    relays?: string[]
    class?: string
  }

  const PROFILE_TRUST_EVENT_LIMIT = 200

  const {pubkey, relays = [], class: className = ""}: Props = $props()

  let openGroupKey = $state("")

  const targetProfileListFilters = $derived<Filter[]>(
    pubkey
      ? [
          {kinds: [PROFILE_LIST_KIND], authors: [pubkey], limit: PROFILE_TRUST_EVENT_LIMIT},
          {kinds: [PROFILE_LIST_KIND], "#p": [pubkey], limit: PROFILE_TRUST_EVENT_LIMIT} as Filter,
        ]
      : [],
  )
  const targetProfileListEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetProfileListFilters})),
  )
  const evidenceRelays = $derived.by(() =>
    normalizeRelays([
      ...relays,
      ...COMMUNITY_DISCOVERY_RELAYS,
      ...$activeUserCommunityRefs.flatMap(ref => [...ref.relayHints, ...ref.definition.relays]),
    ]),
  )
  const groups = $derived.by(() =>
    getSharedProfileCommunityEvidenceGroups({
      targetPubkey: pubkey,
      viewerCommunityRefs: $activeUserCommunityRefs,
      profileListEvents: $targetProfileListEvents,
      reportStates: $communityMemberReportStates,
    }),
  )
  const followsOnSocial = $derived.by(() => {
    const viewer = normalizePubkey($sessionPubkey || "")
    const target = normalizePubkey(pubkey)

    $userFollowList

    return Boolean(
      viewer &&
      target &&
      viewer !== target &&
      getFollows(viewer)
        .map(follow => normalizePubkey(follow))
        .includes(target),
    )
  })
  const mutedByYou = $derived.by(() => {
    const viewer = normalizePubkey($sessionPubkey || "")
    const target = normalizePubkey(pubkey)

    $userMuteList

    return Boolean(
      viewer &&
      target &&
      viewer !== target &&
      getMutes(viewer)
        .map(mute => normalizePubkey(mute))
        .includes(target),
    )
  })
  const flagReports = $derived.by(() =>
    getProfileFlagReportEvidence({
      targetPubkey: pubkey,
      viewerPubkey: $sessionPubkey || "",
      viewerCommunityRefs: $activeUserCommunityRefs,
      reportEvents: $communityMemberReportEvents,
      deleteEvents: $communityMemberReportDeleteEvents,
    }),
  )

  const getBadgeClass = (tone: ProfileTrustBadgeTone) => {
    if (tone === "error") return "badge-error"
    if (tone === "warning") return "badge-warning"
    if (tone === "info") return "badge-info"
    if (tone === "success") return "badge-success"
    return "badge-neutral"
  }

  const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`

  const getSingleRolePrefix = (role: SharedProfileCommunityRole) => {
    if (role === "banned") return "Banned in"
    if (role === "member") return "Member of"
    if (role === "moderator") return "Moderator of"
    return "Admin of"
  }

  const getPluralRoleLabel = (role: SharedProfileCommunityRole, count: number) => {
    if (role === "banned") return `Banned in ${count}`
    if (role === "member") return `Member in ${count}`
    if (role === "moderator") return `Moderator of ${count}`
    return `Admin of ${count}`
  }

  const getGroupTitle = (group: SharedProfileCommunityEvidenceGroup) => {
    if (group.role === "banned") return "Community ban evidence"
    if (group.role === "member") return "Shared member evidence"
    if (group.role === "moderator") return "Shared moderator evidence"
    return "Shared admin evidence"
  }

  const getGroupDescription = (group: SharedProfileCommunityEvidenceGroup) => {
    if (group.role === "banned") {
      return "Communities you belong to where this profile is banned."
    }

    return "Communities you and this profile both belong to. Only the highest role per community is shown."
  }

  const getGroupButtonLabel = (group: SharedProfileCommunityEvidenceGroup) =>
    group.items.length === 1
      ? `${getSingleRolePrefix(group.role)} shared community`
      : getPluralRoleLabel(group.role, group.items.length)

  const getItemEvidenceText = (item: SharedProfileCommunityEvidenceItem) => {
    if (item.role === "banned") return pluralize(item.banCount, "ban report")
    if (item.role === "admin") return `Admin of ${pluralize(item.sectionCount, "section")}`
    if (item.role === "moderator") return `Moderator of ${pluralize(item.sectionCount, "section")}`

    return `Member with ${pluralize(item.grantCount, "membership grant")}`
  }

  const getItemSectionNames = (item: SharedProfileCommunityEvidenceItem) => {
    if (item.role === "admin") return item.adminSectionNames
    if (item.role === "moderator") return item.moderatorSections.map(section => section.displayName)
    if (item.role === "member") return item.memberSections.map(section => section.displayName)

    return []
  }

  const formatSectionNames = (names: string[]) => names.join(", ")

  const parseReportTargetAddress = (address: string | undefined) => {
    const [kindValue, pubkeyValue, ...identifierParts] = String(address || "").split(":")
    const kind = Number.parseInt(kindValue || "", 10)
    const pubkey = normalizePubkey(pubkeyValue || "")
    const identifier = identifierParts.join(":")

    return Number.isFinite(kind) && pubkey && identifier ? {kind, pubkey, identifier} : undefined
  }

  const getFlaggedContentPath = (item: ProfileFlagReportEvidenceItem) => {
    const communityPath = getCommunityReportTargetPath(item.communityPubkey, item)
    if (communityPath) return communityPath

    const address = parseReportTargetAddress(item.targetAddress)
    if (address) {
      return `/${nip19.naddrEncode({...address, relays: item.relayHints})}`
    }

    if (item.targetEventId) {
      return `/${makeEventNevent(
        {
          id: item.targetEventId,
          kind: item.targetEventKind,
          pubkey: item.targetPubkey,
        },
        {relays: item.relayHints},
      )}`
    }

    return ""
  }

  const getFlaggedContentLabel = (item: ProfileFlagReportEvidenceItem) => {
    if (item.targetEventTitle) return item.targetEventTitle
    if (item.targetAddress) return item.targetAddress
    if (item.targetEventId) return item.targetEventId

    return "Flagged content"
  }

  const toggleGroup = (key: string) => {
    openGroupKey = openGroupKey === key ? "" : key
  }

  $effect(() => {
    if (!pubkey || evidenceRelays.length === 0 || targetProfileListFilters.length === 0) return

    const controller = new AbortController()

    request({
      relays: evidenceRelays,
      filters: targetProfileListFilters as any,
      autoClose: true,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })

  $effect(() => {
    if (
      openGroupKey &&
      openGroupKey !== "flagged-by-you" &&
      !groups.some(group => group.key === openGroupKey)
    ) {
      openGroupKey = ""
    }
    if (openGroupKey === "flagged-by-you" && flagReports.length === 0) openGroupKey = ""
  })
</script>

{#if groups.length > 0 || followsOnSocial || mutedByYou || flagReports.length > 0}
  <div
    class={`flex flex-wrap items-center gap-1.5 ${className}`}
    aria-label="Profile connection evidence">
    {#if groups.length > 0}
      <span class="mr-0.5 text-xs font-medium opacity-70">Shared communities:</span>
      {#each groups as group (group.key)}
        <div class="relative max-w-full">
          <button
            type="button"
            class={`badge badge-sm h-auto max-w-full cursor-pointer gap-1 py-1 ${getBadgeClass(group.tone)}`}
            aria-expanded={openGroupKey === group.key}
            aria-label={getGroupButtonLabel(group)}
            title={getGroupButtonLabel(group)}
            onclick={() => toggleGroup(group.key)}>
            {#if group.items.length === 1}
              {#each group.items as item (item.key)}
                <span>{getSingleRolePrefix(group.role)}</span>
                <span class="min-w-0 max-w-32 truncate">
                  <ProfileName pubkey={item.communityPubkey} relays={item.relayHints} />
                </span>
              {/each}
            {:else}
              {getPluralRoleLabel(group.role, group.items.length)}
            {/if}
          </button>

          {#if openGroupKey === group.key}
            <InlinePopover
              align="left"
              widthClass="w-80 sm:w-96"
              onClose={() => (openGroupKey = "")}>
              <div class="flex flex-col gap-3 text-sm">
                <div>
                  <div class="font-semibold">{getGroupTitle(group)}</div>
                  <div class="mt-1 text-xs leading-relaxed opacity-70">
                    {getGroupDescription(group)}
                  </div>
                </div>

                <div class="flex flex-col gap-2">
                  {#each group.items as item (item.key)}
                    {@const sectionNames = getItemSectionNames(item)}
                    <div class="rounded-box bg-base-200/60 p-3">
                      <div class="flex min-w-0 items-center gap-2">
                        <ProfileCircle
                          pubkey={item.communityPubkey}
                          relays={item.relayHints}
                          size={7} />
                        <div class="min-w-0 flex-1">
                          <div class="truncate text-sm font-medium">
                            <ProfileName pubkey={item.communityPubkey} relays={item.relayHints} />
                          </div>
                          <div class="text-xs opacity-70">{getItemEvidenceText(item)}</div>
                        </div>
                      </div>

                      {#if sectionNames.length > 0}
                        <div class="mt-2 break-words text-[11px] leading-relaxed opacity-60">
                          {formatSectionNames(sectionNames)}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            </InlinePopover>
          {/if}
        </div>
      {/each}
    {/if}

    {#if followsOnSocial || mutedByYou || flagReports.length > 0}
      <span class="mr-0.5 text-xs font-medium opacity-70" class:ml-1={groups.length > 0}
        >Social:</span>
    {/if}

    {#if followsOnSocial}
      <span
        class="badge badge-neutral badge-sm h-auto py-1"
        title="Your Nostr follow list contains this profile.">
        You follow on social
      </span>
    {/if}

    {#if mutedByYou}
      <span
        class="badge badge-warning badge-sm h-auto py-1"
        title="Your Nostr mute list contains this profile.">
        Muted by You
      </span>
    {/if}

    {#if flagReports.length > 0}
      <div class="relative max-w-full">
        <button
          type="button"
          class="badge badge-warning badge-sm h-auto max-w-full cursor-pointer gap-1 py-1"
          aria-expanded={openGroupKey === "flagged-by-you"}
          aria-label="Show your community flag evidence"
          title="You flagged event(s) authored by this profile in communities you belong to."
          onclick={() => toggleGroup("flagged-by-you")}>
          Flagged by You
        </button>

        {#if openGroupKey === "flagged-by-you"}
          <InlinePopover align="left" widthClass="w-80 sm:w-96" onClose={() => (openGroupKey = "")}>
            <div class="flex flex-col gap-3 text-sm">
              <div>
                <div class="font-semibold">Flag evidence</div>
                <div class="mt-1 text-xs leading-relaxed opacity-70">
                  Event-targeted community reports you authored for this profile.
                </div>
              </div>

              <div class="flex flex-col gap-2">
                {#each flagReports as item (item.key)}
                  {@const flaggedContentPath = getFlaggedContentPath(item)}
                  <div class="rounded-box bg-base-200/60 p-3">
                    <div class="flex min-w-0 items-start gap-2">
                      <ProfileCircle
                        pubkey={item.communityPubkey}
                        relays={item.relayHints}
                        size={7} />
                      <div class="min-w-0 flex-1 text-xs leading-relaxed">
                        <div>
                          You flagged this person in
                          <span class="font-medium">
                            <ProfileName pubkey={item.communityPubkey} relays={item.relayHints} />
                          </span>
                          Community.
                        </div>

                        {#if item.targetEventTitle}
                          <div class="mt-1 opacity-70">Reported event: {item.targetEventTitle}</div>
                        {:else if item.targetAddress}
                          <div class="mt-1 break-all opacity-70">
                            Reported address: {item.targetAddress}
                          </div>
                        {:else if item.targetEventId}
                          <div class="mt-1 break-all opacity-70">
                            Reported event: {item.targetEventId}
                          </div>
                        {/if}

                        {#if flaggedContentPath}
                          <div class="mt-1">
                            <a
                              href={flaggedContentPath}
                              class="text-primary underline-offset-2 hover:underline">
                              View flagged content.
                            </a>
                          </div>
                        {/if}

                        {#if item.reason}
                          <div class="mt-1 opacity-70">Reason: {item.reason}</div>
                        {/if}

                        {#if item.reportContent && item.reportContent !== item.reason}
                          <div class="mt-1 opacity-70">Report note: {item.reportContent}</div>
                        {/if}

                        {#if item.targetEventContent && item.targetEventContent !== getFlaggedContentLabel(item)}
                          <div class="mt-1 line-clamp-3 opacity-70">
                            Content snapshot: {item.targetEventContent}
                          </div>
                        {/if}
                      </div>
                    </div>
                  </div>
                {/each}
              </div>
            </div>
          </InlinePopover>
        {/if}
      </div>
    {/if}
  </div>
{/if}
