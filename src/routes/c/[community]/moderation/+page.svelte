<script lang="ts">
  import {tick} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository, waitForThunkCompletion} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE, makeEvent, type TrustedEvent} from "@welshman/util"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Field from "@lib/components/Field.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CommunityContentReportCard from "@app/components/community/CommunityContentReportCard.svelte"
  import ModerationReportList from "@app/components/community/ModerationReportList.svelte"
  import {preventDefault} from "@lib/html"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {
    FORM_RESPONSE_KIND,
    getCommunitySectionDisplayName,
    getProfileListPubkeys,
    normalizePubkey,
  } from "@app/core/community"
  import {makeCommunityGrantEvent, makeCommunityRevokeEvent} from "@app/core/community-admin"
  import {
    activeCommunityAdmissionForms,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportDeleteEvents,
    activeCommunityReportEvents,
    activeCommunityReportReviewEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    makeCommunityReportReviewFilters,
  } from "@app/core/community-state"
  import {
    findProfileListEvent,
    getGrantCapability,
    getGrantCapableSectionModeratorPubkeys,
  } from "@app/core/community-permissions"
  import {
    canReviewCommunityContentReport,
    getEffectiveCommunityModerationActionsByReporter,
    getCommunityContentReportGroups,
    getCommunityContentReports,
    isCommunityAdmin,
  } from "@app/core/community-reports"
  import {
    COMMUNITY_FORM_REVIEW_KIND,
    type CommunityAdmissionForm,
    type CommunityAdmissionFormDraft,
    type CommunityAdmissionFormDraftOption,
    type CommunityAdmissionFormDraftQuestion,
    type CommunityAdmissionQuestionType,
    getAdmissionReviewHistory,
    getAdmissionResponseDisplayValue,
    getAdmissionSubmissionState,
    makeAdmissionFormDraftFromForm,
    makeAdmissionFormFieldsFromDraft,
    makeAdmissionFormTemplate,
    makeAdmissionReview,
    parseAdmissionResponse,
    validateAdmissionFormDraft,
  } from "@app/core/community-forms"
  import {getCommunityScopedPublishRelays} from "@app/core/community-relays"
  import {parseCommunityRouteParam} from "@app/util/routes"

  type ReviewApplication = {
    sectionName: string
    sectionDisplayName: string
    form: CommunityAdmissionForm
    response: NonNullable<ReturnType<typeof parseAdmissionResponse>>
    state: ReturnType<typeof getAdmissionSubmissionState>
    history: ReturnType<typeof getAdmissionReviewHistory>
  }

  type PageMode = "queue" | "forms" | "moderation"

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
  let pageMode = $state<PageMode>("queue")
  let selectedSectionName = $state("")
  let drafts = $state<Record<string, CommunityAdmissionFormDraft>>({})
  let formBuilderElement = $state<HTMLFormElement | undefined>()
  const communityPublishRelays = $derived(
    getCommunityScopedPublishRelays($activeCommunityDefinition),
  )

  const grantableSections = $derived(
    communityBootstrapReady
      ? ($activeCommunityDefinition?.sections || [])
          .map(section => ({
            section,
            displayName: getCommunitySectionDisplayName(section),
            capability:
              $pubkey && $activeCommunityDefinition
                ? getGrantCapability({
                    definition: $activeCommunityDefinition,
                    userPubkey: $pubkey,
                    sectionName: section.name,
                    reportState: $activeCommunityReportState,
                  })
                : undefined,
          }))
          .filter(item => item.capability?.canGrant)
      : [],
  )
  const selected = $derived(
    grantableSections.find(item => item.section.name === selectedSectionName),
  )
  const activeForm = $derived(
    selectedSectionName ? $activeCommunityAdmissionForms[selectedSectionName] : undefined,
  )
  const missingFormSections = $derived(
    grantableSections.filter(item => !$activeCommunityAdmissionForms[item.section.name]),
  )
  const setupComplete = $derived(grantableSections.length > 0 && missingFormSections.length === 0)
  const canAccessModerationPage = $derived.by(() => {
    if (!communityBootstrapReady || !$activeCommunityDefinition || !$pubkey) return false
    if (grantableSections.length > 0) return true

    return isCommunityAdmin($activeCommunityDefinition, $pubkey)
  })
  const currentModerationActions = $derived(
    getEffectiveCommunityModerationActionsByReporter($activeCommunityReportState, $pubkey || ""),
  )
  const currentEventModerationActions = $derived(
    currentModerationActions.filter(report => report.target === "event"),
  )
  const currentPersonModerationActions = $derived(
    currentModerationActions.filter(report => report.target === "person"),
  )
  const formAddresses = $derived(
    Object.values($activeCommunityAdmissionForms).map(form => form.address),
  )
  const responseFilters = $derived(
    communityBootstrapReady && formAddresses.length
      ? [{kinds: [FORM_RESPONSE_KIND], "#a": formAddresses}]
      : [],
  )
  const responseEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})),
  )
  const responseIds = $derived($responseEvents.map(event => event.id))
  const responseApplicantPubkeys = $derived(
    Array.from(
      new Set($responseEvents.map(event => normalizePubkey(event.pubkey || "")).filter(Boolean)),
    ),
  )
  const deleteFilters = $derived(responseIds.length ? [{kinds: [DELETE], "#e": responseIds}] : [])
  const reviewFilters = $derived(
    responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [],
  )
  const reviewHistoryFilters = $derived(
    communityBootstrapReady && $activeCommunityDefinition && responseApplicantPubkeys.length
      ? [
          {
            kinds: [COMMUNITY_FORM_REVIEW_KIND],
            "#p": responseApplicantPubkeys,
            "#h": [$activeCommunityDefinition.pubkey],
            "#k": [String(FORM_RESPONSE_KIND)],
            limit: 500,
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
  const applications = $derived.by(() => {
    if (!$activeCommunityDefinition) return []

    const sectionByForm = new Map<
      string,
      {sectionName: string; sectionDisplayName: string; form: CommunityAdmissionForm}
    >()
    for (const item of grantableSections) {
      const form = $activeCommunityAdmissionForms[item.section.name]
      if (form)
        sectionByForm.set(form.address, {
          sectionName: item.section.name,
          sectionDisplayName: item.displayName,
          form,
        })
    }

    return $responseEvents
      .map(event => parseAdmissionResponse(event))
      .filter(Boolean)
      .map(response => {
        const matched = sectionByForm.get(response!.formAddress)
        if (!matched) return undefined

        const moderators = getGrantCapableSectionModeratorPubkeys({
          definition: $activeCommunityDefinition!,
          sectionName: matched.sectionName,
          reportState: $activeCommunityReportState,
        })
        const state = getAdmissionSubmissionState({
          responseEvents: $responseEvents,
          deleteEvents: $deleteEvents,
          reviewEvents: $reviewEvents,
          formAddress: response!.formAddress,
          applicantPubkey: response!.event.pubkey,
          moderatorPubkeys: moderators,
        })

        if (state.response?.event.id !== response!.event.id) return undefined

        const history = getAdmissionReviewHistory({
          reviewEvents: [...$reviewEvents, ...$reviewHistoryEvents],
          applicantPubkey: response!.event.pubkey,
          communityPubkey: $activeCommunityDefinition!.pubkey,
          sectionName: matched.sectionName,
          moderatorPubkeys: moderators,
          excludeResponseId: state.response?.event.id,
        })

        return {...matched, response: response!, state, history}
      })
      .filter((item): item is ReviewApplication => Boolean(item))
  })
  const newApplications = $derived(applications.filter(item => item.state.status === "pending"))
  const grantedApplications = $derived(applications.filter(item => item.state.status === "granted"))
  const rejectedApplications = $derived(
    applications.filter(item => item.state.status === "rejected"),
  )
  const applicationGroups = $derived([
    {label: "New", items: newApplications},
    {label: "Granted", items: grantedApplications},
    {label: "Rejected", items: rejectedApplications},
  ] satisfies Array<{label: string; items: ReviewApplication[]}>)
  const contentReports = $derived.by(() => {
    if (!$activeCommunityDefinition) return []

    return getCommunityContentReports({
      definition: $activeCommunityDefinition,
      reportEvents: $activeCommunityReportEvents,
      reviewEvents: $activeCommunityReportReviewEvents,
      deleteEvents: $activeCommunityReportDeleteEvents,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
    }).filter(report =>
      canReviewCommunityContentReport({
        definition: $activeCommunityDefinition!,
        reviewerPubkey: $pubkey || "",
        report,
        reportState: $activeCommunityReportState,
      }),
    )
  })
  const contentReportGroups = $derived(getCommunityContentReportGroups(contentReports))
  const pendingContentReportGroups = $derived(contentReportGroups.filter(group => !group.reviewed))
  const reviewedContentReportGroups = $derived(contentReportGroups.filter(group => group.reviewed))
  const reportReviewFilters = $derived(
    communityBootstrapReady && $activeCommunityDefinition
      ? makeCommunityReportReviewFilters($activeCommunityDefinition, $activeCommunityReportEvents)
      : [],
  )
  const pageTabs = $derived([
    {
      mode: "queue" as const,
      label: "Review queue",
      count: newApplications.length + pendingContentReportGroups.length,
      disabled: grantableSections.length === 0 && contentReportGroups.length === 0,
      warning: newApplications.length > 0 || pendingContentReportGroups.length > 0,
    },
    {
      mode: "forms" as const,
      label: "Application forms",
      count: missingFormSections.length,
      disabled: grantableSections.length === 0,
      warning: missingFormSections.length > 0,
    },
    {
      mode: "moderation" as const,
      label: "Moderation",
      count: currentModerationActions.length,
      disabled: false,
      warning: false,
    },
  ])

  const cloneDraft = (draft: CommunityAdmissionFormDraft): CommunityAdmissionFormDraft =>
    JSON.parse(JSON.stringify(draft))

  const getSectionDisplayName = (sectionName: string) =>
    grantableSections.find(item => item.section.name === sectionName)?.displayName || sectionName
  const formatSectionKinds = (kinds: Array<{kind: number; subtype?: string}>) =>
    kinds.length
      ? kinds
          .map(kind => (kind.subtype ? `${kind.kind}:${kind.subtype}` : String(kind.kind)))
          .join(", ")
      : "No kinds configured"

  function getDraft(sectionName: string, form?: CommunityAdmissionForm) {
    const sectionDisplayName = getSectionDisplayName(sectionName)
    const draft =
      drafts[sectionName] ||
      makeAdmissionFormDraftFromForm({
        form,
        communityPubkey: $activeCommunityDefinition?.pubkey || "",
        sectionName,
        currentModeratorPubkey: $pubkey || "",
      })

    if (form || sectionDisplayName === sectionName) return draft

    return {
      ...draft,
      name: `${sectionDisplayName} application`,
      description: `Request access to publish in the ${sectionDisplayName} section.`,
      questions: draft.questions.map(question =>
        question.id === "q1"
          ? {...question, label: `Describe your application to publish in ${sectionDisplayName}`}
          : question,
      ),
    }
  }

  const selectedDraft = $derived(selected ? getDraft(selected.section.name, activeForm) : undefined)
  const selectedDraftErrors = $derived(
    selectedDraft ? validateAdmissionFormDraft(selectedDraft) : [],
  )

  const setDraft = (sectionName: string, draft: CommunityAdmissionFormDraft) => {
    drafts = {...drafts, [sectionName]: draft}
  }

  const updateDraft = (
    sectionName: string,
    updater: (draft: CommunityAdmissionFormDraft) => void,
  ) => {
    const draft = cloneDraft(getDraft(sectionName, $activeCommunityAdmissionForms[sectionName]))
    updater(draft)
    setDraft(sectionName, draft)
  }

  const updateQuestion = (
    questionId: string,
    updater: (question: CommunityAdmissionFormDraftQuestion) => CommunityAdmissionFormDraftQuestion,
  ) => {
    if (!selected) return

    updateDraft(selected.section.name, draft => {
      draft.questions = draft.questions.map(question =>
        question.id === questionId ? updater(question) : question,
      )
    })
  }

  const makeQuestionId = (draft: CommunityAdmissionFormDraft) => {
    let index = draft.questions.length + 1
    let id = `q${index}`

    while (draft.questions.some(question => question.id === id)) {
      index += 1
      id = `q${index}`
    }

    return id
  }

  const defaultOptions = (): CommunityAdmissionFormDraftOption[] => [
    {id: "option-1", label: "Option 1"},
    {id: "option-2", label: "Option 2"},
  ]

  const addQuestion = (type: CommunityAdmissionQuestionType) => {
    if (!selected) return

    updateDraft(selected.section.name, draft => {
      draft.questions = [
        ...draft.questions,
        {
          id: makeQuestionId(draft),
          type,
          label: "Untitled question",
          required: true,
          options: type === "singleChoice" || type === "multipleChoice" ? defaultOptions() : [],
        },
      ]
    })
  }

  const removeQuestion = (questionId: string) => {
    if (!selected) return

    updateDraft(selected.section.name, draft => {
      draft.questions = draft.questions.filter(question => question.id !== questionId)
    })
  }

  const moveQuestion = (questionId: string, direction: -1 | 1) => {
    if (!selected) return

    updateDraft(selected.section.name, draft => {
      const index = draft.questions.findIndex(question => question.id === questionId)
      const target = index + direction
      if (index < 0 || target < 0 || target >= draft.questions.length) return

      const questions = [...draft.questions]
      ;[questions[index], questions[target]] = [questions[target], questions[index]]
      draft.questions = questions
    })
  }

  const setQuestionType = (questionId: string, type: CommunityAdmissionQuestionType) => {
    updateQuestion(questionId, question => ({
      ...question,
      type,
      options:
        type === "singleChoice" || type === "multipleChoice"
          ? question.options.length
            ? question.options
            : defaultOptions()
          : [],
    }))
  }

  const addOption = (questionId: string) => {
    updateQuestion(questionId, question => ({
      ...question,
      options: [...question.options, makeNextOption(question)],
    }))
  }

  const makeNextOption = (question: CommunityAdmissionFormDraftQuestion) => {
    let index = question.options.length + 1
    let id = `option-${index}`

    while (question.options.some(option => option.id === id)) {
      index += 1
      id = `option-${index}`
    }

    return {id, label: `Option ${index}`}
  }

  const addOtherOption = (questionId: string) => {
    updateQuestion(questionId, question => {
      if (question.options.some(option => option.isOther)) return question

      return {
        ...question,
        options: [...question.options, {id: "other", label: "Other", isOther: true}],
      }
    })
  }

  const updateOption = (questionId: string, optionId: string, label: string) => {
    updateQuestion(questionId, question => ({
      ...question,
      options: question.options.map(option =>
        option.id === optionId ? {...option, label} : option,
      ),
    }))
  }

  const removeOption = (questionId: string, optionId: string) => {
    updateQuestion(questionId, question => ({
      ...question,
      options: question.options.filter(option => option.id !== optionId),
    }))
  }

  const getQuestionTypeLabel = (type: CommunityAdmissionQuestionType) => {
    if (type === "paragraph") return "Paragraph"
    if (type === "singleChoice") return "Single choice"
    if (type === "multipleChoice") return "Multiple choice"

    return "Short answer"
  }

  const isChoiceQuestion = (question: CommunityAdmissionFormDraftQuestion) =>
    question.type === "singleChoice" || question.type === "multipleChoice"

  const getResponseLabel = (application: ReviewApplication, fieldId: string) =>
    application.form.fields[fieldId]?.label || fieldId

  const getResponseDisplayValue = (
    application: ReviewApplication,
    response: ReviewApplication["response"]["responses"][number],
  ) =>
    getAdmissionResponseDisplayValue(
      application.form.fields[response.fieldId],
      response.value,
      response.metadata,
    )
  const reviewHistoryToneClass = (status: string) =>
    status === "granted" ? "bg-success/10 text-success" : "bg-error/10 text-error"
  const reviewHistoryLabel = (status: string) =>
    status === "granted" ? "Previously granted" : "Previously rejected"
  const hasSuccessfulRelay = (thunk: ReturnType<typeof publishThunk>) =>
    Object.values(thunk.results).some(result => result.status === "success")

  const getPublishError = (thunk: ReturnType<typeof publishThunk>) => {
    const result = Object.values(thunk.results).find(result => result.status !== "success")

    return result ? `${result.relay}: ${result.detail || result.status}` : "No relay confirmed."
  }

  const selectSection = async (sectionName: string) => {
    selectedSectionName = sectionName
    await tick()
    formBuilderElement?.scrollIntoView({behavior: "smooth", block: "start"})
  }

  const selectPageMode = (mode: PageMode, disabled = false) => {
    if (disabled) return

    pageMode = mode
  }

  const publishSelectedForm = () => {
    if (
      !communityBootstrapReady ||
      !$activeCommunityDefinition ||
      !selected?.capability?.canGrant ||
      !selectedDraft
    ) {
      pushToast({theme: "error", message: "You can only edit forms for sections you can grant."})
      return
    }

    const errors = validateAdmissionFormDraft(selectedDraft)
    if (errors.length) {
      pushToast({theme: "error", message: errors[0]})
      return
    }

    if (communityPublishRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    pushModal(Confirm, {
      title: "Publish application form",
      message: `Publish the application form for ${selected.displayName}?`,
      confirm: async () => {
        const template = makeAdmissionFormTemplate({
          identifier: selectedDraft.identifier,
          communityPubkey: $activeCommunityDefinition.pubkey,
          sectionName: selected.section.name,
          name: selectedDraft.name,
          description: selectedDraft.description,
          relays: communityPublishRelays,
          fields: makeAdmissionFormFieldsFromDraft(selectedDraft),
        })

        const thunk = publishThunk({
          relays: communityPublishRelays,
          event: makeEvent(template.kind, template),
        })
        await waitForThunkCompletion(thunk)

        if (!hasSuccessfulRelay(thunk)) {
          if (thunk.event) repository.removeEvent(thunk.event.id)
          pushToast({theme: "error", message: `Form publish failed: ${getPublishError(thunk)}`})
          return
        }

        if (thunk.event) repository.publish(thunk.event as TrustedEvent)
        drafts = Object.fromEntries(
          Object.entries(drafts).filter(([sectionName]) => sectionName !== selected.section.name),
        )
        pushToast({theme: "success", message: `${selected.displayName} application form published.`})
        history.back()
      },
    })
  }

  const reviewApplication = (application: ReviewApplication, status: "granted" | "rejected") => {
    if (!communityBootstrapReady || !$activeCommunityDefinition) return

    const capability = getGrantCapability({
      definition: $activeCommunityDefinition,
      userPubkey: $pubkey || "",
      sectionName: application.sectionName,
      reportState: $activeCommunityReportState,
    })

    if (!capability.canGrant || !capability.profileList) {
      pushToast({
        theme: "error",
        message: "You need moderator authority for this section.",
      })
      return
    }

    if (communityPublishRelays.length === 0) {
      pushToast({theme: "error", message: "Community definition must declare at least one relay."})
      return
    }

    const applicant = normalizePubkey(application.response.event.pubkey)
    if (!applicant) return

    const profileListEvent = findProfileListEvent(
      capability.profileList,
      $activeCommunityProfileListEvents,
    )

    if (status === "granted") {
      const grant = makeCommunityGrantEvent({
        profileList: capability.profileList,
        profileListEvent,
        pubkey: applicant,
      })

      publishThunk({
        relays: communityPublishRelays,
        event: makeEvent(grant.kind, grant),
      })
    } else if (profileListEvent && getProfileListPubkeys(profileListEvent).includes(applicant)) {
      const revoke = makeCommunityRevokeEvent({
        profileList: capability.profileList,
        profileListEvent,
        pubkey: applicant,
      })

      publishThunk({
        relays: communityPublishRelays,
        event: makeEvent(revoke.kind, revoke),
      })
    }

    const review = makeAdmissionReview({
      responseId: application.response.event.id,
      applicantPubkey: applicant,
      formAddress: application.form.address,
      communityPubkey: $activeCommunityDefinition.pubkey,
      sectionName: application.sectionName,
      status,
    })

    publishThunk({relays: communityPublishRelays, event: makeEvent(review.kind, review)})
    pushToast({
      message:
        status === "granted"
          ? "Application granted."
          : application.state.status === "granted"
            ? "Access revoked."
            : "Application rejected.",
    })
  }

  $effect(() => {
    if (!selectedSectionName && grantableSections[0])
      selectedSectionName = grantableSections[0].section.name
  })

  $effect(() => {
    if (!canAccessModerationPage) return
    if (grantableSections.length === 0 && contentReportGroups.length === 0 && pageMode !== "moderation") {
      pageMode = "moderation"
    }
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0) return

    const filters = [
      ...responseFilters,
      ...deleteFilters,
      ...reviewFilters,
      ...reviewHistoryFilters,
      ...reportReviewFilters,
    ]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Settings} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Moderation</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="col-4 min-w-0 p-3 sm:p-4 lg:p-6">
  {#if communityBootstrapLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community permissions...</Spinner>
    </p>
  {:else if !communityBootstrapReady || !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else if !$pubkey}
    <p class="py-8 text-center opacity-70">Log in with a moderator key to manage applications.</p>
  {:else if !canAccessModerationPage}
    <p class="py-8 text-center opacity-70">
      This signer cannot manage this community's moderation workflows.
    </p>
  {:else}
    <div class="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {#each pageTabs as tab (tab.mode)}
        <Button
          class={`btn h-auto min-h-16 flex-nowrap justify-center gap-3 border px-4 py-3 font-semibold shadow-sm transition ${
            pageMode === tab.mode
              ? "btn-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-base-300"
              : tab.warning
                ? "border-warning/60 bg-base-100 text-base-content hover:border-warning hover:bg-warning/10"
                : "border-base-300 bg-base-100 text-base-content hover:border-primary/60 hover:bg-base-200"
          }`}
          aria-current={pageMode === tab.mode ? "page" : undefined}
          disabled={tab.disabled}
          onclick={() => selectPageMode(tab.mode, tab.disabled)}>
          <span class="min-w-0 truncate text-center leading-tight">{tab.label}</span>
          {#if tab.count > 0}
            <span
              class={`badge shrink-0 ${
                pageMode === tab.mode
                  ? "border-primary-content/40 bg-primary-content text-primary"
                  : tab.warning
                    ? "badge-warning"
                    : "badge-neutral"
              }`}>{tab.count}</span>
          {/if}
        </Button>
      {/each}
    </div>

    {#if pageMode === "forms"}
      <section class="card2 bg-alt col-4 flex flex-col gap-3 p-4 shadow-md">
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">Application forms</h2>
            <p class="text-sm opacity-70">
              Create one active application form per section you can grant.
            </p>
          </div>
          <Button class="btn btn-ghost" onclick={() => (pageMode = "queue")}
            >Back to review queue</Button>
        </div>
        {#if missingFormSections.length > 0}
          <p class="rounded-box border border-warning bg-warning/10 p-3 text-sm text-warning">
            Users cannot apply to {missingFormSections.map(item => item.displayName).join(", ")} until
            these forms are published.
          </p>
        {/if}
      </section>

      <div class="grid min-w-0 gap-4 xl:grid-cols-[minmax(220px,280px)_minmax(0,1fr)]">
        <aside class="flex flex-col gap-2">
          {#each grantableSections as item}
            {@const itemForm = $activeCommunityAdmissionForms[item.section.name]}
            {@const hasDraft = Boolean(drafts[item.section.name])}
            {@const isSelected = selectedSectionName === item.section.name}
            <button
              type="button"
              class={`card2 bg-alt min-w-0 p-4 text-left shadow-md transition ${isSelected ? "border-primary bg-primary/10" : ""} ${!itemForm ? "border-warning bg-warning/10" : ""}`}
              onclick={() => selectSection(item.section.name)}>
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <strong>{item.displayName}</strong>
                  <p class="mt-1 text-xs opacity-60">
                    Kinds: {formatSectionKinds(item.section.kinds)}
                  </p>
                </div>
                <span
                  class={`badge shrink-0 !overflow-visible px-3 ${hasDraft ? "badge-info" : itemForm ? "badge-success" : "badge-warning"}`}>
                  {hasDraft ? "Draft changes" : itemForm ? "Ready" : "Missing form"}
                </span>
              </div>
              <p class="mt-2 break-words text-sm opacity-70">
                {itemForm ? itemForm.name : "Users cannot apply until a form is published."}
              </p>
            </button>
          {/each}
        </aside>

        {#if selected && selectedDraft}
          <div class="grid min-w-0 gap-4 2xl:grid-cols-[minmax(0,1fr)_minmax(320px,440px)]">
            <form
              bind:this={formBuilderElement}
              class="card2 bg-alt flex min-w-0 flex-col gap-4 p-4 shadow-md"
              onsubmit={preventDefault(publishSelectedForm)}>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div class="min-w-0">
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="min-w-0 break-words text-xl font-semibold">
                      {activeForm ? "Edit application form" : "Create application form"}
                    </h2>
                    <span class="badge badge-primary">{selected.displayName}</span>
                  </div>
                  <p class="text-sm opacity-70">
                    Build the questions applicants answer before moderators review access.
                  </p>
                </div>
              </div>

              {#if selectedDraftErrors.length > 0}
                <div
                  class="rounded-box border border-warning bg-warning/10 p-3 text-sm text-warning">
                  <strong>Form is not ready to publish.</strong>
                  <ul class="mt-2 list-disc pl-5">
                    {#each selectedDraftErrors as error}
                      <li>{error}</li>
                    {/each}
                  </ul>
                </div>
              {/if}

              <div class="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Field class="min-w-0">
                  {#snippet label()}<p>Form name</p>{/snippet}
                  {#snippet input()}
                    <input
                      class="input input-bordered w-full"
                      value={selectedDraft.name}
                      oninput={event =>
                        updateDraft(
                          selected.section.name,
                          draft => (draft.name = event.currentTarget.value),
                        )} />
                  {/snippet}
                </Field>
                <Field class="min-w-0">
                  {#snippet label()}<p>Description</p>{/snippet}
                  {#snippet input()}
                    <textarea
                      class="textarea textarea-bordered min-h-20 w-full resize-y"
                      value={selectedDraft.description}
                      oninput={event =>
                        updateDraft(
                          selected.section.name,
                          draft => (draft.description = event.currentTarget.value),
                        )}></textarea>
                  {/snippet}
                </Field>
              </div>

              <div class="flex flex-wrap gap-2">
                <Button class="btn btn-sm" onclick={() => addQuestion("shortAnswer")}
                  >Add short answer</Button>
                <Button class="btn btn-sm" onclick={() => addQuestion("paragraph")}
                  >Add paragraph</Button>
                <Button class="btn btn-sm" onclick={() => addQuestion("singleChoice")}
                  >Add single choice</Button>
                <Button class="btn btn-sm" onclick={() => addQuestion("multipleChoice")}
                  >Add multiple choice</Button>
              </div>

              <div class="flex flex-col gap-3">
                {#each selectedDraft.questions as question, index (question.id)}
                  <article class="rounded-box border border-base-300 bg-base-100 p-4 shadow-sm">
                    <div class="mb-3 flex flex-wrap items-center justify-between gap-2">
                      <div class="flex flex-wrap items-center gap-2">
                        <Button
                          class="btn btn-xs"
                          disabled={index === 0}
                          onclick={() => moveQuestion(question.id, -1)}>Up</Button>
                        <Button
                          class="btn btn-xs"
                          disabled={index === selectedDraft.questions.length - 1}
                          onclick={() => moveQuestion(question.id, 1)}>Down</Button>
                        <label
                          class="flex items-center gap-2 rounded-full bg-base-200 px-3 py-1 text-sm">
                          <input
                            type="checkbox"
                            class="checkbox checkbox-xs"
                            checked={question.required}
                            onchange={event =>
                              updateQuestion(question.id, current => ({
                                ...current,
                                required: event.currentTarget.checked,
                              }))} />
                          Required
                        </label>
                      </div>
                      <Button
                        class="btn btn-error btn-xs"
                        onclick={() => removeQuestion(question.id)}>Delete</Button>
                    </div>

                    <div class="grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                      <input
                        class="input input-bordered w-full font-semibold"
                        value={question.label}
                        placeholder="Untitled question"
                        oninput={event =>
                          updateQuestion(question.id, current => ({
                            ...current,
                            label: event.currentTarget.value,
                          }))} />
                      <select
                        class="select select-bordered w-full"
                        value={question.type}
                        onchange={event =>
                          setQuestionType(
                            question.id,
                            event.currentTarget.value as CommunityAdmissionQuestionType,
                          )}>
                        <option value="shortAnswer">Short answer</option>
                        <option value="paragraph">Paragraph</option>
                        <option value="singleChoice">Single choice</option>
                        <option value="multipleChoice">Multiple choice</option>
                      </select>
                    </div>

                    <div class="mt-4">
                      {#if question.type === "shortAnswer"}
                        <input
                          class="input input-bordered w-full"
                          disabled
                          placeholder="Type your answer here" />
                      {:else if question.type === "paragraph"}
                        <textarea
                          class="textarea textarea-bordered min-h-24 w-full resize-y"
                          disabled
                          placeholder="Type your answer here"></textarea>
                      {:else}
                        <div class="flex flex-col gap-2">
                          {#each question.options as option}
                            <div class="flex min-w-0 flex-wrap items-center gap-2 sm:flex-nowrap">
                              {#if question.type === "multipleChoice"}
                                <input type="checkbox" class="checkbox checkbox-sm" disabled />
                              {:else}
                                <input type="radio" class="radio radio-sm" disabled />
                              {/if}
                              <input
                                class="input input-sm input-bordered min-w-0 flex-1"
                                value={option.label}
                                disabled={option.isOther}
                                oninput={event =>
                                  updateOption(
                                    question.id,
                                    option.id,
                                    event.currentTarget.value,
                                  )} />
                              <Button
                                class="btn btn-ghost btn-xs"
                                disabled={question.options.length <= 2}
                                onclick={() => removeOption(question.id, option.id)}>Remove</Button>
                            </div>
                          {/each}
                          <div class="flex flex-wrap items-center gap-2 pt-1">
                            <Button
                              class="btn btn-outline btn-sm"
                              onclick={() => addOption(question.id)}>Add option</Button>
                            {#if !question.options.some(option => option.isOther)}
                              <span class="text-sm opacity-60">or</span>
                              <Button
                                class="btn btn-outline btn-sm"
                                onclick={() => addOtherOption(question.id)}>add other</Button>
                            {/if}
                          </div>
                        </div>
                      {/if}
                    </div>
                  </article>
                {:else}
                  <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70">
                    Add at least one question to publish this form.
                  </p>
                {/each}
              </div>

              <div class="flex flex-col items-end gap-2 border-t border-base-300 pt-4">
                <Button
                  type="submit"
                  class="btn btn-primary"
                  disabled={selectedDraftErrors.length > 0}>Publish form</Button>
                <p class="text-right text-xs opacity-60">
                  Last step: publish this form to community relays.
                </p>
              </div>
            </form>

            <aside
              class="card2 bg-alt flex min-w-0 flex-col gap-4 p-4 shadow-md 2xl:sticky 2xl:top-4 2xl:self-start">
              <div>
                <h2 class="text-xl font-semibold">Preview</h2>
                <p class="text-sm opacity-70">
                  Applicants will see this form before submitting a public application.
                </p>
              </div>
              <div class="rounded-box bg-base-100 p-4">
                <div class="rounded-box bg-base-200 p-4">
                  <span class="badge badge-primary mb-3">{selected.displayName}</span>
                  <h3 class="break-words text-2xl font-bold">{selectedDraft.name}</h3>
                  <p class="mt-2 whitespace-pre-wrap text-sm opacity-75">
                    {selectedDraft.description}
                  </p>
                </div>

                <div class="mt-4 flex flex-col gap-3">
                  {#each selectedDraft.questions as question}
                    <div class="rounded-box border border-base-300 p-3">
                      <div class="flex min-w-0 items-center gap-2">
                        {#if question.required}<span class="text-error">*</span>{/if}
                        <strong class="min-w-0 break-words">{question.label}</strong>
                      </div>
                      <p class="mb-2 text-xs opacity-60">{getQuestionTypeLabel(question.type)}</p>
                      {#if question.type === "shortAnswer"}
                        <input
                          class="input input-sm input-bordered w-full"
                          disabled
                          placeholder="Type your answer here" />
                      {:else if question.type === "paragraph"}
                        <textarea
                          class="textarea textarea-bordered min-h-20 w-full resize-y"
                          disabled
                          placeholder="Type your answer here"></textarea>
                      {:else if isChoiceQuestion(question)}
                        <div class="flex flex-col gap-2">
                          {#each question.options as option}
                            <div class="flex flex-col gap-2">
                              <label class="flex items-center gap-2 text-sm">
                                {#if question.type === "multipleChoice"}
                                  <input type="checkbox" class="checkbox checkbox-sm" disabled />
                                {:else}
                                  <input type="radio" class="radio radio-sm" disabled />
                                {/if}
                                <span class="min-w-0 break-words">{option.label}</span>
                              </label>
                              {#if option.isOther}
                                <input
                                  class="input input-sm input-bordered ml-7 w-[calc(100%-1.75rem)]"
                                  disabled
                                  placeholder="Please explain" />
                              {/if}
                            </div>
                          {/each}
                        </div>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            </aside>
          </div>
        {/if}
      </div>
    {:else if pageMode === "moderation"}
      <section class="card2 bg-alt col-4 flex flex-col gap-3 p-4 shadow-md">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">Moderation</h2>
            <p class="text-sm opacity-70">
              Review active event censors and person bans published by this key. Revoking publishes
              a kind:5 delete for the original report.
            </p>
          </div>
          <span class="badge badge-neutral">
            {currentModerationActions.length}
            {currentModerationActions.length === 1 ? "action" : "actions"}
          </span>
        </div>
      </section>

      <div class="col-4 grid gap-4 lg:grid-cols-2">
        <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold">Event moderation</h3>
              <p class="text-sm opacity-70">Section-scoped event censor reports from this key.</p>
            </div>
            <span class="badge badge-warning">{currentEventModerationActions.length}</span>
          </div>
          <ModerationReportList
            reports={currentEventModerationActions}
            emptyMessage="No active event moderations from this key." />
        </section>

        <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold">Person bans</h3>
              <p class="text-sm opacity-70">Community-wide person bans from this key.</p>
            </div>
            <span class="badge badge-error">{currentPersonModerationActions.length}</span>
          </div>
          <ModerationReportList
            reports={currentPersonModerationActions}
            emptyMessage="No active person bans from this key." />
        </section>
      </div>
    {:else}
      {#if grantableSections.length > 0}
        <section
          class={`card2 bg-alt col-4 flex flex-col gap-3 p-4 shadow-md ${setupComplete ? "" : "border-warning bg-warning/10"}`}>
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 class="text-xl font-semibold">Application setup</h2>
              {#if setupComplete}
                <p class="text-sm opacity-70">All grantable sections are accepting applications.</p>
              {:else}
                <p class="text-sm text-warning">
                  Users cannot apply to: {missingFormSections
                    .map(item => item.displayName)
                    .join(", ")}.
                </p>
                <p class="text-sm opacity-70">
                  Create one application form for each section you moderate.
                </p>
              {/if}
            </div>
            <Button
              class={`btn ${setupComplete ? "btn-primary" : "btn-warning"}`}
              onclick={() => (pageMode = "forms")}>Edit forms</Button>
          </div>
        </section>

        <details class="card2 bg-alt col-4 p-4 shadow-md">
          <summary class="cursor-pointer list-none">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <h2 class="text-xl font-semibold">Application reviews</h2>
                  {#if newApplications.length > 0}
                    <span class="badge badge-warning">{newApplications.length} new</span>
                  {/if}
                  <span class="badge badge-neutral">{applications.length} total</span>
                </div>
                <p class="text-sm opacity-70">
                  Applications for sections you can grant. Expand to review full details.
                </p>
              </div>
              <span class="badge badge-ghost">Expand</span>
            </div>
          </summary>

          <div class="mt-4 flex flex-col gap-4">
            {#each applicationGroups as group}
              <div class="flex flex-col gap-2">
              <h3 class="font-semibold">{group.label}</h3>
              {#each group.items as application (application.response.event.id)}
                <article
                  class={`rounded-box border border-base-300 bg-base-100 p-3 ${
                    application.state.status === "pending" ? "border-warning bg-warning/10" : ""
                  }`}>
                  <div class="flex flex-wrap items-start justify-between gap-3">
                    <div class="min-w-0">
                      <strong>{application.sectionDisplayName}</strong>
                      <p class="truncate text-xs opacity-70">
                        Applicant: <ProfileLink pubkey={application.response.event.pubkey} />
                      </p>
                      <p class="text-xs opacity-70">
                        Submitted {new Date(
                          application.response.event.created_at * 1000,
                        ).toLocaleString()}
                      </p>
                    </div>
                    <span class="badge">{application.state.status}</span>
                  </div>

                  {#if application.history.latestPriorReview}
                    {@const priorReview = application.history.latestPriorReview}
                    <p
                      class={`mt-3 rounded-box p-3 text-sm ${reviewHistoryToneClass(priorReview.status)}`}>
                      {reviewHistoryLabel(priorReview.status)} by
                      <ProfileLink pubkey={priorReview.event.pubkey} /> on {new Date(
                        priorReview.event.created_at * 1000,
                      ).toLocaleString()}.
                    </p>
                  {/if}

                  {#if application.response.responses[0]}
                    {@const firstResponse = application.response.responses[0]}
                    <div class="mt-3 rounded-box bg-base-200 p-2 text-sm">
                      <strong>{getResponseLabel(application, firstResponse.fieldId)}</strong>
                      <p class="line-clamp-3 whitespace-pre-wrap opacity-80">
                        {getResponseDisplayValue(application, firstResponse)}
                      </p>
                    </div>
                  {/if}

                  <details class="mt-3">
                    <summary class="cursor-pointer text-sm font-medium">Review full response</summary>
                    <div class="mt-2 grid gap-2">
                      {#each application.response.responses as response}
                        <div class="rounded-box bg-base-200 p-2 text-sm">
                          <strong>{getResponseLabel(application, response.fieldId)}</strong>
                          <p class="whitespace-pre-wrap opacity-80">
                            {getResponseDisplayValue(application, response)}
                          </p>
                        </div>
                      {/each}
                    </div>
                  </details>

                  <div class="mt-3 flex justify-end gap-2">
                    <Button
                      class="btn btn-error btn-sm"
                      disabled={application.state.status === "rejected"}
                      onclick={() => reviewApplication(application, "rejected")}>
                      {application.state.status === "granted" ? "Revoke" : "Reject"}
                    </Button>
                    <Button
                      class="btn btn-success btn-sm"
                      disabled={application.state.status === "granted"}
                      onclick={() => reviewApplication(application, "granted")}>Grant</Button>
                  </div>
                </article>
              {:else}
                <p class="rounded-box bg-base-200 p-3 text-sm opacity-70">
                  {#if !setupComplete && group.label === "New"}
                    Create forms before users can apply to missing sections.
                  {:else}
                    No {group.label.toLowerCase()} applications.
                  {/if}
                </p>
              {/each}
            </div>
            {/each}
          </div>
        </details>
      {/if}

      <details class="card2 bg-alt col-4 p-4 shadow-md">
        <summary class="cursor-pointer list-none">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <h2 class="text-xl font-semibold">Content reports</h2>
                {#if pendingContentReportGroups.length > 0}
                  <span class="badge badge-warning">{pendingContentReportGroups.length} pending</span>
                {/if}
                <span class="badge badge-neutral">{contentReportGroups.length} total</span>
              </div>
              <p class="text-sm opacity-70">
                Reports for sections you moderate. Expand to inspect context and mark reviewed.
              </p>
            </div>
            <span class="badge badge-ghost">Expand</span>
          </div>
        </summary>

        <div class="mt-4 flex flex-col gap-4">
          <div class="flex flex-col gap-2">
            <h3 class="font-semibold">Pending</h3>
            {#each pendingContentReportGroups as group (group.key)}
              <CommunityContentReportCard {group} />
            {:else}
              <p class="rounded-box bg-base-200 p-3 text-sm opacity-70">No pending content reports.</p>
            {/each}
          </div>

          <details class="rounded-box bg-base-200 p-3" open={pendingContentReportGroups.length === 0}>
            <summary class="cursor-pointer font-semibold">
              Reviewed ({reviewedContentReportGroups.length})
            </summary>
            <div class="mt-3 flex flex-col gap-2">
              {#each reviewedContentReportGroups as group (group.key)}
                <CommunityContentReportCard {group} />
              {:else}
                <p class="rounded-box bg-base-100 p-3 text-sm opacity-70">No reviewed content reports.</p>
              {/each}
            </div>
          </details>
        </div>
      </details>
    {/if}
  {/if}
</PageContent>
