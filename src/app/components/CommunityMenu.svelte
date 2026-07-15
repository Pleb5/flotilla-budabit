<script lang="ts">
  import {onMount, tick} from "svelte"
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
    activeCommunityDefinition,
    activeCommunityAdmissionForms,
    activeCommunityPermissionStatus,
    activeCommunityProfile,
    activeCommunityProfileListEvents,
    activeCommunityReportDeleteEvents,
    activeCommunityReportEvents,
    activeCommunityReportReviewEvents,
    activeCommunityReportState,
    activeCommunityRelays,
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
  import {makeCommunityRoomRootsFilter} from "@app/core/community-feeds"
  import {readCommunityRoomRoots} from "@app/core/community-rooms"
  import {FORM_RESPONSE_KIND, normalizePubkey} from "@app/core/community"
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
  import {formatShortNpub} from "@app/util/pubkeys"
  import {makeCommunityInputValue} from "@app/util/community-stars"
  import {
    makeCommunityCalendarPath,
    makeGitCommunityPath,
    makeCommunityGoalPath,
    makeCommunityPath,
    makeCommunityRoomPath,
    makeCommunityThreadPath,
  } from "@app/util/routes"

  type Props = {
    community: string
  }

  const {community}: Props = $props()

  const MENU_EVIDENCE_LOAD_TIMEOUT = 5_000
  let admissionEvidenceKey = ""
  let admissionEvidenceLoading = $state(false)
  let admissionEvidenceLoaded = $state(false)
  let reportEvidenceKey = ""
  let reportEvidenceLoading = $state(false)
  let reportEvidenceLoaded = $state(false)

  const shortCommunity = $derived(formatShortNpub(community) || "Community")
  const communityName = $derived(
    $activeCommunityProfile?.display_name || $activeCommunityProfile?.name || shortCommunity,
  )
  const communityPicture = $derived($activeCommunityProfile?.picture || "")
  let failedPicture = $state("")
  const showCommunityPicture = $derived(
    Boolean(communityPicture && failedPicture !== communityPicture),
  )
  const mainRelay = $derived($activeCommunityDefinition?.relays[0] || "")
  const homePath = $derived(makeCommunityPath(community))
  const threadsPath = $derived(makeCommunityThreadPath(community))
  const calendarPath = $derived(makeCommunityCalendarPath(community))
  const goalsPath = $derived(makeCommunityGoalPath(community))
  const adminPath = $derived(makeCommunityPath(community, "admin"))
  const badgesPath = $derived(makeCommunityPath(community, "badges"))
  const accessPath = $derived(makeCommunityPath(community, "access"))
  const moderationPath = $derived(makeCommunityPath(community, "moderation"))
  const gitCommunityInput = $derived(
    community
      ? makeCommunityInputValue({pubkey: community, relayHints: $activeCommunityRelays}) ||
          community
      : "",
  )
  const gitPath = $derived(makeGitCommunityPath(gitCommunityInput))
  const canViewAdmin = $derived(
    Boolean($pubkey && normalizePubkey($pubkey) === normalizePubkey(community)),
  )
  const roomAuthorPubkeys = $derived(
    $activeCommunityDefinition?.pubkey === community
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.roomRoot,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const roomFilters = $derived(
    community && roomAuthorPubkeys.length
      ? [makeCommunityRoomRootsFilter(community, {authors: roomAuthorPubkeys})]
      : [],
  )
  const roomEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: roomFilters})))
  const rooms = $derived(
    readCommunityRoomRoots($roomEvents, community).filter(
      room => !isCommunityPersonBanned($activeCommunityReportState, room.event.pubkey),
    ),
  )
  const badgeDefinitionFilters = $derived(
    $activeCommunityDefinition
      ? makeCommunityBadgeDefinitionFilters({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const badgeDefinitionEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeDefinitionFilters})),
  )
  const badgeDefinitions = $derived.by(() =>
    $activeCommunityDefinition
      ? selectCommunityBadgeDefinitions({
          definition: $activeCommunityDefinition,
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
    $activeCommunityDefinition && $pubkey
      ? getPendingCommunityBadgeAwards({
          definition: $activeCommunityDefinition,
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
    const definition = $activeCommunityDefinition
    const userPubkey = $pubkey

    if (!definition || !userPubkey) return false

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
  const communityPermissionsLoading = $derived(
    Boolean(
      $pubkey &&
      community &&
      $activeCommunityPermissionStatus.communityPubkey === community &&
      $activeCommunityPermissionStatus.loading &&
      !$activeCommunityPermissionStatus.loaded &&
      !$activeCommunityPermissionStatus.hasCachedEvents,
    ),
  )
  const moderationPermissionLoading = $derived(Boolean(communityPermissionsLoading && !canModerate))
  const grantableAdmissionForms = $derived.by(() => {
    const definition = $activeCommunityDefinition
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
    $activeCommunityDefinition
      ? makeCommunityReportReviewFilters($activeCommunityDefinition, $activeCommunityReportEvents)
      : [],
  )
  const reportEvidenceFilters = $derived([...reportDeleteFilters, ...reportReviewFilters])
  const reportReviewEvidenceLoading = $derived(
    Boolean(
      $activeCommunityReportEvents.length > 0 && (reportEvidenceLoading || !reportEvidenceLoaded),
    ),
  )
  const pendingModerationApplicationCount = $derived.by(() => {
    const definition = $activeCommunityDefinition
    if (!definition || admissionReviewEvidenceLoading) return 0

    const sectionByForm = new Map(grantableAdmissionForms.map(item => [item.form.address, item]))
    let count = 0

    for (const event of $admissionResponseEvents) {
      const response = parseAdmissionResponse(event)
      if (!response) continue

      const matched = sectionByForm.get(response.formAddress)
      if (!matched) continue

      const state = getAdmissionSubmissionState({
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
    const definition = $activeCommunityDefinition
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
    Boolean(admissionReviewEvidenceLoading || reportReviewEvidenceLoading),
  )
  const pendingModerationReviewCount = $derived(
    pendingModerationApplicationCount + pendingContentReportGroupCount,
  )
  const canCreateRoom = $derived(
    Boolean(
      $pubkey &&
      $activeCommunityDefinition &&
      $activeCommunityDefinition.pubkey === community &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.roomRoot,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const roomPermissionLoading = $derived(Boolean(communityPermissionsLoading && !canCreateRoom))

  const goHome = () => goto(homePath, {replaceState})
  const login = () => pushModal(LogIn, {}, {replaceState})
  const createRoom = () => {
    if (canCreateRoom) pushModal(CommunityRoomCreate, {communityPubkey: community}, {replaceState})
  }

  let replaceState = $state(false)
  let menuBackgroundHydrationReady = $state(false)
  let element: Element | undefined = $state()

  const waitForPostPaintHydration = async () => {
    await tick()
    if (typeof requestAnimationFrame !== "function") return
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
  }

  onMount(() => {
    let cancelled = false
    replaceState = Boolean(element?.closest(".drawer"))

    void waitForPostPaintHydration().then(() => {
      if (!cancelled) menuBackgroundHydrationReady = true
    })

    return () => {
      cancelled = true
      menuBackgroundHydrationReady = false
    }
  })

  $effect(() => {
    const filters = admissionEvidenceFilters

    if (!menuBackgroundHydrationReady) return

    if (
      !community ||
      $activeCommunityRelays.length === 0 ||
      admissionResponseIds.length === 0 ||
      filters.length === 0
    ) {
      admissionEvidenceKey = ""
      admissionEvidenceLoading = false
      admissionEvidenceLoaded = admissionResponseIds.length === 0
      return
    }

    const key = JSON.stringify({relays: $activeCommunityRelays, filters})
    if (admissionEvidenceKey === key) return

    admissionEvidenceKey = key
    admissionEvidenceLoading = true
    admissionEvidenceLoaded = false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MENU_EVIDENCE_LOAD_TIMEOUT)

    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})
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

    if (!menuBackgroundHydrationReady) return

    if (
      !community ||
      $activeCommunityRelays.length === 0 ||
      $activeCommunityReportEvents.length === 0 ||
      filters.length === 0
    ) {
      reportEvidenceKey = ""
      reportEvidenceLoading = false
      reportEvidenceLoaded = $activeCommunityReportEvents.length === 0
      return
    }

    const key = JSON.stringify({relays: $activeCommunityRelays, filters})
    if (reportEvidenceKey === key) return

    reportEvidenceKey = key
    reportEvidenceLoading = true
    reportEvidenceLoaded = false

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), MENU_EVIDENCE_LOAD_TIMEOUT)

    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})
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
    if (!menuBackgroundHydrationReady) return
    if (!community || $activeCommunityRelays.length === 0) return

    const filters = [
      ...badgeDefinitionFilters,
      ...badgeAwardFilters,
      ...badgeAwardDeleteFilters,
      ...profileBadgeFilters,
      ...admissionResponseFilters,
    ]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})

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

      {#if rooms.length > 0 || canCreateRoom || roomPermissionLoading}
        <SecondaryNavHeader>Rooms</SecondaryNavHeader>
      {/if}

      {#each rooms as room (room.id)}
        {@const roomPath = makeCommunityRoomPath(community, room.id)}
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
      {:else if roomPermissionLoading}
        <SecondaryNavItem disabled title="Loading room permissions">
          <Icon icon={AddCircle} /> Loading room permissions
        </SecondaryNavItem>
      {/if}

      <div aria-hidden="true" class="mx-4 my-1 border-t border-base-300/50"></div>

      <SecondaryNavHeader>Manage</SecondaryNavHeader>

      <SecondaryNavItem {replaceState} href={badgesPath}>
        <Icon icon={MedalStar} /> Badges
        {#if pendingBadgeAwardCount > 0}
          <span class="badge badge-info badge-sm ml-auto">{pendingBadgeAwardCount} new</span>
        {/if}
      </SecondaryNavItem>

      <SecondaryNavItem
        {replaceState}
        href={accessPath}
        notification={$notifications.has(accessPath)}>
        <Icon icon={ShieldUser} /> Membership
        {#if $notifications.has(accessPath)}
          <span class="badge badge-info badge-sm ml-auto">updated</span>
        {/if}
      </SecondaryNavItem>

      {#if canModerate}
        <SecondaryNavItem
          {replaceState}
          href={moderationPath}
          notification={!moderationEvidenceLoading && pendingModerationReviewCount > 0}>
          <Icon icon={ShieldUser} />
          <span class="flex min-w-0 items-center gap-2">
            <span>Moderation</span>
            {#if moderationEvidenceLoading}
              <span class="badge badge-neutral badge-sm shrink-0">checking</span>
            {:else if pendingModerationReviewCount > 0}
              <span class="badge badge-info badge-sm shrink-0">
                {pendingModerationReviewCount} pending
              </span>
            {/if}
          </span>
        </SecondaryNavItem>
      {:else if moderationPermissionLoading}
        <SecondaryNavItem disabled title="Loading moderation permissions">
          <Icon icon={ShieldUser} /> Loading moderation access
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
