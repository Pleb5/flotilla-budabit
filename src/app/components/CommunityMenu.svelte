<script lang="ts">
  import {onMount} from "svelte"
  import {goto} from "$app/navigation"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE} from "@welshman/util"
  import Hashtag from "@assets/icons/hashtag.svg?dataurl"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Ghost from "@assets/icons/ghost-smile.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic-2.svg?dataurl"
  import MedalStar from "@assets/icons/medal-star.svg?dataurl"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import SecondaryNavHeader from "@lib/components/SecondaryNavHeader.svelte"
  import SecondaryNavItem from "@lib/components/SecondaryNavItem.svelte"
  import SecondaryNavSection from "@lib/components/SecondaryNavSection.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import CommunityRoomCreate from "@app/components/community/CommunityRoomCreate.svelte"
  import SocketStatusIndicator from "@app/components/SocketStatusIndicator.svelte"
  import {pushModal} from "@app/util/modal"
  import {
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeCommunityAdmissionForms,
    activeCommunityDescriptor,
    activeCommunityProfileListEvents,
    activeCommunityReportDeleteEvents,
    activeCommunityReportEvents,
    activeCommunityReportReviewEvents,
    activeCommunityReportState,
    activeExactCommunityRelays,
    makeCommunityReportDeleteFilters,
    makeCommunityReportReviewFilters,
  } from "@app/core/community-state"
  import {
    COMMUNITY_FORM_REVIEW_KIND,
    getAdmissionReviewDisplayStatus,
    getAdmissionSubmissionState,
    parseAdmissionResponse,
  } from "@app/core/community-forms"
  import {
    getPendingCommunityBadgeAwards,
    makeCommunityBadgeAwardDeleteFilters,
    makeCommunityBadgeAwardFilters,
    makeCommunityBadgeDefinitionFilters,
    makeProfileBadgeFilters,
    selectCommunityBadgeDefinitions,
  } from "@app/core/community-badges"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityRoomRootsFilter,
  } from "@app/core/community-feeds"
  import {readCommunityRoomRoots} from "@app/core/community-rooms"
  import {FORM_RESPONSE_KIND, normalizePubkey, type CommunityPointer} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getGrantCapability,
    getGrantCapableSectionModeratorPubkeys,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {
    canReviewCommunityContentReport,
    getCommunityContentReportGroups,
    getCommunityContentReports,
    isCommunityPersonBanned,
  } from "@app/core/community-reports"
  import {ENABLE_ZAPS} from "@app/core/state"
  import {notifications} from "@app/util/notifications"
  import {
    makeExactCommunityCalendarPath,
    makeExactGitCommunityPath,
    makeExactCommunityGoalPath,
    makeExactCommunityPath,
    makeExactCommunityRoomPath,
    makeExactCommunityThreadPath,
  } from "@app/util/routes"

  type Props = {
    community: CommunityPointer
    evidenceReady?: boolean
  }

  const {community, evidenceReady = true}: Props = $props()

  const MENU_EVIDENCE_LOAD_TIMEOUT = 5_000
  let admissionEvidenceKey = ""
  let admissionEvidenceLoading = $state(false)
  let admissionEvidenceLoaded = $state(false)
  let reportEvidenceKey = ""
  let reportEvidenceLoading = $state(false)
  let reportEvidenceLoaded = $state(false)
  let replaceState = $state(false)
  let element: Element | undefined = $state()
  const remoteEvidenceReady = $derived(evidenceReady || replaceState)

  const exactDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === community.address
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const shortCommunity = $derived(`Community ${community.naddr.slice(0, 12)}...`)
  const communityName = $derived(exactDefinition?.metadata.name || shortCommunity)
  const communityPicture = $derived(exactDefinition?.metadata.picture || "")
  let failedPicture = $state("")
  const showCommunityPicture = $derived(
    Boolean(communityPicture && failedPicture !== communityPicture),
  )
  const mainRelay = $derived(exactDefinition?.relays[0] || "")
  const communityAuthorityReadiness = $derived(
    $activeCommunityDescriptor?.community.address === community.address
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityAdmissionFormReadiness = $derived(
    $activeCommunityDescriptor?.community.address === community.address
      ? $activeCommunityDescriptor.admissionFormReadiness.state
      : "loading",
  )
  const communityAuthorityReady = $derived(communityAuthorityReadiness === "ready")
  const exactCommunity = $derived(
    $activeExactCommunityPointer?.address === community.address ? community : undefined,
  )
  const homePath = $derived(exactCommunity ? makeExactCommunityPath(exactCommunity) : "")
  const threadsPath = $derived(exactCommunity ? makeExactCommunityThreadPath(exactCommunity) : "")
  const calendarPath = $derived(
    exactCommunity ? makeExactCommunityCalendarPath(exactCommunity) : "",
  )
  const goalsPath = $derived(exactCommunity ? makeExactCommunityGoalPath(exactCommunity) : "")
  const adminPath = $derived(exactCommunity ? makeExactCommunityPath(exactCommunity, "admin") : "")
  const badgesPath = $derived(
    exactCommunity ? makeExactCommunityPath(exactCommunity, "badges") : "",
  )
  const accessPath = $derived(
    exactCommunity ? makeExactCommunityPath(exactCommunity, "access") : "",
  )
  const moderationPath = $derived(
    exactCommunity ? makeExactCommunityPath(exactCommunity, "moderation") : "",
  )
  const gitPath = $derived(exactCommunity ? makeExactGitCommunityPath(exactCommunity) : "/git")
  const canViewAdmin = $derived(
    Boolean($pubkey && normalizePubkey($pubkey) === normalizePubkey(community.ownerPubkey)),
  )
  const roomAuthorPubkeys = $derived(
    communityAuthorityReady && exactDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: exactDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.roomRoot,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const roomFilterPlan = $derived(
    communityAuthorityReady
      ? makeCommunityContentFilterPlan(
          [makeCommunityRoomRootsFilter(community.communityId)],
          roomAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const roomFilters = $derived(roomFilterPlan.localFilters)
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const rooms = $derived(
    readCommunityRoomRoots($roomEvents, community.communityId).filter(
      room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
    ),
  )
  const badgeDefinitionFilters = $derived(
    communityAuthorityReady && exactDefinition
      ? makeCommunityBadgeDefinitionFilters({
          definition: exactDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const badgeDefinitionEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeDefinitionFilters})),
  )
  const badgeDefinitions = $derived.by(() =>
    communityAuthorityReady && exactDefinition
      ? selectCommunityBadgeDefinitions({
          definition: exactDefinition,
          badgeDefinitionEvents: $badgeDefinitionEvents,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const badgeAwardFilters = $derived(
    $pubkey
      ? makeCommunityBadgeAwardFilters({definitions: badgeDefinitions, recipientPubkey: $pubkey})
      : [],
  )
  const badgeAwardEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeAwardFilters})),
  )
  const badgeAwardDeleteFilters = $derived(makeCommunityBadgeAwardDeleteFilters($badgeAwardEvents))
  const badgeAwardDeleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeAwardDeleteFilters})),
  )
  const profileBadgeFilters = $derived($pubkey ? makeProfileBadgeFilters($pubkey) : [])
  const profileBadgeEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: profileBadgeFilters})),
  )
  const pendingBadgeAwardCount = $derived.by(() =>
    communityAuthorityReady && exactDefinition && $pubkey
      ? getPendingCommunityBadgeAwards({
          definition: exactDefinition,
          badgeDefinitionEvents: $badgeDefinitionEvents,
          profileListEvents: $activeCommunityProfileListEvents,
          badgeAwardEvents: $badgeAwardEvents,
          badgeAwardDeleteEvents: $badgeAwardDeleteEvents,
          profileBadgeEvents: $profileBadgeEvents,
          profilePubkey: $pubkey,
          reportState: $activeCommunityReportState,
        }).length
      : 0,
  )
  const canModerate = $derived.by(() => {
    const definition = exactDefinition
    const userPubkey = $pubkey

    if (!definition || !userPubkey || !communityAuthorityReady) return false

    return definition.sections.some(
      section =>
        getGrantCapability({
          definition,
          userPubkey,
          sectionName: section.name,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        }).canGrant,
    )
  })
  const communityAuthorityLoading = $derived(
    Boolean($pubkey && community && communityAuthorityReadiness === "loading"),
  )
  const communityAuthorityUnavailable = $derived(
    Boolean($pubkey && community && communityAuthorityReadiness === "unavailable"),
  )
  const moderationAccessLoading = $derived(Boolean(communityAuthorityLoading && !canModerate))
  const grantableAdmissionForms = $derived.by(() => {
    const definition = exactDefinition
    const userPubkey = $pubkey

    if (!definition || !userPubkey) return []

    return definition.sections.flatMap(section => {
      const capability = getGrantCapability({
        definition,
        userPubkey,
        sectionName: section.name,
        profileListEvents: $activeCommunityProfileListEvents,
        reportState: $activeCommunityReportState,
      })
      const form = $activeCommunityAdmissionForms[section.name]

      return capability.canGrant && form ? [{sectionName: section.name, form}] : []
    })
  })
  const admissionFormAddresses = $derived(grantableAdmissionForms.map(item => item.form.address))
  const admissionResponseFilters = $derived(
    admissionFormAddresses.length
      ? [{kinds: [FORM_RESPONSE_KIND], "#a": admissionFormAddresses}]
      : [],
  )
  const admissionResponseEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: admissionResponseFilters})),
  )
  const admissionResponseIds = $derived($admissionResponseEvents.map(event => event.id))
  const admissionDeleteFilters = $derived(
    admissionResponseIds.length ? [{kinds: [DELETE], "#e": admissionResponseIds}] : [],
  )
  const admissionReviewFilters = $derived(
    admissionResponseIds.length
      ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": admissionResponseIds}]
      : [],
  )
  const admissionDeleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: admissionDeleteFilters})),
  )
  const admissionReviewEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: admissionReviewFilters})),
  )
  const admissionEvidenceFilters = $derived([...admissionDeleteFilters, ...admissionReviewFilters])
  const admissionReviewEvidenceLoading = $derived(
    Boolean(
      admissionResponseIds.length > 0 && (admissionEvidenceLoading || !admissionEvidenceLoaded),
    ),
  )
  const reportDeleteFilters = $derived(
    makeCommunityReportDeleteFilters($activeCommunityReportEvents),
  )
  const reportReviewFilters = $derived(
    exactDefinition
      ? makeCommunityReportReviewFilters(exactDefinition.pointer, $activeCommunityReportEvents)
      : [],
  )
  const reportEvidenceFilters = $derived([...reportDeleteFilters, ...reportReviewFilters])
  const reportReviewEvidenceLoading = $derived(
    Boolean(
      $activeCommunityReportEvents.length > 0 && (reportEvidenceLoading || !reportEvidenceLoaded),
    ),
  )
  const pendingModerationApplicationCount = $derived.by(() => {
    const definition = exactDefinition
    if (!definition || admissionReviewEvidenceLoading) return 0

    const sectionByForm = new Map(grantableAdmissionForms.map(item => [item.form.address, item]))
    let count = 0

    for (const event of $admissionResponseEvents) {
      const response = parseAdmissionResponse(event)
      if (!response) continue

      const matched = sectionByForm.get(response.formAddress)
      if (!matched) continue

      const state = getAdmissionSubmissionState({
        community: matched.form.community,
        responseEvents: $admissionResponseEvents,
        deleteEvents: $admissionDeleteEvents,
        reviewEvents: $admissionReviewEvents,
        formAddress: response.formAddress,
        applicantPubkey: response.event.pubkey,
        moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({
          definition,
          sectionName: matched.sectionName,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        }),
      })

      if (
        state.response?.event.id === response.event.id &&
        getAdmissionReviewDisplayStatus(state, admissionReviewEvidenceLoading) === "pending"
      ) {
        count += 1
      }
    }

    return count
  })
  const pendingContentReportGroupCount = $derived.by(() => {
    const definition = exactDefinition
    if (!definition || !$pubkey || reportReviewEvidenceLoading) return 0

    const reports = getCommunityContentReports({
      definition,
      reportEvents: $activeCommunityReportEvents,
      reviewEvents: $activeCommunityReportReviewEvents,
      deleteEvents: $activeCommunityReportDeleteEvents,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
    }).filter(report =>
      canReviewCommunityContentReport({
        definition,
        reviewerPubkey: $pubkey || "",
        report,
        profileListEvents: $activeCommunityProfileListEvents,
        reportState: $activeCommunityReportState,
      }),
    )

    return getCommunityContentReportGroups(reports).filter(group => !group.reviewed).length
  })
  const moderationEvidenceLoading = $derived(
    Boolean(
      (canModerate && !remoteEvidenceReady) ||
      communityAdmissionFormReadiness === "loading" ||
      admissionReviewEvidenceLoading ||
      reportReviewEvidenceLoading,
    ),
  )
  const pendingModerationReviewCount = $derived(
    pendingModerationApplicationCount + pendingContentReportGroupCount,
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      exactDefinition &&
      canWriteCommunityTarget({
        definition: exactDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomRoot,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const roomAccessLoading = $derived(Boolean(communityAuthorityLoading && !canCreateRoom))

  const goHome = () => goto(homePath, {replaceState})
  const login = () => pushModal(LogIn, {}, {replaceState})
  const createRoom = () => {
    if (canCreateRoom) pushModal(CommunityRoomCreate, {community}, {replaceState})
  }

  onMount(() => {
    replaceState = Boolean(element?.closest(".drawer"))
  })

  $effect(() => {
    const filters = admissionEvidenceFilters

    if (!remoteEvidenceReady || !canModerate) {
      admissionEvidenceKey = ""
      admissionEvidenceLoading = false
      admissionEvidenceLoaded = false
      return
    }

    if (
      !community ||
      $activeExactCommunityRelays.length === 0 ||
      admissionResponseIds.length === 0 ||
      filters.length === 0
    ) {
      admissionEvidenceKey = ""
      admissionEvidenceLoading = false
      admissionEvidenceLoaded = admissionResponseIds.length === 0
      return
    }

    const key = JSON.stringify({relays: $activeExactCommunityRelays, filters})
    if (admissionEvidenceKey === key) return

    admissionEvidenceKey = key
    admissionEvidenceLoading = true
    admissionEvidenceLoaded = false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MENU_EVIDENCE_LOAD_TIMEOUT)

    request({
      relays: $activeExactCommunityRelays,
      autoClose: true,
      filters,
      signal: controller.signal,
    })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn("[community-menu] Failed to load application review evidence", error)
        }
      })
      .finally(() => {
        clearTimeout(timeout)
        if (admissionEvidenceKey !== key) return
        admissionEvidenceLoading = false
        admissionEvidenceLoaded = true
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    const filters = reportEvidenceFilters

    if (!remoteEvidenceReady || !canModerate) {
      reportEvidenceKey = ""
      reportEvidenceLoading = false
      reportEvidenceLoaded = false
      return
    }

    if (
      !community ||
      $activeExactCommunityRelays.length === 0 ||
      $activeCommunityReportEvents.length === 0 ||
      filters.length === 0
    ) {
      reportEvidenceKey = ""
      reportEvidenceLoading = false
      reportEvidenceLoaded = $activeCommunityReportEvents.length === 0
      return
    }

    const key = JSON.stringify({relays: $activeExactCommunityRelays, filters})
    if (reportEvidenceKey === key) return

    reportEvidenceKey = key
    reportEvidenceLoading = true
    reportEvidenceLoaded = false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MENU_EVIDENCE_LOAD_TIMEOUT)

    request({
      relays: $activeExactCommunityRelays,
      autoClose: true,
      filters,
      signal: controller.signal,
    })
      .catch(error => {
        if (!controller.signal.aborted) {
          console.warn("[community-menu] Failed to load report review evidence", error)
        }
      })
      .finally(() => {
        clearTimeout(timeout)
        if (reportEvidenceKey !== key) return
        reportEvidenceLoading = false
        reportEvidenceLoaded = true
      })

    return () => {
      clearTimeout(timeout)
      controller.abort()
    }
  })

  $effect(() => {
    if (!remoteEvidenceReady || !$pubkey) return
    if (!community || $activeExactCommunityRelays.length === 0) return

    const filters = [
      ...badgeDefinitionFilters,
      ...badgeAwardFilters,
      ...badgeAwardDeleteFilters,
      ...profileBadgeFilters,
      ...(canModerate ? admissionResponseFilters : []),
    ]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({
      relays: $activeExactCommunityRelays,
      autoClose: true,
      filters,
      signal: controller.signal,
    }).catch(error => {
      if (!controller.signal.aborted) {
        console.warn("[community-menu] Failed to load badge and admission evidence", error)
      }
    })

    return () => controller.abort()
  })
</script>

<div bind:this={element} class="flex h-full flex-col justify-between">
  <SecondaryNavSection>
    <Button
      class="flex w-full flex-col rounded-xl p-3 transition-all hover:bg-base-100"
      onclick={goHome}>
      <div class="flex items-center gap-3">
        <div class="center h-9 w-9 shrink-0 overflow-hidden rounded-full bg-base-300">
          {#if showCommunityPicture}
            <img
              alt=""
              src={communityPicture}
              class="h-full w-full object-cover"
              onerror={() => (failedPicture = communityPicture)} />
          {:else}
            <Icon icon={Ghost} />
          {/if}
        </div>
        <div class="min-w-0">
          <strong class="ellipsize block">{communityName}</strong>
        </div>
      </div>
    </Button>

    <div class="flex max-h-[calc(100vh-170px)] min-h-0 flex-col gap-1 overflow-auto">
      {#if !$pubkey}
        <SecondaryNavItem {replaceState} onclick={login}>
          <Icon icon={Key} /> Log in
        </SecondaryNavItem>
      {/if}

      <SecondaryNavItem {replaceState} href={gitPath}>
        <Icon icon={Git} /> Git
      </SecondaryNavItem>

      <SecondaryNavItem
        {replaceState}
        href={threadsPath}
        notification={$notifications.has(threadsPath)}>
        <Icon icon={NotesMinimalistic} /> Threads
      </SecondaryNavItem>

      <SecondaryNavItem
        {replaceState}
        href={calendarPath}
        notification={$notifications.has(calendarPath)}>
        <Icon icon={CalendarMinimalistic} /> Calendar
      </SecondaryNavItem>

      {#if ENABLE_ZAPS}
        <SecondaryNavItem
          {replaceState}
          href={goalsPath}
          notification={$notifications.has(goalsPath)}>
          <Icon icon={StarFallMinimalistic} /> Goals
        </SecondaryNavItem>
      {/if}

      {#if rooms.length > 0 || canCreateRoom || roomAccessLoading || communityAuthorityUnavailable}
        <SecondaryNavHeader>Rooms</SecondaryNavHeader>
      {/if}

      {#each rooms as room (room.id)}
        {@const roomPath = exactCommunity
          ? makeExactCommunityRoomPath(exactCommunity, room.id)
          : ""}
        <SecondaryNavItem
          {replaceState}
          href={roomPath}
          notification={$notifications.has(roomPath)}>
          <Icon icon={Hashtag} />
          <span class="ellipsize">{room.name}</span>
        </SecondaryNavItem>
      {/each}

      {#if canCreateRoom}
        <SecondaryNavItem {replaceState} onclick={createRoom}>
          <Icon icon={AddCircle} /> Create room
        </SecondaryNavItem>
      {:else if roomAccessLoading}
        <SecondaryNavItem disabled title="Loading room access">
          <Icon icon={AddCircle} /> Loading room access
        </SecondaryNavItem>
      {:else if communityAuthorityUnavailable}
        <SecondaryNavItem disabled title="Rooms unavailable">
          <Icon icon={AddCircle} /> Rooms unavailable
        </SecondaryNavItem>
      {/if}

      <div aria-hidden="true" class="mx-4 my-1 border-t border-base-300/50"></div>

      <SecondaryNavHeader>Manage</SecondaryNavHeader>

      <SecondaryNavItem {replaceState} href={badgesPath}>
        <Icon icon={MedalStar} /> Badges
        {#if pendingBadgeAwardCount > 0}
          <span class="badge badge-info badge-sm ml-auto shrink-0 whitespace-nowrap"
            >{pendingBadgeAwardCount} new</span>
        {/if}
      </SecondaryNavItem>

      <SecondaryNavItem {replaceState} href={accessPath}>
        <Icon icon={ShieldUser} /> Membership
        {#if $notifications.has(accessPath)}
          <span class="badge badge-info badge-sm ml-auto shrink-0 whitespace-nowrap">updated</span>
        {/if}
      </SecondaryNavItem>

      {#if canModerate}
        <SecondaryNavItem {replaceState} href={moderationPath}>
          <Icon icon={ShieldUser} />
          <span class="min-w-0 flex-1 truncate">Moderation</span>
          {#if moderationEvidenceLoading}
            <span class="badge badge-neutral badge-sm shrink-0 whitespace-nowrap">checking</span>
          {:else if pendingModerationReviewCount > 0}
            <span class="badge badge-info badge-sm shrink-0 whitespace-nowrap">
              {pendingModerationReviewCount} pending
            </span>
          {/if}
        </SecondaryNavItem>
      {:else if moderationAccessLoading}
        <SecondaryNavItem disabled title="Loading moderation access">
          <Icon icon={ShieldUser} /> Loading moderation access
        </SecondaryNavItem>
      {:else if communityAuthorityUnavailable}
        <SecondaryNavItem {replaceState} href={moderationPath} title="Moderation unavailable">
          <Icon icon={ShieldUser} /> Moderation unavailable
        </SecondaryNavItem>
      {/if}

      {#if canViewAdmin}
        <SecondaryNavItem
          {replaceState}
          href={adminPath}
          notification={$notifications.has(adminPath)}>
          <Icon icon={ShieldUser} /> Admin
        </SecondaryNavItem>
      {/if}
    </div>
  </SecondaryNavSection>

  {#if mainRelay && $pubkey}
    <div class="flex flex-col gap-2 p-4">
      <div class="btn btn-neutral btn-sm">
        <SocketStatusIndicator url={mainRelay} />
      </div>
    </div>
  {/if}
</div>
