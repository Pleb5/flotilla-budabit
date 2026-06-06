<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {goto} from "$app/navigation"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {
    profileSearch,
    profilesByPubkey,
    pubkey,
    publishThunk,
    repository,
    waitForThunkCompletion,
  } from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE, makeEvent, type TrustedEvent} from "@welshman/util"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Field from "@lib/components/Field.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {preventDefault, stopPropagation} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {FORM_RESPONSE_KIND, getCommunitySectionDisplayName} from "@app/core/community"
  import {
    activeCommunityAdmissionForms,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    activeCommunityUserModeratorRequestStates,
    activeCommunityUserModeratorRequestsLoading,
    hydratePubkeyProfiles,
    hydrateActiveCommunityUserModeratorRequests,
  } from "@app/core/community-state"
  import {
    getGrantCapability,
    getGrantCapableSectionModeratorPubkeys,
    userHasSectionProfileListAccess,
  } from "@app/core/community-permissions"
  import {
    COMMUNITY_FORM_REVIEW_KIND,
    type CommunityAdmissionForm,
    type CommunityFormField,
    type CommunityFormResponse,
    type CommunitySubmissionState,
    getAdmissionReviewHistory,
    getAdmissionSubmissionState,
    makeAdmissionResponse,
    makeAdmissionResponseDelete,
  } from "@app/core/community-forms"
  import {makeModeratorProfileListRequest} from "@app/core/community-moderator-requests"
  import {getCommunityScopedPublishRelays} from "@app/core/community-relays"
  import {
    selectCommunityMemberList,
    type CommunityMemberListItem,
  } from "@app/core/community-membership"
  import {isCommunityAdmin, isCommunityPersonBanned} from "@app/core/community-reports"
  import {getPeopleSearchTextScore} from "@app/util/people-search"
  import {checked, normalizeChecked, setChecked} from "@app/util/notifications"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  type AccessPageTab = "requests" | "members"

  type ModeratorRequestPublishStatus = "idle" | "publishing" | "sent" | "failed"

  type ModeratorRequestPublishState = {
    status: ModeratorRequestPublishStatus
    detail?: string
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
  let answers = $state<Record<string, Record<string, string>>>({})
  let otherAnswers = $state<Record<string, Record<string, Record<string, string>>>>({})
  let publishingAccessOpen = $state(true)
  let moderatorRequestsOpen = $state(false)
  let moderatorRequestPublishStates = $state<Record<string, ModeratorRequestPublishState>>({})
  let lastScrolledSectionName = $state("")
  let activeTab = $state<AccessPageTab>("requests")
  let memberSearch = $state("")
  let openMemberPopover = $state<string | null>(null)
  const currentUserBanned = $derived(
    isCommunityPersonBanned($activeCommunityReportState, $pubkey || ""),
  )
  const communityPublishRelays = $derived(
    getCommunityScopedPublishRelays($activeCommunityDefinition),
  )
  const communityProfileRelays = $derived(
    $activeCommunityRelays.length > 0 ? $activeCommunityRelays : communityPublishRelays,
  )
  const moderationPath = $derived(
    communityPubkey ? makeCommunityPath(communityPubkey, "moderation") : "",
  )
  const adminPath = $derived(communityPubkey ? makeCommunityPath(communityPubkey, "admin") : "")
  const currentUserAdmin = $derived(
    Boolean(
      $activeCommunityDefinition &&
      $pubkey &&
      isCommunityAdmin($activeCommunityDefinition, $pubkey),
    ),
  )
  const currentUserModerator = $derived(
    Boolean(
      !currentUserAdmin &&
      $activeCommunityDefinition &&
      $pubkey &&
      $activeCommunityDefinition.sections.some(
        section =>
            getGrantCapability({
              definition: $activeCommunityDefinition!,
              userPubkey: $pubkey,
              sectionName: section.name,
              profileListEvents: $activeCommunityProfileListEvents,
              reportState: $activeCommunityReportState,
            }).canGrant,
      ),
    ),
  )

  const requestedSectionName = $derived($page.url.searchParams.get("section") || "")
  const forms = $derived(communityBootstrapReady ? $activeCommunityAdmissionForms : {})
  const formAddresses = $derived(Object.values(forms).map(form => form.address))
  const responseFilters = $derived(
    communityBootstrapReady && $pubkey && formAddresses.length
      ? [{kinds: [FORM_RESPONSE_KIND], authors: [$pubkey], "#a": formAddresses}]
      : [],
  )
  const responseEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})),
  )
  const responseIds = $derived($responseEvents.map(event => event.id))
  const deleteFilters = $derived(
    $pubkey && responseIds.length ? [{kinds: [DELETE], authors: [$pubkey], "#e": responseIds}] : [],
  )
  const reviewFilters = $derived(
    responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [],
  )
  const reviewHistoryFilters = $derived(
    communityBootstrapReady && $pubkey && communityPubkey
      ? [
          {
            kinds: [COMMUNITY_FORM_REVIEW_KIND],
            "#p": [$pubkey],
            "#h": [communityPubkey],
            "#k": [String(FORM_RESPONSE_KIND)],
            limit: 200,
          },
        ]
      : [],
  )
  const deleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})),
  )
  const reviewEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})),
  )
  const reviewHistoryEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: reviewHistoryFilters})),
  )
  const sectionItems = $derived(
    communityBootstrapReady
      ? ($activeCommunityDefinition?.sections || []).map(section => {
          const displayName = getCommunitySectionDisplayName(section)
          const form = forms[section.name] || forms[displayName]
          const moderatorPubkeys = $activeCommunityDefinition
            ? getGrantCapableSectionModeratorPubkeys({
                definition: $activeCommunityDefinition,
                sectionName: section.name,
                profileListEvents: $activeCommunityProfileListEvents,
                reportState: $activeCommunityReportState,
              })
            : []
          const granted = Boolean(
            $pubkey &&
            userHasSectionProfileListAccess({
              definition: $activeCommunityDefinition,
              section,
              profileListEvents: $activeCommunityProfileListEvents,
              userPubkey: $pubkey,
              reportState: $activeCommunityReportState,
            }),
          )
          const state =
            form && $pubkey
              ? getAdmissionSubmissionState({
                  responseEvents: $responseEvents,
                  deleteEvents: $deleteEvents,
                  reviewEvents: $reviewEvents,
                  formAddress: form.address,
                  applicantPubkey: $pubkey,
                  moderatorPubkeys,
                  profileListGranted: granted,
                })
              : ({status: granted ? "granted" : "none"} satisfies CommunitySubmissionState)
          const history = $pubkey
            ? getAdmissionReviewHistory({
                reviewEvents: [...$reviewEvents, ...$reviewHistoryEvents],
                applicantPubkey: $pubkey,
                communityPubkey,
                sectionName: section.name,
                moderatorPubkeys,
                excludeResponseId: state.response?.event.id,
              })
            : undefined

          return {section, displayName, form, granted, state, history}
        })
      : [],
  )
  const moderatorRequestStates = $derived(
    communityBootstrapReady ? $activeCommunityUserModeratorRequestStates : [],
  )
  const accessCheckedAt = $derived.by(() => {
    let checkedAt = 0
    const path = $page.url.pathname

    for (const [entryPath, timestamp] of Object.entries($checked)) {
      if (entryPath.endsWith(":seen")) continue
      if (entryPath === "*" || entryPath.startsWith(path)) {
        checkedAt = Math.max(checkedAt, normalizeChecked(timestamp))
      }
    }

    return checkedAt
  })
  const getModeratorRequestKey = ({
    requesterPubkey,
    sectionName,
  }: {
    requesterPubkey: string
    sectionName: string
  }) => `${requesterPubkey}:${sectionName}`
  const updatedModeratorRequestKeys = $derived.by(
    () =>
      new Set(
        moderatorRequestStates
          .filter(request => request.status !== "pending")
          .filter(request => request.statusChangedAt > accessCheckedAt)
          .map(getModeratorRequestKey),
      ),
  )
  const moderatorRequestStatusUpdateCount = $derived(updatedModeratorRequestKeys.size)
  const moderatorRequestItems = $derived.by(() => {
    if (!communityBootstrapReady) return []

    const definition = $activeCommunityDefinition

    return (definition?.sections || []).map(section => {
      const displayName = getCommunitySectionDisplayName(section)
      const request = moderatorRequestStates.find(
        request => request.requesterPubkey === $pubkey && request.sectionName === section.name,
      )
      const alreadyModerator = Boolean(
        $pubkey &&
        definition &&
            getGrantCapability({
              definition,
              userPubkey: $pubkey,
              sectionName: section.name,
              profileListEvents: $activeCommunityProfileListEvents,
              reportState: $activeCommunityReportState,
            }).canGrant,
      )
      const status = alreadyModerator ? "accepted" : request?.status || "none"
      const publishState = moderatorRequestPublishStates[section.name]
      const statusUpdated = request
        ? updatedModeratorRequestKeys.has(getModeratorRequestKey(request))
        : false

      return {section, displayName, request, status, publishState, statusUpdated}
    })
  })
  const getMemberSearchText = (member: CommunityMemberListItem) =>
    [
      member.pubkey,
      member.isOwner ? "owner admin" : "",
      member.isModerator ? "moderator" : "",
      member.isPendingModerator ? "pending moderator" : "",
      ...member.moderatorSections.map(section => section.displayName),
      ...member.pendingModeratorSections.map(section => section.displayName),
      ...member.sectionGrants.map(section => section.displayName),
    ]
      .join(" ")
      .toLocaleLowerCase()
  const memberItems = $derived(
    communityBootstrapReady && $activeCommunityDefinition
      ? selectCommunityMemberList({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const normalizedMemberSearch = $derived(memberSearch.trim())
  const memberProfileMatches = $derived.by(
    () =>
      new Set(
        normalizedMemberSearch
          ? ($profileSearch.searchValues(normalizedMemberSearch) as string[])
          : [],
      ),
  )
  const filteredMemberItems = $derived.by(() => {
    if (!normalizedMemberSearch) return memberItems

    const query = normalizedMemberSearch.toLocaleLowerCase()

    return memberItems.filter(member => {
      if (memberProfileMatches.has(member.pubkey)) return true
      if (
        getPeopleSearchTextScore({
          pubkey: member.pubkey,
          profile: $profilesByPubkey.get(member.pubkey),
          query: normalizedMemberSearch,
        }) > 0
      ) {
        return true
      }

      return getMemberSearchText(member).includes(query)
    })
  })
  const moderatorMemberCount = $derived(memberItems.filter(member => member.isModerator).length)
  const pendingModeratorMemberCount = $derived(
    memberItems.filter(member => member.isPendingModerator).length,
  )

  let memberProfileHydrationKey = ""
  $effect(() => {
    const pubkeys = memberItems.map(member => member.pubkey)
    const key = `${communityProfileRelays.join(",")}:${pubkeys.join(",")}`
    if (!communityBootstrapReady || pubkeys.length === 0 || key === memberProfileHydrationKey)
      return

    memberProfileHydrationKey = key
    hydratePubkeyProfiles({pubkeys, relayHints: communityProfileRelays}).catch(error => {
      console.warn("[community/access] Failed to hydrate member profiles", error)
    })
  })

  const openProfile = (memberPubkey: string) => {
    pushModal(ProfileDetail, {
      pubkey: memberPubkey,
      url: communityProfileRelays[0],
      relays: communityProfileRelays,
    })
  }

  const getAnswer = (
    sectionName: string,
    field: CommunityFormField,
    response?: CommunityFormResponse,
  ) => answers[sectionName]?.[field.id] ?? response?.values[field.id] ?? ""

  const setAnswer = (sectionName: string, fieldId: string, value: string) => {
    answers = {
      ...answers,
      [sectionName]: {
        ...(answers[sectionName] || {}),
        [fieldId]: value,
      },
    }
  }

  const isMultipleChoiceField = (field: CommunityFormField) =>
    field.settings.renderElement === "multipleChoice"

  const isRequiredField = (field: CommunityFormField) => field.settings.required !== false

  const getChoiceValues = (
    sectionName: string,
    field: CommunityFormField,
    response?: CommunityFormResponse,
  ) =>
    getAnswer(sectionName, field, response)
      .split(";")
      .map(item => item.trim())
      .filter(Boolean)

  const setChoiceAnswer = (
    sectionName: string,
    field: CommunityFormField,
    optionId: string,
    checked: boolean,
  ) => {
    if (!isMultipleChoiceField(field)) {
      setAnswer(sectionName, field.id, optionId)
      return
    }

    const selected = new Set(getChoiceValues(sectionName, field))

    if (checked) selected.add(optionId)
    else selected.delete(optionId)

    setAnswer(
      sectionName,
      field.id,
      field.options
        .filter(option => selected.has(option.id))
        .map(option => option.id)
        .join(";"),
    )
  }

  const getOtherAnswersFromMetadata = (metadata: Record<string, unknown>) => {
    const rawOther = metadata.other
    const values: Record<string, string> = {}

    if (!rawOther || typeof rawOther !== "object" || Array.isArray(rawOther)) return values

    for (const [optionId, value] of Object.entries(rawOther)) {
      if (typeof value === "string") values[optionId] = value
    }

    return values
  }

  const getResponseOtherAnswers = (response: CommunityFormResponse) => {
    const values: Record<string, Record<string, string>> = {}

    for (const item of response.responses) {
      const fieldValues = getOtherAnswersFromMetadata(item.metadata)

      if (Object.keys(fieldValues).length) values[item.fieldId] = fieldValues
    }

    return values
  }

  const getOtherAnswer = (
    sectionName: string,
    fieldId: string,
    optionId: string,
    response?: CommunityFormResponse,
  ) => {
    const draftValue = otherAnswers[sectionName]?.[fieldId]?.[optionId]
    if (draftValue !== undefined) return draftValue

    const responseValue = response?.responses.find(item => item.fieldId === fieldId)
    if (!responseValue) return ""

    return getOtherAnswersFromMetadata(responseValue.metadata)[optionId] || ""
  }

  const setOtherAnswer = (
    sectionName: string,
    fieldId: string,
    optionId: string,
    value: string,
  ) => {
    otherAnswers = {
      ...otherAnswers,
      [sectionName]: {
        ...(otherAnswers[sectionName] || {}),
        [fieldId]: {
          ...(otherAnswers[sectionName]?.[fieldId] || {}),
          [optionId]: value,
        },
      },
    }
  }

  const submitApplication = (
    sectionName: string,
    sectionDisplayName: string,
    form: CommunityAdmissionForm,
  ) => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in before requesting access."})
      return
    }

    if (!communityBootstrapReady) {
      pushToast({theme: "error", message: "Community permissions are still loading."})
      return
    }

    if (currentUserBanned) {
      pushToast({theme: "error", message: "You are banned from requesting community access."})
      return
    }

    if (communityPublishRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    const values: Record<string, string> = {}
    const metadata: Record<string, Record<string, unknown>> = {}

    for (const fieldId of form.fieldOrder) {
      const field = form.fields[fieldId]
      if (!field || field.type === "label") continue

      const value = answers[sectionName]?.[fieldId] || ""

      values[fieldId] = value

      if (field.type !== "option") {
        if (isRequiredField(field) && !value.trim()) {
          pushToast({theme: "error", message: `Answer "${field.label}" before submitting.`})
          return
        }

        continue
      }

      const selectedValues = value
        .split(";")
        .map(item => item.trim())
        .filter(Boolean)
      const selected = new Set(selectedValues)

      if (isRequiredField(field) && selectedValues.length === 0) {
        pushToast({theme: "error", message: `Answer "${field.label}" before submitting.`})
        return
      }
      const other: Record<string, string> = {}

      for (const option of field.options) {
        if (option.settings.isOther !== true || !selected.has(option.id)) continue

        const explanation = otherAnswers[sectionName]?.[fieldId]?.[option.id]?.trim()
        if (!explanation) {
          pushToast({theme: "error", message: `Explain "${option.label}" for ${field.label}.`})
          return
        }

        other[option.id] = explanation
      }

      if (Object.keys(other).length) metadata[fieldId] = {other}
    }

    const template = makeAdmissionResponse({formAddress: form.address, values, metadata})

    publishThunk({relays: communityPublishRelays, event: makeEvent(template.kind, template)})
    pushToast({message: `Application submitted for ${sectionDisplayName}.`})
  }

  const setModeratorRequestPublishState = (
    sectionName: string,
    publishState: ModeratorRequestPublishState,
  ) => {
    moderatorRequestPublishStates = {
      ...moderatorRequestPublishStates,
      [sectionName]: publishState,
    }
  }

  const hasSuccessfulRelay = (thunk: ReturnType<typeof publishThunk>) =>
    Object.values(thunk.results).some(result => result.status === "success")

  const getPublishError = (thunks: Array<ReturnType<typeof publishThunk>>) => {
    const result = thunks
      .flatMap(thunk => Object.values(thunk.results))
      .find(result => result.status !== "success")

    return result
      ? `${result.relay}: ${result.detail || result.status}`
      : "Relay did not confirm the request."
  }

  const submitModeratorRequest = async (sectionName: string, sectionDisplayName: string) => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in before requesting moderator permissions."})
      return
    }

    if (!communityBootstrapReady || !$activeCommunityDefinition) {
      pushToast({theme: "error", message: "Community definition is not loaded."})
      return
    }

    if (currentUserBanned) {
      pushToast({theme: "error", message: "You are banned from requesting moderator permissions."})
      return
    }

    if (communityPublishRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    if ($activeCommunityUserModeratorRequestsLoading) {
      pushToast({theme: "warning", message: "Checking existing moderator requests first."})
      return
    }

    const existingState = moderatorRequestStates.find(
      request => request.requesterPubkey === $pubkey && request.sectionName === sectionName,
    )
    if (existingState) {
      pushToast({
        theme: existingState.status === "rejected" ? "warning" : undefined,
        message:
          existingState.status === "rejected"
            ? "The admin can still grant your request later."
            : "This moderator request is already recorded.",
      })
      return
    }

    const options = {
      communityPubkey: $activeCommunityDefinition.pubkey,
      requesterPubkey: $pubkey,
      sectionName,
      relays: communityPublishRelays,
    }
    const profileList = makeModeratorProfileListRequest(options)

    setModeratorRequestPublishState(sectionName, {
      status: "publishing",
      detail: "Waiting for relay confirmation...",
    })

    let profileListThunk: ReturnType<typeof publishThunk>

    try {
      profileListThunk = publishThunk({
        relays: communityPublishRelays,
        event: makeEvent(profileList.kind, profileList),
      })

      await waitForThunkCompletion(profileListThunk)
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setModeratorRequestPublishState(sectionName, {status: "failed", detail})
      pushToast({theme: "error", message: `Moderator request failed: ${detail}`})
      return
    }

    if (!hasSuccessfulRelay(profileListThunk)) {
      const detail = getPublishError([profileListThunk])
      setModeratorRequestPublishState(sectionName, {status: "failed", detail})
      pushToast({theme: "error", message: `Moderator request failed: ${detail}`})
      return
    }

    repository.publish(profileListThunk.event as TrustedEvent)
    setModeratorRequestPublishState(sectionName, {
      status: "sent",
      detail: "Relay confirmed the request.",
    })
    pushToast({theme: "success", message: `Moderator request submitted for ${sectionDisplayName}.`})
  }

  const deleteSubmission = (
    sectionName: string,
    sectionDisplayName: string,
    response: CommunityFormResponse,
  ) => {
    pushModal(Confirm, {
      title: "Delete submission",
      message: `Delete your ${sectionDisplayName} membership request so you can submit a revised application?`,
      confirm: async () => {
        if (communityPublishRelays.length === 0) {
          pushToast({
            theme: "error",
            message: "Community definition must declare at least one relay.",
          })
          return
        }

        answers = {...answers, [sectionName]: {...response.values}}
        otherAnswers = {...otherAnswers, [sectionName]: getResponseOtherAnswers(response)}
        const template = makeAdmissionResponseDelete({responseId: response.event.id})

        publishThunk({relays: communityPublishRelays, event: makeEvent(template.kind, template)})
        pushToast({
          message:
            "Submission deleted. You can submit a revised application after relays confirm it.",
        })
        history.back()
      },
    })
  }

  const hydrateModeratorRequests = async () => {
    const definition = $activeCommunityDefinition
    if (!moderatorRequestsOpen || !communityBootstrapReady || !definition || !$pubkey) return
    if ($activeCommunityRelays.length === 0) return

    try {
      await hydrateActiveCommunityUserModeratorRequests({
        definition,
        relays: $activeCommunityRelays,
        force: true,
      })
    } catch (error) {
      console.warn("[community] Failed to hydrate moderator requests", error)
    }
  }

  const toggleModeratorRequests = (event: Event) => {
    moderatorRequestsOpen = (event.currentTarget as HTMLDetailsElement).open
    if (moderatorRequestsOpen) void hydrateModeratorRequests()
  }

  const statusClass = (status: string) => {
    if (status === "accepted") return "badge-success"
    if (status === "granted") return "badge-success"
    if (status === "rejected") return "badge-error"
    if (status === "pending") return "badge-warning"

    return "badge-neutral"
  }
  const reviewHistoryToneClass = (status: string) =>
    status === "granted" ? "bg-success/10 text-success" : "bg-error/10 text-error"
  const reviewHistoryLabel = (status: string) =>
    status === "granted" ? "Previously granted" : "Previously rejected"

  const getPublishingAccessRequestId = (sectionName: string) =>
    `publishing-access-request-${encodeURIComponent(sectionName)}`

  const selectTab = (tab: AccessPageTab) => {
    activeTab = tab
    openMemberPopover = null
  }

  const openAdminPanel = () => {
    if (adminPath) void goto(adminPath)
  }

  const openModerationDashboard = () => {
    if (moderationPath) void goto(moderationPath)
  }

  const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`

  const getMemberPopoverKey = (
    member: CommunityMemberListItem,
    type: "grants" | "moderators" | "pending-moderators",
  ) => `${member.pubkey}:${type}`

  const showMemberPopover = (key: string) => {
    openMemberPopover = key
  }

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0) return
    if (reviewHistoryFilters.length === 0) return

    const controller = new AbortController()
    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      filters: reviewHistoryFilters,
      signal: controller.signal,
    })

    return () => controller.abort()
  })

  $effect(() => {
    const sectionName = requestedSectionName

    if (!sectionName) {
      lastScrolledSectionName = ""
      return
    }
    if (sectionName === lastScrolledSectionName) return
    if (!sectionItems.some(item => item.section.name === sectionName)) return

    activeTab = "requests"
    publishingAccessOpen = true
    lastScrolledSectionName = sectionName
    void tick().then(() => {
      document
        .getElementById(getPublishingAccessRequestId(sectionName))
        ?.scrollIntoView({behavior: "smooth", block: "start"})
    })
  })

  $effect(() => {
    if (moderatorRequestStatusUpdateCount > 0) {
      activeTab = "requests"
      moderatorRequestsOpen = true
    }
  })

  onDestroy(() => {
    setChecked($page.url.pathname)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={ShieldUser} /></div>
  {/snippet}
  {#snippet title()}<strong>Membership</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  {#if communityBootstrapLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community permissions...</Spinner>
    </p>
  {:else if !communityBootstrapReady || !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else}
    <div class="card2 bg-alt shrink-0 p-4 shadow-md">
      <h2 class="text-xl font-semibold">Your membership and permissions</h2>
      <p class="mt-1 text-sm opacity-70">
        Review your section permissions, submit membership requests, or browse current community
        members.
      </p>
    </div>

    <div class="grid grid-cols-2 gap-2 sm:flex sm:w-fit sm:flex-wrap">
      <Button
        class={`btn h-auto min-h-12 justify-center gap-2 px-4 py-3 text-center font-semibold ${
          activeTab === "requests"
            ? "btn-primary"
            : "border border-base-300 bg-base-100 text-base-content hover:border-primary/60 hover:bg-base-200"
        }`}
        onclick={() => selectTab("requests")}>
        Membership requests
      </Button>
      <Button
        class={`btn h-auto min-h-12 justify-center gap-2 px-4 py-3 text-center font-semibold ${
          activeTab === "members"
            ? "btn-primary"
            : "border border-base-300 bg-base-100 text-base-content hover:border-primary/60 hover:bg-base-200"
        }`}
        onclick={() => selectTab("members")}>
        Group members
        <span
          class={`badge badge-sm ${activeTab === "members" ? "border-primary-content/40 bg-primary-content text-primary" : "badge-neutral"}`}>
          {memberItems.length}
        </span>
      </Button>
    </div>

    {#if activeTab === "members"}
      <section class="card2 bg-alt shrink-0 p-4 shadow-md">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">Members</h2>
            <p class="mt-1 text-sm opacity-70">
              Current non-banned members, moderators, pending moderator invites, and the community
              owner.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <span class="badge badge-neutral"
              >{pluralize(memberItems.length, "person", "people")}</span>
            <span class="badge badge-info">{pluralize(moderatorMemberCount, "moderator")}</span>
            {#if pendingModeratorMemberCount > 0}
              <span class="badge badge-warning">
                {pluralize(pendingModeratorMemberCount, "pending moderator")}
              </span>
            {/if}
          </div>
        </div>

        <label class="input input-bordered mt-4 flex items-center gap-2">
          <Icon icon={Magnifier} />
          <input
            bind:value={memberSearch}
            class="grow"
            type="search"
            placeholder="Search members..." />
        </label>

        <div class="mt-4 flex flex-col gap-2">
          {#if filteredMemberItems.length > 0}
            {#each filteredMemberItems as member (member.pubkey)}
              {@const grantsKey = getMemberPopoverKey(member, "grants")}
              <article class="rounded-box border border-base-300 bg-base-100 p-3 sm:p-4">
                <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div class="flex min-w-0 items-start gap-3">
                    <Button
                      class="rounded-full p-0"
                      aria-label="View member profile"
                      title="View member profile"
                      onclick={stopPropagation(preventDefault(() => openProfile(member.pubkey)))}>
                      <ProfileCircle
                        pubkey={member.pubkey}
                        relays={communityProfileRelays}
                        size={9} />
                    </Button>
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <strong class="min-w-0"
                          ><ProfileLink
                            pubkey={member.pubkey}
                            relays={communityProfileRelays} /></strong>
                        {#if member.isOwner}
                          <span class="badge badge-primary">owner</span>
                          <span class="badge badge-success">admin</span>
                        {/if}
                        {#if member.isModerator}
                          <span class="badge badge-info">moderator</span>
                        {/if}
                        {#if member.isPendingModerator}
                          <span class="badge badge-warning">pending moderator</span>
                        {/if}
                        {#if member.grantCount > 0 && !member.isAdmin && !member.isModerator && !member.isPendingModerator}
                          <span class="badge badge-neutral">member</span>
                        {/if}
                      </div>
                    </div>
                  </div>

                  <div class="flex flex-wrap items-center gap-2 sm:justify-end">
                    {#if member.isOwner}
                      <span class="badge badge-primary">all admin sections</span>
                    {/if}

                    {#if member.isModerator}
                      {@const moderatorKey = getMemberPopoverKey(member, "moderators")}
                      <div class="relative">
                        <Button
                          class="btn btn-info btn-sm"
                          aria-expanded={openMemberPopover === moderatorKey}
                          onclick={() => showMemberPopover(moderatorKey)}>
                          {pluralize(member.moderatorSectionCount, "moderator section")}
                        </Button>
                        {#if openMemberPopover === moderatorKey}
                          <InlinePopover
                            align="right"
                            widthClass="w-80 sm:w-96"
                            onClose={() => (openMemberPopover = null)}>
                            <div class="flex flex-col gap-3 text-sm">
                              <div>
                                <h3 class="font-semibold">Moderator sections</h3>
                                <p class="text-xs opacity-70">
                                  Sections where this pubkey manages grants.
                                </p>
                              </div>
                              {#each member.moderatorSections as section}
                                <div class="rounded-box bg-base-200 p-3">
                                  <strong>{section.displayName}</strong>
                                  <div class="mt-2 flex flex-col gap-1">
                                    {#each section.profileListAddresses as address}
                                      <p class="break-all font-mono text-[11px] opacity-70">
                                        {address}
                                      </p>
                                    {/each}
                                  </div>
                                </div>
                              {/each}
                            </div>
                          </InlinePopover>
                        {/if}
                      </div>
                    {/if}

                    {#if member.isPendingModerator}
                      {@const pendingModeratorKey = getMemberPopoverKey(member, "pending-moderators")}
                      <div class="relative">
                        <Button
                          class="btn btn-warning btn-sm"
                          aria-expanded={openMemberPopover === pendingModeratorKey}
                          onclick={() => showMemberPopover(pendingModeratorKey)}>
                          Pending {pluralize(
                            member.pendingModeratorSectionCount,
                            "moderator section",
                          )}
                        </Button>
                        {#if openMemberPopover === pendingModeratorKey}
                          <InlinePopover
                            align="right"
                            widthClass="w-80 sm:w-96"
                            onClose={() => (openMemberPopover = null)}>
                            <div class="flex flex-col gap-3 text-sm">
                              <div>
                                <h3 class="font-semibold">Pending moderator sections</h3>
                                <p class="text-xs opacity-70">
                                  Sections where this pubkey was invited to moderate but has not
                                  published its profile list yet.
                                </p>
                              </div>
                              {#each member.pendingModeratorSections as section}
                                <div class="rounded-box bg-base-200 p-3">
                                  <strong>{section.displayName}</strong>
                                  <div class="mt-2 flex flex-col gap-1">
                                    {#each section.profileListAddresses as address}
                                      <p class="break-all font-mono text-[11px] opacity-70">
                                        {address}
                                      </p>
                                    {/each}
                                  </div>
                                </div>
                              {/each}
                            </div>
                          </InlinePopover>
                        {/if}
                      </div>
                    {/if}

                    <div class="relative">
                      <Button
                        class="btn btn-neutral btn-sm"
                        aria-expanded={openMemberPopover === grantsKey}
                        onclick={() => showMemberPopover(grantsKey)}>
                        {pluralize(member.grantCount, "grant")}
                      </Button>
                      {#if openMemberPopover === grantsKey}
                        <InlinePopover
                          align="right"
                          widthClass="w-80 sm:w-96"
                          onClose={() => (openMemberPopover = null)}>
                          <div class="flex flex-col gap-3 text-sm">
                              <div>
                                <h3 class="font-semibold">Membership grants</h3>
                                <p class="text-xs opacity-70">
                                  Sections where this pubkey can publish as a member.
                                </p>
                              </div>
                            {#if member.sectionGrants.length > 0}
                              {#each member.sectionGrants as section}
                                <div class="rounded-box bg-base-200 p-3">
                                  <strong>{section.displayName}</strong>
                                  <div class="mt-2 flex flex-col gap-1">
                                    {#each section.profileListAddresses as address}
                                      <p class="break-all font-mono text-[11px] opacity-70">
                                        {address}
                                      </p>
                                    {/each}
                                  </div>
                                </div>
                              {/each}
                            {:else}
                              <p class="rounded-box bg-base-200 p-3 opacity-70">
                                No membership grants.
                              </p>
                            {/if}
                          </div>
                        </InlinePopover>
                      {/if}
                    </div>
                  </div>
                </div>
              </article>
            {/each}
          {:else if memberItems.length === 0}
            <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70">
              No current members are indexed for this community yet.
            </p>
          {:else}
            <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70">
              No members match this search.
            </p>
          {/if}
        </div>
      </section>
    {:else if !$pubkey}
      <div class="card2 bg-alt p-4 text-center shadow-md">
        <strong>Log in to request publishing access</strong>
        <p class="mt-2 text-sm opacity-70">
          Community content remains readable, but applications must be tied to your pubkey.
        </p>
      </div>
    {:else if currentUserAdmin}
      <div class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
        <strong>You have access to all sections of this group</strong>
        <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
          <Button class="btn btn-primary justify-center" onclick={openAdminPanel}
            >Go to Admin panel</Button>
          <Button class="btn btn-neutral justify-center" onclick={openModerationDashboard}
            >Go to Moderation dashboard</Button>
        </div>
      </div>
    {:else if currentUserBanned}
      <div class="card2 bg-alt p-4 text-center shadow-md">
        <strong>Community access is blocked</strong>
        <p class="mt-2 text-sm opacity-70">
          This pubkey is banned from publishing or requesting additional permissions in this
          community.
        </p>
      </div>
    {:else}
      {#if currentUserModerator}
        <div class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
          <strong>You can publish in all sections of this group</strong>
          <div class="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
            <Button class="btn btn-primary justify-center" onclick={openModerationDashboard}
              >Go to Moderation dashboard</Button>
          </div>
        </div>
      {:else}
        <details
          class="card2 bg-alt shrink-0 overflow-hidden shadow-md"
          bind:open={publishingAccessOpen}>
          <summary class="cursor-pointer p-4 marker:text-primary">
            <div
              class="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-start justify-between gap-3 align-top">
              <div>
                <h2 class="text-xl font-semibold">Publishing requests</h2>
                <p class="mt-1 text-sm opacity-70">
                  Request normal section-level publishing access with moderator-curated forms.
                </p>
              </div>
              <span class="badge badge-neutral">{sectionItems.length} sections</span>
            </div>
          </summary>

          <div class="border-t border-base-300 p-4">
            <div class="grid gap-3 lg:grid-cols-2">
              {#each sectionItems as item (item.section.name)}
                <section
                  id={getPublishingAccessRequestId(item.section.name)}
                  class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md"
                  class:border-success={item.state.status === "granted"}
                  class:border-error={item.state.status === "rejected"}
                  class:border-warning={item.state.status === "pending"}>
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="text-lg font-semibold">{item.displayName}</h3>
                      <p class="text-sm opacity-70">
                        Grants {item.section.kinds
                          .map(kind => (kind.subtype ? `${kind.kind}:${kind.subtype}` : kind.kind))
                          .join(", ")}
                      </p>
                    </div>
                    <span class={`badge ${statusClass(item.state.status)}`}
                      >{item.state.status}</span>
                  </div>

                  {#if item.state.status !== "granted" && item.history?.latestPriorReview}
                    {@const priorReview = item.history.latestPriorReview}
                    <p
                      class={`rounded-box p-3 text-sm ${reviewHistoryToneClass(priorReview.status)}`}>
                      {reviewHistoryLabel(priorReview.status)} by
                      <ProfileLink
                        pubkey={priorReview.event.pubkey}
                        relays={communityProfileRelays} /> on {new Date(
                        priorReview.event.created_at * 1000,
                      ).toLocaleString()}.
                    </p>
                  {/if}

                  {#if item.state.status === "granted"}
                    <p class="rounded-box bg-success/10 p-3 text-sm text-success">
                      Access is granted for this section.
                    </p>
                  {:else if item.form}
                    <form
                      class="flex flex-col gap-3"
                      onsubmit={preventDefault(() =>
                        submitApplication(item.section.name, item.displayName, item.form!),
                      )}>
                      <div>
                        <strong>{item.form.name}</strong>
                        {#if item.form.description}
                          <p class="text-sm opacity-70">{item.form.description}</p>
                        {/if}
                      </div>

                      {#each item.form.fieldOrder as fieldId}
                        {@const field = item.form.fields[fieldId]}
                        {#if field?.type === "label"}
                          <p class="rounded-box bg-base-200 p-3 text-sm">{field.label}</p>
                        {:else if field?.type === "option"}
                          {@const selectedValues = getChoiceValues(
                            item.section.name,
                            field,
                            item.state.response,
                          )}
                          <Field>
                            {#snippet label()}<p>{field.label}</p>{/snippet}
                            {#snippet input()}
                              <fieldset
                                class="flex flex-col gap-2"
                                disabled={item.state.status !== "none"}>
                                {#each field.options as option}
                                  {@const isSelected = selectedValues.includes(option.id)}
                                  <div class="flex flex-col gap-2">
                                    <label class="flex items-center gap-2 text-sm">
                                      <input
                                        type={isMultipleChoiceField(field) ? "checkbox" : "radio"}
                                        name={`${item.section.name}-${field.id}`}
                                        class={isMultipleChoiceField(field)
                                          ? "checkbox checkbox-sm"
                                          : "radio radio-sm"}
                                        required={!isMultipleChoiceField(field) &&
                                          isRequiredField(field)}
                                        checked={isSelected}
                                        onchange={event =>
                                          setChoiceAnswer(
                                            item.section.name,
                                            field,
                                            option.id,
                                            event.currentTarget.checked,
                                          )} />
                                      <span>{option.label}</span>
                                    </label>
                                    {#if option.settings.isOther === true && isSelected}
                                      <input
                                        class="input input-sm input-bordered ml-7 w-[calc(100%-1.75rem)]"
                                        placeholder="Please explain"
                                        required
                                        value={getOtherAnswer(
                                          item.section.name,
                                          field.id,
                                          option.id,
                                          item.state.response,
                                        )}
                                        oninput={event =>
                                          setOtherAnswer(
                                            item.section.name,
                                            field.id,
                                            option.id,
                                            event.currentTarget.value,
                                          )} />
                                    {/if}
                                  </div>
                                {/each}
                              </fieldset>
                            {/snippet}
                          </Field>
                        {:else if field}
                          <Field>
                            {#snippet label()}<p>{field.label}</p>{/snippet}
                            {#snippet input()}
                              <textarea
                                class="textarea textarea-bordered min-h-24 w-full"
                                disabled={item.state.status !== "none"}
                                required={isRequiredField(field)}
                                value={getAnswer(item.section.name, field, item.state.response)}
                                oninput={event =>
                                  setAnswer(item.section.name, field.id, event.currentTarget.value)}
                              ></textarea>
                            {/snippet}
                          </Field>
                        {/if}
                      {/each}

                      {#if item.state.status === "none"}
                        <div class="flex justify-end">
                          <Button type="submit" class="btn btn-primary">Submit application</Button>
                        </div>
                      {:else if item.state.response}
                        <div class="rounded-box bg-base-200 p-3 text-sm">
                          {#if item.state.status === "pending"}
                            This application is pending moderator review.
                          {:else if item.state.status === "rejected"}
                            This application was rejected. Delete it before submitting a revised
                            application.
                          {/if}
                        </div>
                        <div class="flex justify-end">
                          <Button
                            class="btn btn-error"
                            onclick={() =>
                              deleteSubmission(
                                item.section.name,
                                item.displayName,
                                item.state.response!,
                              )}>
                            Delete submission
                          </Button>
                        </div>
                      {/if}
                    </form>
                  {:else}
                    <p class="rounded-box bg-base-200 p-3 text-sm opacity-75">
                      No application form is currently available for this section.
                    </p>
                  {/if}
                </section>
              {/each}
            </div>
          </div>
        </details>
      {/if}

      <details
        class="card2 bg-alt shrink-0 overflow-hidden shadow-md"
        bind:open={moderatorRequestsOpen}
        ontoggle={toggleModeratorRequests}>
        <summary class="cursor-pointer p-4 marker:text-primary">
          <div
            class="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-start justify-between gap-3 align-top">
            <div>
              <h2 class="text-xl font-semibold">Moderator requests</h2>
              <p class="mt-1 text-sm opacity-70">
                Ask the community key to add your pubkey as a section moderator.
              </p>
            </div>
            <span
              class={`badge ${moderatorRequestStatusUpdateCount > 0 ? "badge-info" : "badge-neutral"}`}>
              {$activeCommunityUserModeratorRequestsLoading
                ? "loading"
                : moderatorRequestStatusUpdateCount > 0
                  ? `${moderatorRequestStatusUpdateCount} updated`
                  : `${moderatorRequestItems.length} sections`}
            </span>
          </div>
        </summary>

        {#if moderatorRequestsOpen}
          <div class="border-t border-base-300 p-4">
            <div class="grid gap-3 lg:grid-cols-2">
              {#each moderatorRequestItems as item (item.section.name)}
                <article
                  class={`rounded-box border border-base-300 bg-base-100 p-4 ${item.statusUpdated ? "border-info bg-info/10 ring-1 ring-info/30" : item.status === "pending" ? "border-warning bg-warning/10" : ""}`}>
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 class="font-semibold">{item.displayName}</h3>
                      <p class="text-sm opacity-70">
                        Moderator authority can approve membership requests and publish application
                        forms.
                      </p>
                    </div>
                    <span class={`badge ${statusClass(item.status)}`}>
                      {item.status === "none"
                        ? "not requested"
                        : item.status === "pending"
                          ? "requested"
                          : item.status}
                    </span>
                    {#if item.statusUpdated}
                      <span class="badge badge-info">updated</span>
                    {/if}
                  </div>

                  {#if item.status === "accepted"}
                    <p class="mt-3 rounded-box bg-success/10 p-3 text-sm text-success">
                      Your pubkey is already configured as a moderator for this section.
                    </p>
                  {:else if item.status === "pending"}
                    <p class="mt-3 rounded-box bg-warning/10 p-3 text-sm text-warning">
                      Your moderator request is waiting for community admin review.
                    </p>
                  {:else if item.status === "rejected"}
                    <p class="mt-3 rounded-box bg-error/10 p-3 text-sm text-error">
                      This request was rejected. The admin can still grant your request later.
                    </p>
                  {/if}
                  {#if item.publishState?.status === "publishing"}
                    <p class="mt-3 rounded-box bg-info/10 p-3 text-sm text-info">
                      {item.publishState.detail}
                    </p>
                  {:else if item.publishState?.status === "failed"}
                    <p class="mt-3 rounded-box bg-error/10 p-3 text-sm text-error">
                      Publish failed: {item.publishState.detail}
                    </p>
                  {:else if item.publishState?.status === "sent" && item.status === "pending"}
                    <p class="mt-3 rounded-box bg-success/10 p-3 text-sm text-success">
                      Relay confirmed your moderator request.
                    </p>
                  {/if}

                  <div class="mt-4 flex justify-end">
                    <Button
                      class={`btn ${item.status === "rejected" ? "btn-error" : "btn-primary"}`}
                      disabled={$activeCommunityUserModeratorRequestsLoading ||
                        item.status === "pending" ||
                        item.status === "accepted" ||
                        item.status === "rejected" ||
                        item.publishState?.status === "publishing"}
                      onclick={() => submitModeratorRequest(item.section.name, item.displayName)}>
                      {$activeCommunityUserModeratorRequestsLoading
                        ? "Checking..."
                        : item.publishState?.status === "publishing"
                          ? "Publishing..."
                          : item.status === "rejected"
                            ? "Rejected"
                            : item.publishState?.status === "failed"
                              ? "Request again"
                              : item.status === "pending"
                                ? "Requested"
                                : item.status === "accepted"
                                  ? "Moderator enabled"
                                  : "Request moderator role"}
                    </Button>
                  </div>
                </article>
              {/each}
            </div>
          </div>
        {/if}
      </details>
    {/if}
  {/if}
</PageContent>
