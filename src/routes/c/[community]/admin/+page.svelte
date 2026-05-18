<script lang="ts">
  import {onMount} from "svelte"
  import {get as getStore} from "svelte/store"
  import {page} from "$app/stores"
  import {pubkey, publishThunk} from "@welshman/app"
  import {makeEvent} from "@welshman/util"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import CommunityCreate from "@app/components/CommunityCreate.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import ModerationReportList from "@app/components/community/ModerationReportList.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityModeratorRequestReactionEvents,
    activeCommunityModeratorRequestStates,
    activeCommunityModeratorRequests,
    activeCommunityProfile,
    activeCommunityReportState,
    activeCommunityRelays,
    loadCommunityEvents,
    makeCommunityModeratorRequestDeleteFilters,
    makeCommunityModeratorRequestFilters,
    makeCommunityModeratorRequestReactionFilters,
  } from "@app/core/community-state"
  import {
    findCommunitySection,
    getCommunitySectionDisplayName,
    normalizePubkey,
    type CommunityProfileListRef,
  } from "@app/core/community"
  import {
    getEffectiveCommunityModerationActionsByReporter,
    isCommunityPersonBanned,
    type CommunityModerationAction,
  } from "@app/core/community-reports"
  import {
    type ModeratorPromotionRequestState,
    makeModeratorGrantRevokeDefinitionUpdate,
    makeModeratorPromotionDefinitionUpdate,
    makeModeratorRequestReaction,
    makeModeratorRequestReactionDelete,
  } from "@app/core/community-moderator-requests"
  import {communityAdminSelectedTab, type CommunityAdminTab} from "@app/util/community-admin-tabs"
  import {parseCommunityRouteParam} from "@app/util/routes"

  type RequestStatusFilter = "pending" | "accepted" | "rejected"
  type ModeratorPersonTab = "grants" | "actions"

  type ModeratorSectionGrant = {
    sectionName: string
    displayName: string
    pubkey: string
    profileLists: CommunityProfileListRef[]
  }

  type ModeratorGrantPerson = {
    pubkey: string
    grants: ModeratorSectionGrant[]
    grantCount: number
    banned: boolean
  }

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
        $activeCommunityDefinition?.pubkey === communityPubkey &&
        $activeCommunityBootstrapStatus.loaded &&
        !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  let adminTab = $state<CommunityAdminTab>("settings")
  let adminTabHydrated = $state(false)
  let requestStatusFilter = $state<RequestStatusFilter>("pending")
  let moderatorPersonTabs = $state<Record<string, ModeratorPersonTab>>({})
  let moderatorRequestHydrationKey = $state("")
  let moderatorReactionHydrationKey = $state("")
  let moderatorDeleteHydrationKey = $state("")

  const makeHydrationKey = (relays: string[], filters: unknown[]) =>
    JSON.stringify({relays: relays.slice().sort(), filters})

  const canEditCommunity = $derived(
    Boolean(
      $pubkey &&
        communityBootstrapReady &&
        $activeCommunityDefinition &&
        normalizePubkey($pubkey) === normalizePubkey($activeCommunityDefinition.pubkey),
    ),
  )
  const moderatorRequestFilters = $derived(
    communityBootstrapReady && $activeCommunityDefinition
      ? makeCommunityModeratorRequestFilters($activeCommunityDefinition)
      : [],
  )
  const moderatorRequestReactionFilters = $derived(
    communityBootstrapReady && $activeCommunityDefinition
      ? makeCommunityModeratorRequestReactionFilters(
          $activeCommunityDefinition,
          $activeCommunityModeratorRequests,
        )
      : [],
  )
  const moderatorRequestDeleteFilters = $derived(
    communityBootstrapReady && $activeCommunityDefinition
      ? makeCommunityModeratorRequestDeleteFilters(
          $activeCommunityDefinition,
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
  const moderatorSectionGrants = $derived.by((): ModeratorSectionGrant[] => {
    if (!communityBootstrapReady) return []

    const definition = $activeCommunityDefinition
    if (!definition) return []

    const communityOwner = normalizePubkey(definition.pubkey)

    return definition.sections.flatMap(section => {
      const pubkeys = Array.from(
        new Set(
          section.profileLists.map(ref => ref.pubkey).map(normalizePubkey).filter(Boolean),
        ),
      )

      return pubkeys.flatMap(userPubkey => {
        if (userPubkey === communityOwner) return []

        const profileLists = section.profileLists.filter(
          ref => normalizePubkey(ref.pubkey) === userPubkey,
        )
        if (profileLists.length === 0) return []

        return [
          {
            sectionName: section.name,
            displayName: getCommunitySectionDisplayName(section),
            pubkey: userPubkey,
            profileLists,
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
      .map(([userPubkey, grants]) => ({
        pubkey: userPubkey,
        grants: grants.toSorted((a, b) => a.displayName.localeCompare(b.displayName)),
        grantCount: grants.length,
        banned: isCommunityPersonBanned($activeCommunityReportState, userPubkey),
      }))
      .toSorted((a, b) => b.grantCount - a.grantCount || a.pubkey.localeCompare(b.pubkey))
  })
  const activeModeratorCount = $derived(
    moderatorGrantPeople.filter(person => !person.banned).length,
  )
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
    if (!communityBootstrapReady || !$activeCommunityDefinition || !canEditCommunity) {
      pushToast({theme: "error", message: "Log in as this community pubkey first."})
      return false
    }

    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return false
    }

    return true
  }

  const publishModeratorReview = (
    requestState: ModeratorPromotionRequestState,
    content: "+" | "-",
  ) => {
    const profileListReaction = makeModeratorRequestReaction({
      request: requestState,
      target: requestState.profileList,
      content,
    })

    publishThunk({
      relays: $activeCommunityRelays,
      event: makeEvent(profileListReaction.kind, profileListReaction),
    })
  }

  const acceptModeratorRequest = (requestState: ModeratorPromotionRequestState) => {
    if (!assertCanPublish() || !$activeCommunityDefinition) return

    if (!findCommunitySection($activeCommunityDefinition, requestState.sectionName)) {
      pushToast({theme: "error", message: "This request targets a section that no longer exists."})
      return
    }

    pushModal(Confirm, {
      title: "Accept moderator request",
      message: `Add this pubkey as a moderator for ${requestState.sectionName}?`,
      confirm: () => {
        for (const reaction of getActiveReviewReactions(requestState)) {
          const deleteEvent = makeModeratorRequestReactionDelete({reactionId: reaction.id})

          publishThunk({
            relays: $activeCommunityRelays,
            event: makeEvent(deleteEvent.kind, deleteEvent),
          })
        }

        publishModeratorReview(requestState, "+")
        const definitionUpdate = makeModeratorPromotionDefinitionUpdate({
          definition: $activeCommunityDefinition!,
          request: requestState,
        })

        publishThunk({
          relays: $activeCommunityRelays,
          event: makeEvent(definitionUpdate.kind, definitionUpdate),
        })
        pushToast({theme: "success", message: "Moderator request accepted."})
        history.back()
      },
    })
  }

  const rejectModeratorRequest = (requestState: ModeratorPromotionRequestState) => {
    if (!assertCanPublish()) return

    pushModal(Confirm, {
      title: "Reject moderator request",
      message: `Reject this request for ${requestState.sectionName}?`,
      confirm: () => {
        publishModeratorReview(requestState, "-")
        pushToast({theme: "warning", message: "Moderator request rejected."})
        history.back()
      },
    })
  }

  const revokeModeratorGrant = (grant: ModeratorSectionGrant) => {
    if (!assertCanPublish() || !$activeCommunityDefinition) return

    const section = findCommunitySection($activeCommunityDefinition, grant.sectionName)
    const hasProfileListRefs = grant.profileLists.some(ref =>
      section?.profileLists.some(sectionRef => sectionRef.address === ref.address),
    )

    if (!section || !hasProfileListRefs) {
      pushToast({theme: "error", message: "This moderator grant is no longer active."})
      return
    }

    pushModal(Confirm, {
      title: "Revoke moderator access",
      message: `Remove this pubkey as a moderator for ${grant.displayName}?`,
      confirm: () => {
        const definitionUpdate = makeModeratorGrantRevokeDefinitionUpdate({
          definition: $activeCommunityDefinition!,
          sectionName: grant.sectionName,
          moderatorPubkey: grant.pubkey,
        })

        publishThunk({
          relays: $activeCommunityRelays,
          event: makeEvent(definitionUpdate.kind, definitionUpdate),
        })
        pushToast({theme: "warning", message: "Moderator ref revoked."})
        history.back()
      },
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
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0) return
    if (moderatorRequestFilters.length === 0) return
    const key = makeHydrationKey($activeCommunityRelays, moderatorRequestFilters)
    if (key === moderatorRequestHydrationKey) return

    moderatorRequestHydrationKey = key
    void loadCommunityEvents($activeCommunityRelays, moderatorRequestFilters).catch(error => {
      console.warn("[community] Failed to hydrate admin moderator requests", error)
    })
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0) return
    if (moderatorRequestReactionFilters.length === 0) return
    const key = makeHydrationKey($activeCommunityRelays, moderatorRequestReactionFilters)
    if (key === moderatorReactionHydrationKey) return

    moderatorReactionHydrationKey = key
    void loadCommunityEvents($activeCommunityRelays, moderatorRequestReactionFilters).catch(
      error => {
        console.warn("[community] Failed to hydrate admin moderator request reviews", error)
      },
    )
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0) return
    if (moderatorRequestDeleteFilters.length === 0) return
    const key = makeHydrationKey($activeCommunityRelays, moderatorRequestDeleteFilters)
    if (key === moderatorDeleteHydrationKey) return

    moderatorDeleteHydrationKey = key
    void loadCommunityEvents($activeCommunityRelays, moderatorRequestDeleteFilters).catch(error => {
      console.warn("[community] Failed to hydrate admin moderator review deletes", error)
    })
  })

</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Settings} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Admin</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="mx-auto flex w-full max-w-7xl flex-col gap-4 p-4 md:p-8">
  {#if communityBootstrapLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community permissions...</Spinner>
    </p>
  {:else if !communityBootstrapReady || !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else if !canEditCommunity}
    <p class="py-8 text-center opacity-70">
      Log in as this community pubkey to publish community definition updates.
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
        definition={$activeCommunityDefinition}
        profile={$activeCommunityProfile}
        embedded />
    {:else if adminTab === "requests"}
      <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">Moderator requests</h2>
            <p class="text-sm opacity-70">
              Review requester-owned profile-list refs, then accept by appending them to the
              community definition.
            </p>
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
                    Requester: <ProfileLink pubkey={moderatorRequest.requesterPubkey} />
                  </p>
                  <p class="text-xs opacity-60">
                    {getRequestTimeLabel(moderatorRequest)} {new Date(
                      getRequestTime(moderatorRequest) * 1000,
                    ).toLocaleString()}
                  </p>
                </div>
                <div class="flex flex-wrap gap-2">
                  <Button
                    class="btn btn-error btn-sm"
                    disabled={moderatorRequest.status === "rejected" || moderatorRequest.derivedFromGrant}
                    onclick={() => rejectModeratorRequest(moderatorRequest)}>
                    Reject
                  </Button>
                  <Button
                    class="btn btn-success btn-sm"
                    disabled={moderatorRequest.status === "accepted"}
                    onclick={() => acceptModeratorRequest(moderatorRequest)}>
                    Accept
                  </Button>
                </div>
              </div>

              <div class="mt-3 text-sm">
                <div class="rounded-box bg-base-200 p-3">
                  <strong>Profile list ref</strong>
                  <p class="break-all opacity-75">{moderatorRequest.profileListRef.address}</p>
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
            {activeModeratorCount === 1 ? "moderator" : "moderators"}
          </span>
        </div>

        <div class="flex flex-col gap-3">
          {#each moderatorGrantPeople as person (person.pubkey)}
            {@const personActions = moderationActionsByReporter.get(person.pubkey) || []}
            <details class="rounded-box border border-base-300 bg-base-100">
              <summary class="cursor-pointer p-4 marker:text-primary">
                <div
                  class="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-center justify-between gap-3 align-top">
                  <div class="flex min-w-0 items-center gap-3">
                    <ProfileCircle pubkey={person.pubkey} size={9} />
                    <div class="min-w-0">
                      <strong><ProfileLink pubkey={person.pubkey} /></strong>
                      {#if person.banned}
                        <span class="badge badge-error mt-1">banned</span>
                      {/if}
                    </div>
                  </div>
                  <div class="flex flex-wrap gap-2">
                    <span class="badge badge-success">
                      {person.grantCount}
                      {person.grantCount === 1 ? "grant" : "grants"}
                    </span>
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
                    relays={$activeCommunityRelays}
                    emptyMessage="No active moderation actions from this moderator." />
                {:else}
                  <div class="flex flex-col gap-3">
                    {#each person.grants as grant (`${grant.sectionName}:${grant.pubkey}`)}
                      <article class="rounded-box bg-base-200 p-3">
                        <div class="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <div class="flex flex-wrap items-center gap-2">
                              <strong>{grant.displayName}</strong>
                              <span class="badge badge-success">profile list</span>
                            </div>
                            <p class="mt-1 text-xs opacity-60">
                              Revoking removes this profile-list manager ref for the section.
                            </p>
                          </div>
                          <Button
                            class="btn btn-error btn-sm"
                            onclick={() => revokeModeratorGrant(grant)}>
                            Revoke grant
                          </Button>
                        </div>

                        <div class="mt-3 text-sm">
                          <div class="rounded-box bg-base-100 p-3">
                            <strong>Profile-list refs</strong>
                            <div class="mt-2 flex flex-col gap-1">
                              {#each grant.profileLists as ref (ref.address)}
                                <p class="break-all opacity-75">{ref.address}</p>
                              {/each}
                            </div>
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
