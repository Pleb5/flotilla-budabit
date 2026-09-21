<script lang="ts">
  import DateTimeDisplay from "@lib/components/DateTimeDisplay.svelte"
  import {onDestroy, onMount} from "svelte"
  import {get as getStore, writable} from "svelte/store"
  import {page} from "$app/stores"
  import {deriveProfile, pubkey, repository, signer as sessionSigner} from "@welshman/app"
  import {prep, type EventTemplate, type SignedEvent, type TrustedEvent} from "@welshman/util"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import CommunityCreate from "@app/components/CommunityCreate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CommunityModeratorGrantEditor from "@app/components/community/CommunityModeratorGrantEditor.svelte"
  import ModerationReportList from "@app/components/community/ModerationReportList.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {preventDefault, stopPropagation} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeCommunityModeratorRequestReactionEvents,
    activeCommunityModeratorRequestStates,
    activeCommunityModeratorRequests,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityRelays,
    hydratePubkeyProfiles,
    loadCommunityEvents,
    makeCommunityModeratorRequestDeleteFilters,
    makeCommunityModeratorRequestFilters,
    makeCommunityModeratorRequestReactionFilters,
    setActiveExactCommunityDefinition,
  } from "@app/core/community-state"
  import {
    normalizePubkey,
    parseAddressRef,
    parseCommunityDefinition,
    type CommunityDefinitionProfileListRef,
  } from "@app/core/community"
  import {
    getEffectiveCommunityModerationActionsByReporter,
    isCommunityPersonBanned,
    type CommunityModerationAction,
  } from "@app/core/community-reports"
  import {
    makeModeratorGrantEditDefinitionUpdate,
    type ModeratorPromotionRequestState,
    makeModeratorGrantRevokeDefinitionUpdate,
    makeModeratorPromotionDefinitionUpdate,
    makeModeratorRequestReaction,
    makeModeratorRequestReactionDelete,
  } from "@app/core/community-moderator-requests"
  import {
    getCommunityModeratorInviteStates,
    type CommunityModeratorInviteStatus,
  } from "@app/core/community-admin"
  import {
    getCommunityRootPublishRelays,
    getCommunityScopedPublishRelays,
    getPubkeyOutboxRelays,
  } from "@app/core/community-relays"
  import {
    getNextReplacementCreatedAt,
    publishAndVerifyCommunityEvent,
    type CommunityPublishStatusUpdate,
  } from "@app/core/community-publish"
  import {communityAdminSelectedTab, type CommunityAdminTab} from "@app/util/community-admin-tabs"
  import {setChecked} from "@app/util/notifications"
  import {makeExactCommunityPath, parseExactCommunityRouteParam} from "@app/util/routes"

  type RequestStatusFilter = "pending" | "accepted" | "rejected"
  type ModeratorPersonTab = "grants" | "actions"

  type ModeratorSectionGrant = {
    sectionName: string
    displayName: string
    pubkey: string
    profileLists: CommunityDefinitionProfileListRef[]
    status: CommunityModeratorInviteStatus
  }

  type ModeratorGrantPerson = {
    pubkey: string
    grants: ModeratorSectionGrant[]
    grantCount: number
    acceptedGrantCount: number
    pendingGrantCount: number
    declinedGrantCount: number
    banned: boolean
  }

  const parsedCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityAddress = $derived(parsedCommunity?.address || "")
  const communityPubkey = $derived(parsedCommunity?.ownerPubkey || "")
  const ownerProfileStore = $derived(
    communityPubkey ? deriveProfile(communityPubkey, parsedCommunity?.relayHints) : undefined,
  )
  const ownerProfile = $derived(ownerProfileStore ? getStore(ownerProfileStore) : undefined)
  const adminPath = $derived(
    $activeExactCommunityPointer
      ? makeExactCommunityPath($activeExactCommunityPointer, "admin")
      : "",
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityAddress &&
      $activeExactCommunityPointer?.address === communityAddress &&
      $activeExactCommunityDefinition?.pointer.address === communityAddress &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityBootstrapFailed = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityDescriptor?.community.address === communityAddress
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityAdminLoading = $derived(
    communityBootstrapLoading ||
      (communityBootstrapReady && communityAuthorityReadiness === "loading"),
  )
  const communityAdminUnavailable = $derived(
    communityBootstrapFailed || communityAuthorityReadiness === "unavailable",
  )
  const retryCommunityAdmin = () => window.location.reload()
  let adminTab = $state<CommunityAdminTab>("settings")
  let adminTabHydrated = $state(false)
  let requestStatusFilter = $state<RequestStatusFilter>("pending")
  let moderatorPersonTabs = $state<Record<string, ModeratorPersonTab>>({})
  let moderatorRequestHydrationKey = $state("")
  let moderatorReactionHydrationKey = $state("")
  let moderatorDeleteHydrationKey = $state("")
  const adminPublishStatus = writable("")

  const makeHydrationKey = (relays: string[], filters: unknown[]) =>
    JSON.stringify({relays: relays.slice().sort(), filters})

  const canEditCommunity = $derived(
    Boolean(
      $pubkey &&
      communityBootstrapReady &&
      $activeExactCommunityDefinition &&
      normalizePubkey($pubkey) === normalizePubkey($activeExactCommunityDefinition.ownerPubkey),
    ),
  )
  const settingsScopeKey = $derived(`${communityAddress}:${$pubkey || ""}`)
  let mountedSettingsScope = $state("")
  $effect(() => {
    if (
      canEditCommunity &&
      !communityAdminLoading &&
      !communityAdminUnavailable &&
      adminTab === "settings"
    ) {
      mountedSettingsScope = settingsScopeKey
    }
  })
  // A replacement definition temporarily reloads permissions. Keep an already
  // opened owner editor mounted so this refresh cannot discard its draft.
  const keepSettingsEditor = $derived(
    adminTab === "settings" && canEditCommunity && mountedSettingsScope === settingsScopeKey,
  )
  const moderatorRequestFilters = $derived(
    communityBootstrapReady && $activeExactCommunityDefinition
      ? makeCommunityModeratorRequestFilters($activeExactCommunityDefinition)
      : [],
  )
  const moderatorRequestReactionFilters = $derived(
    communityBootstrapReady && $activeExactCommunityDefinition
      ? makeCommunityModeratorRequestReactionFilters(
          $activeExactCommunityDefinition,
          $activeCommunityModeratorRequests,
        )
      : [],
  )
  const moderatorRequestDeleteFilters = $derived(
    communityBootstrapReady && $activeExactCommunityDefinition
      ? makeCommunityModeratorRequestDeleteFilters(
          $activeExactCommunityDefinition,
          $activeCommunityModeratorRequestReactionEvents,
        )
      : [],
  )
  const pendingModeratorRequests = $derived(
    $activeCommunityModeratorRequestStates.filter(request => request.status === "pending"),
  )
  const acceptedModeratorRequests = $derived(
    $activeCommunityModeratorRequestStates.filter(request => request.status === "accepted"),
  )
  const rejectedModeratorRequests = $derived(
    $activeCommunityModeratorRequestStates.filter(request => request.status === "rejected"),
  )
  const visibleModeratorRequests = $derived(
    $activeCommunityModeratorRequestStates.filter(
      request => request.status === requestStatusFilter,
    ),
  )
  const requestStatusTabs = $derived([
    {status: "pending" as const, label: "Pending", count: pendingModeratorRequests.length},
    {status: "accepted" as const, label: "Accepted", count: acceptedModeratorRequests.length},
    {status: "rejected" as const, label: "Rejected", count: rejectedModeratorRequests.length},
  ])
  const moderatorInviteStates = $derived(
    communityBootstrapReady
      ? getCommunityModeratorInviteStates({
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
        })
      : [],
  )
  const moderatorSectionGrants = $derived.by((): ModeratorSectionGrant[] => {
    if (!communityBootstrapReady) return []

    const definition = $activeExactCommunityDefinition
    if (!definition) return []

    const communityOwner = normalizePubkey(definition.ownerPubkey)

    return definition.sections.flatMap(section => {
      const pubkeys = Array.from(
        new Set(
          section.profileLists
            .map(ref => parseAddressRef(ref.address)?.pubkey || "")
            .map(normalizePubkey)
            .filter(Boolean),
        ),
      )

      return pubkeys.flatMap(userPubkey => {
        if (userPubkey === communityOwner) return []

        const profileLists = section.profileLists.filter(
          ref => normalizePubkey(parseAddressRef(ref.address)?.pubkey || "") === userPubkey,
        )
        if (profileLists.length === 0) return []
        const statuses = moderatorInviteStates
          .filter(
            invite => invite.sectionName === section.name && invite.moderatorPubkey === userPubkey,
          )
          .map(invite => invite.status)
        const status: CommunityModeratorInviteStatus = statuses.includes("accepted")
          ? "accepted"
          : statuses.includes("pending")
            ? "pending"
            : "declined"

        return [
          {
            sectionName: section.name,
            displayName: section.name,
            pubkey: userPubkey,
            profileLists,
            status,
          },
        ]
      })
    })
  })
  const moderatorGrantPeople = $derived.by((): ModeratorGrantPerson[] => {
    const people = new Map<string, ModeratorSectionGrant[]>()

    for (const grant of moderatorSectionGrants) {
      people.set(grant.pubkey, [...(people.get(grant.pubkey) || []), grant])
    }

    return Array.from(people.entries())
      .map(([userPubkey, grants]) => {
        const acceptedGrantCount = grants.filter(grant => grant.status === "accepted").length
        const pendingGrantCount = grants.filter(grant => grant.status === "pending").length
        const declinedGrantCount = grants.filter(grant => grant.status === "declined").length

        return {
          pubkey: userPubkey,
          grants: grants.toSorted((a, b) => a.displayName.localeCompare(b.displayName)),
          grantCount: grants.length,
          acceptedGrantCount,
          pendingGrantCount,
          declinedGrantCount,
          banned: isCommunityPersonBanned($activeCommunityReportState, userPubkey),
        }
      })
      .toSorted((a, b) => b.grantCount - a.grantCount || a.pubkey.localeCompare(b.pubkey))
  })
  const activeModeratorCount = $derived(
    moderatorGrantPeople.filter(person => !person.banned && person.acceptedGrantCount > 0).length,
  )
  const pendingModeratorInviteCount = $derived(
    moderatorInviteStates.filter(invite => invite.status === "pending").length,
  )
  const declinedModeratorInviteCount = $derived(
    moderatorInviteStates.filter(invite => invite.status === "declined").length,
  )
  const communityPublishRelays = $derived(
    getCommunityScopedPublishRelays($activeExactCommunityDefinition),
  )
  const communityProfileRelays = $derived(
    $activeExactCommunityRelays.length > 0 ? $activeExactCommunityRelays : communityPublishRelays,
  )
  const communityDefinitionPublishRelays = $derived(
    getCommunityRootPublishRelays(communityPublishRelays, undefined, {
      outboxRelays: getPubkeyOutboxRelays($pubkey || $activeExactCommunityDefinition?.ownerPubkey),
    }),
  )
  const communityPrimaryRelay = $derived(communityPublishRelays[0] || "")
  let moderatorProfileHydrationKey = ""
  $effect(() => {
    const pubkeys = moderatorGrantPeople.map(person => person.pubkey)
    const key = `${communityProfileRelays.join(",")}:${pubkeys.join(",")}`
    if (!communityBootstrapReady || pubkeys.length === 0 || key === moderatorProfileHydrationKey)
      return

    moderatorProfileHydrationKey = key
    hydratePubkeyProfiles({pubkeys, relayHints: communityProfileRelays}).catch(error => {
      console.warn("[community/admin] Failed to hydrate moderator profiles", error)
    })
  })

  const openProfile = (profilePubkey: string) => {
    pushModal(ProfileDetail, {
      pubkey: profilePubkey,
      url: communityProfileRelays[0],
      relays: communityProfileRelays,
    })
  }

  const moderationActionsByReporter = $derived.by((): Map<string, CommunityModerationAction[]> => {
    const reports = new Map<string, CommunityModerationAction[]>()

    for (const person of moderatorGrantPeople) {
      reports.set(
        person.pubkey,
        getEffectiveCommunityModerationActionsByReporter(
          $activeCommunityReportState,
          person.pubkey,
        ),
      )
    }

    return reports
  })

  const statusClass = (status: RequestStatusFilter) => {
    if (status === "accepted") return "badge-success"
    if (status === "rejected") return "badge-error"

    return "badge-warning"
  }

  const inviteStatusClass = (status: CommunityModeratorInviteStatus) => {
    if (status === "accepted") return "badge-success"
    if (status === "declined") return "badge-error"

    return "badge-warning"
  }

  const getSubmittedAt = (request: ModeratorPromotionRequestState) =>
    request.profileList.event.created_at

  const getRequestTimeLabel = (request: ModeratorPromotionRequestState) =>
    request.derivedFromGrant ? "Granted" : "Submitted"

  const getRequestTime = (request: ModeratorPromotionRequestState) =>
    request.derivedFromGrant ? request.statusChangedAt : getSubmittedAt(request)

  const getActiveReviewReactions = (request: ModeratorPromotionRequestState) => [
    ...request.acceptanceReactions,
    ...request.rejectionReactions,
  ]

  const getModeratorPersonTab = (userPubkey: string): ModeratorPersonTab =>
    moderatorPersonTabs[userPubkey] || "grants"

  const selectModeratorPersonTab = (userPubkey: string, tab: ModeratorPersonTab) => {
    moderatorPersonTabs = {...moderatorPersonTabs, [userPubkey]: tab}
  }

  const assertCanPublish = () => {
    if (!communityBootstrapReady || !$activeExactCommunityDefinition || !canEditCommunity) {
      pushToast({theme: "error", message: "Log in as this community owner pubkey first."})
      return false
    }

    if (!$sessionSigner) {
      pushToast({theme: "error", message: "No active signer is available."})
      return false
    }

    if (communityPublishRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return false
    }

    return true
  }

  const getAdminPublishErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

  const signCommunityAdminEvent = async (
    template: EventTemplate,
    createdAt?: number,
  ): Promise<SignedEvent> => {
    if (!$activeExactCommunityDefinition || !$sessionSigner) {
      throw new Error("Log in as this community owner pubkey first.")
    }

    return $sessionSigner.sign(
      prep(template, $activeExactCommunityDefinition.ownerPubkey, createdAt),
    )
  }

  const publishVerifiedAdminEvent = async ({
    template,
    relays,
    label,
    createdAt,
    requiredRelay = communityPrimaryRelay,
  }: {
    template: EventTemplate
    relays: string[]
    label: string
    createdAt?: number
    requiredRelay?: string
  }): Promise<TrustedEvent> => {
    const event = await signCommunityAdminEvent(template, createdAt)
    const verified = await publishAndVerifyCommunityEvent({
      event,
      relays,
      requiredRelay,
      label,
      setStatus: adminPublishStatus.set as CommunityPublishStatusUpdate,
    })

    repository.publish(verified)

    return verified
  }

  const publishVerifiedDefinitionUpdate = async (template: EventTemplate, label: string) => {
    const verified = await publishVerifiedAdminEvent({
      template,
      relays: communityDefinitionPublishRelays,
      requiredRelay: communityPrimaryRelay,
      label,
      createdAt: getNextReplacementCreatedAt([$activeExactCommunityDefinition?.event]),
    })
    const definition = parseCommunityDefinition(verified)

    if (definition) {
      setActiveExactCommunityDefinition(definition)
    }

    return verified
  }

  const runVerifiedAdminAction = async (action: () => Promise<void>) => {
    adminPublishStatus.set("")

    try {
      await action()
    } catch (error) {
      const message = getAdminPublishErrorMessage(error)
      adminPublishStatus.set(message)
      pushToast({theme: "error", message: `Admin update failed: ${message}`})
      throw error
    }
  }

  const publishModeratorReview = async (
    requestState: ModeratorPromotionRequestState,
    content: "+" | "-",
  ) => {
    const profileListReaction = makeModeratorRequestReaction({
      request: requestState,
      target: requestState.profileList,
      content,
    })

    return publishVerifiedAdminEvent({
      template: profileListReaction,
      relays: communityPublishRelays,
      label: content === "+" ? "moderator request acceptance" : "moderator request rejection",
    })
  }

  const deleteActiveReviewReactions = async (requestState: ModeratorPromotionRequestState) => {
    const reactions = getActiveReviewReactions(requestState)

    for (const [index, reaction] of reactions.entries()) {
      const deleteEvent = makeModeratorRequestReactionDelete({
        community: requestState.community,
        reactionId: reaction.id,
      })

      await publishVerifiedAdminEvent({
        template: deleteEvent,
        relays: communityPublishRelays,
        label: `moderator review cleanup ${index + 1} of ${reactions.length}`,
      })
    }
  }

  const publishModeratorRequestAcceptance = async (
    requestState: ModeratorPromotionRequestState,
  ) => {
    await runVerifiedAdminAction(async () => {
      await deleteActiveReviewReactions(requestState)
      await publishModeratorReview(requestState, "+")
      const definitionUpdate = makeModeratorPromotionDefinitionUpdate({
        definition: $activeExactCommunityDefinition!,
        request: requestState,
      })

      await publishVerifiedDefinitionUpdate(definitionUpdate, "community definition update")
      adminPublishStatus.set("Moderator request accepted and verified on relay.")
      refreshModeratorRequests()
      pushToast({theme: "success", message: "Moderator request accepted."})
    })
  }

  const acceptModeratorRequest = (requestState: ModeratorPromotionRequestState) => {
    if (!assertCanPublish() || !$activeExactCommunityDefinition) return

    if (
      !$activeExactCommunityDefinition.sections.some(
        section => section.name === requestState.sectionName,
      )
    ) {
      pushToast({theme: "error", message: "This request targets a section that no longer exists."})
      return
    }

    adminPublishStatus.set("")
    pushModal(Confirm, {
      title: "Accept moderator request",
      message: `Add this pubkey as a moderator for ${requestState.sectionName}?`,
      status: adminPublishStatus,
      confirm: async () => {
        try {
          await publishModeratorRequestAcceptance(requestState)
          history.back()
        } catch {
          // Keep the modal open so the verified publish error remains visible.
        }
      },
    })
  }

  const publishModeratorRequestRejection = async (
    requestState: ModeratorPromotionRequestState,
    revokeGrant: boolean,
  ) => {
    await runVerifiedAdminAction(async () => {
      if (revokeGrant) {
        await deleteActiveReviewReactions(requestState)
        const definitionUpdate = makeModeratorGrantRevokeDefinitionUpdate({
          definition: $activeExactCommunityDefinition!,
          sectionName: requestState.sectionName,
          moderatorPubkey: requestState.requesterPubkey,
        })

        await publishVerifiedDefinitionUpdate(definitionUpdate, "community definition update")
      }

      await publishModeratorReview(requestState, "-")
      adminPublishStatus.set(
        revokeGrant
          ? "Moderator grant revoked and verified on relay."
          : "Moderator request rejected and verified on relay.",
      )
      refreshModeratorRequests()
      pushToast({
        theme: "warning",
        message: revokeGrant ? "Moderator grant revoked." : "Moderator request rejected.",
      })
    })
  }

  const rejectModeratorRequest = (requestState: ModeratorPromotionRequestState) => {
    if (!assertCanPublish() || !$activeExactCommunityDefinition) return

    const revokeGrant = requestState.status === "accepted"

    if (revokeGrant) {
      const section = $activeExactCommunityDefinition.sections.find(
        section => section.name === requestState.sectionName,
      )
      const hasProfileListRef = section?.profileLists.some(
        ref => ref.address === requestState.profileListRef.address,
      )

      if (!section || !hasProfileListRef) {
        pushToast({theme: "error", message: "This moderator grant is no longer active."})
        return
      }
    }

    adminPublishStatus.set("")
    pushModal(Confirm, {
      title: revokeGrant ? "Revoke moderator grant" : "Reject moderator request",
      message: revokeGrant
        ? `Remove this pubkey as a moderator for ${requestState.sectionName}?`
        : `Reject this request for ${requestState.sectionName}?`,
      status: adminPublishStatus,
      confirm: async () => {
        try {
          await publishModeratorRequestRejection(requestState, revokeGrant)
          history.back()
        } catch {
          // Keep the modal open so the verified publish error remains visible.
        }
      },
    })
  }

  const saveModeratorGrants = async (moderatorPubkey: string, sectionNames: string[]) => {
    if (!assertCanPublish() || !$activeExactCommunityDefinition) return

    await runVerifiedAdminAction(async () => {
      const definitionUpdate = makeModeratorGrantEditDefinitionUpdate({
        definition: $activeExactCommunityDefinition!,
        moderatorPubkey,
        sectionNames,
        relays: communityPublishRelays,
      })

      await publishVerifiedDefinitionUpdate(definitionUpdate, "community definition update")
      adminPublishStatus.set("Moderator grants verified on relay.")
      pushToast({
        theme: sectionNames.length > 0 ? "success" : "warning",
        message:
          sectionNames.length > 0 ? "Moderator grants updated." : "Moderator grants removed.",
      })
    })
  }

  const openModeratorGrantEditor = (person: ModeratorGrantPerson) => {
    if (!assertCanPublish() || !$activeExactCommunityDefinition) return

    adminPublishStatus.set("")
    pushModal(CommunityModeratorGrantEditor, {
      pubkey: person.pubkey,
      relays: communityProfileRelays,
      sections: $activeExactCommunityDefinition.sections.map(section => ({
        name: section.name,
        displayName: section.name,
      })),
      selectedSectionNames: person.grants.map(grant => grant.sectionName),
      onSave: (sectionNames: string[]) => saveModeratorGrants(person.pubkey, sectionNames),
      status: adminPublishStatus,
    })
  }

  const refreshModeratorRequests = () => {
    moderatorRequestHydrationKey = ""
    moderatorReactionHydrationKey = ""
    moderatorDeleteHydrationKey = ""
  }

  const selectAdminTab = (tab: CommunityAdminTab) => {
    adminTab = tab
    if (tab === "requests") refreshModeratorRequests()
  }

  onMount(() => {
    const savedTab = getStore(communityAdminSelectedTab)
    if (savedTab && savedTab !== adminTab) adminTab = savedTab
    adminTabHydrated = true
  })

  $effect(() => {
    if (!adminTabHydrated) return
    if ($communityAdminSelectedTab !== adminTab) communityAdminSelectedTab.set(adminTab)
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeExactCommunityRelays.length === 0) return
    if (moderatorRequestFilters.length === 0) return
    const key = makeHydrationKey($activeExactCommunityRelays, moderatorRequestFilters)
    if (key === moderatorRequestHydrationKey) return

    moderatorRequestHydrationKey = key
    void loadCommunityEvents($activeExactCommunityRelays, moderatorRequestFilters).catch(error => {
      console.warn("[community] Failed to hydrate admin moderator requests", error)
    })
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeExactCommunityRelays.length === 0) return
    if (moderatorRequestReactionFilters.length === 0) return
    const key = makeHydrationKey($activeExactCommunityRelays, moderatorRequestReactionFilters)
    if (key === moderatorReactionHydrationKey) return

    moderatorReactionHydrationKey = key
    void loadCommunityEvents($activeExactCommunityRelays, moderatorRequestReactionFilters).catch(
      error => {
        console.warn("[community] Failed to hydrate admin moderator request reviews", error)
      },
    )
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeExactCommunityRelays.length === 0) return
    if (moderatorRequestDeleteFilters.length === 0) return
    const key = makeHydrationKey($activeExactCommunityRelays, moderatorRequestDeleteFilters)
    if (key === moderatorDeleteHydrationKey) return

    moderatorDeleteHydrationKey = key
    void loadCommunityEvents($activeExactCommunityRelays, moderatorRequestDeleteFilters).catch(
      error => {
        console.warn("[community] Failed to hydrate admin moderator review deletes", error)
      },
    )
  })

  onDestroy(() => {
    setChecked(adminPath || $page.url.pathname)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Settings} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Admin</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={$activeExactCommunityPointer?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-8">
  {#if communityAdminLoading && !keepSettingsEditor}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading Community Admin...</Spinner>
    </p>
  {:else if (communityAdminUnavailable && !keepSettingsEditor) || !communityBootstrapReady || !$activeExactCommunityDefinition}
    <div class="flex flex-col items-center gap-3 py-8 text-center opacity-70">
      <p>Community Admin unavailable.</p>
      <Button class="btn btn-neutral btn-sm" onclick={retryCommunityAdmin}>Retry</Button>
    </div>
  {:else if !canEditCommunity}
    <p class="py-8 text-center opacity-70">
      Log in as this community owner pubkey to publish community definition updates.
    </p>
  {:else}
    <div class="flex flex-wrap gap-2">
      <Button
        class={`btn ${adminTab === "settings" ? "btn-primary" : "btn-ghost"}`}
        onclick={() => selectAdminTab("settings")}>
        Community settings
      </Button>
      <Button
        class={`btn ${adminTab === "requests" ? "btn-primary" : pendingModeratorRequests.length > 0 ? "btn-warning" : "btn-ghost"}`}
        onclick={() => selectAdminTab("requests")}>
        Moderator requests
        {#if pendingModeratorRequests.length > 0}
          <span class="badge badge-warning ml-2">{pendingModeratorRequests.length}</span>
        {/if}
      </Button>
      <Button
        class={`btn ${adminTab === "moderators" ? "btn-primary" : "btn-ghost"}`}
        onclick={() => selectAdminTab("moderators")}>
        Moderators
        <span class="badge ml-2">{activeModeratorCount}</span>
      </Button>
    </div>

    {#if adminTab === "settings"}
      <CommunityCreate
        mode="edit"
        definition={$activeExactCommunityDefinition}
        permissionsReady={!communityAdminLoading && !communityAdminUnavailable}
        profile={ownerProfile}
        embedded />
    {:else if adminTab === "requests"}
      <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">Moderator requests</h2>
          </div>
          {#if pendingModeratorRequests.length > 0}
            <span class="badge badge-warning">{pendingModeratorRequests.length} pending</span>
          {/if}
        </div>

        <div class="flex flex-wrap gap-2">
          {#each requestStatusTabs as tab}
            <Button
              class={`btn btn-sm ${requestStatusFilter === tab.status ? "btn-primary" : tab.status === "pending" && tab.count > 0 ? "btn-warning" : "btn-ghost"}`}
              onclick={() => (requestStatusFilter = tab.status)}>
              {tab.label}
              <span class="badge ml-2">{tab.count}</span>
            </Button>
          {/each}
        </div>

        <div class="flex flex-col gap-3">
          {#each visibleModeratorRequests as moderatorRequest (`${moderatorRequest.requesterPubkey}:${moderatorRequest.sectionName}`)}
            <article
              class={`rounded-box border border-base-300 bg-base-100 p-4 ${moderatorRequest.status === "pending" ? "border-warning bg-warning/10" : ""}`}>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <strong>{moderatorRequest.sectionName}</strong>
                    <span class={`badge ${statusClass(moderatorRequest.status)}`}
                      >{moderatorRequest.status}</span>
                  </div>
                  <p class="mt-1 text-sm opacity-70">
                    Requester:
                    <ProfileLink
                      pubkey={moderatorRequest.requesterPubkey}
                      relays={communityProfileRelays} />
                  </p>
                  <p class="text-xs opacity-60">
                    {getRequestTimeLabel(moderatorRequest)}
                    <DateTimeDisplay value={getRequestTime(moderatorRequest) * 1000} options={{showTimeZone: true}} />
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button
                    class="btn btn-error btn-sm"
                    disabled={moderatorRequest.status === "rejected" ||
                      moderatorRequest.derivedFromGrant}
                    onclick={() => rejectModeratorRequest(moderatorRequest)}>
                    {moderatorRequest.status === "accepted" ? "Revoke grant" : "Reject"}
                  </Button>
                  <Button
                    class="btn btn-success btn-sm"
                    disabled={moderatorRequest.status === "accepted"}
                    onclick={() => acceptModeratorRequest(moderatorRequest)}>
                    Accept
                  </Button>
                </div>
              </div>

              {#if moderatorRequest.derivedFromGrant}
                <p class="mt-3 rounded-box bg-info/10 p-3 text-sm text-info">
                  Grant exists; original request is unavailable.
                </p>
              {/if}
            </article>
          {:else}
            <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70">
              No {requestStatusFilter} moderator requests.
            </p>
          {/each}
        </div>
      </section>
    {:else}
      <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">Moderators</h2>
            <p class="text-sm opacity-70">
              Review section moderator grants grouped by pubkey. The community key is always allowed
              and is not listed here. Person bans disable moderator powers without revoking grant
              refs.
            </p>
          </div>
          <span class="badge badge-neutral">
            {activeModeratorCount}
            {activeModeratorCount === 1 ? "active moderator" : "active moderators"}
          </span>
          {#if pendingModeratorInviteCount > 0}
            <span class="badge badge-warning">{pendingModeratorInviteCount} pending</span>
          {/if}
          {#if declinedModeratorInviteCount > 0}
            <span class="badge badge-error">{declinedModeratorInviteCount} declined</span>
          {/if}
        </div>

        <div class="flex flex-col gap-3">
          {#each moderatorGrantPeople as person (person.pubkey)}
            {@const personActions = moderationActionsByReporter.get(person.pubkey) || []}
            <details class="rounded-box border border-base-300 bg-base-100">
              <summary class="cursor-pointer p-4 marker:text-primary">
                <div
                  class="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center justify-between gap-3 align-top">
                  <div class="flex min-w-0 items-center gap-3">
                    <Button
                      class="rounded-full p-0"
                      aria-label="View moderator profile"
                      title="View moderator profile"
                      onclick={stopPropagation(preventDefault(() => openProfile(person.pubkey)))}>
                      <ProfileCircle
                        pubkey={person.pubkey}
                        relays={communityProfileRelays}
                        size={9} />
                    </Button>
                    <div class="min-w-0">
                      <strong
                        ><ProfileLink
                          pubkey={person.pubkey}
                          relays={communityProfileRelays} /></strong>
                      {#if person.banned}
                        <span class="badge badge-error mt-1">banned</span>
                      {/if}
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <Button
                      class="btn btn-primary btn-sm"
                      onclick={stopPropagation(
                        preventDefault(() => openModeratorGrantEditor(person)),
                      )}>
                      Edit grants
                    </Button>
                    <span class="badge badge-success">
                      {person.acceptedGrantCount} active
                    </span>
                    {#if person.pendingGrantCount > 0}
                      <span class="badge badge-warning">{person.pendingGrantCount} pending</span>
                    {/if}
                    {#if person.declinedGrantCount > 0}
                      <span class="badge badge-error">{person.declinedGrantCount} declined</span>
                    {/if}
                    <span class="badge badge-warning">
                      {personActions.length}
                      {personActions.length === 1 ? "action" : "actions"}
                    </span>
                  </div>
                </div>
              </summary>

              <div class="border-t border-base-300 p-4">
                <div class="mb-4 flex flex-wrap gap-2">
                  <Button
                    class={`btn btn-sm ${getModeratorPersonTab(person.pubkey) === "grants" ? "btn-primary" : "btn-ghost"}`}
                    onclick={() => selectModeratorPersonTab(person.pubkey, "grants")}>
                    Section grants
                    <span class="badge ml-2">{person.grantCount}</span>
                  </Button>
                  <Button
                    class={`btn btn-sm ${getModeratorPersonTab(person.pubkey) === "actions" ? "btn-primary" : "btn-ghost"}`}
                    onclick={() => selectModeratorPersonTab(person.pubkey, "actions")}>
                    Recent actions
                    <span class="badge ml-2">{personActions.length}</span>
                  </Button>
                </div>

                {#if getModeratorPersonTab(person.pubkey) === "actions"}
                  <ModerationReportList
                    reports={personActions}
                    relays={communityProfileRelays}
                    emptyMessage="No active moderation actions from this moderator." />
                {:else}
                  <div class="flex flex-col gap-3">
                    {#each person.grants as grant (`${grant.sectionName}:${grant.pubkey}`)}
                      <article class="rounded-box bg-base-200 p-3">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div class="flex flex-wrap items-center gap-2">
                              <strong>{grant.displayName}</strong>
                              <span class={`badge ${inviteStatusClass(grant.status)}`}
                                >{grant.status}</span>
                            </div>
                            <p class="mt-1 text-xs opacity-60">
                              {grant.status === "accepted"
                                ? "This pubkey can moderate this section."
                                : grant.status === "pending"
                                  ? "Waiting for this pubkey to publish its moderator list response."
                                  : "This pubkey declined the moderator invitation for this section."}
                            </p>
                          </div>
                        </div>
                      </article>
                    {/each}
                  </div>
                {/if}
              </div>
            </details>
          {:else}
            <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70">
              No non-owner moderator grants are configured for this community.
            </p>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</PageContent>
