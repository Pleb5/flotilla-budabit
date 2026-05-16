<script lang="ts">
  import {tick} from "svelte"
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE, makeEvent} from "@welshman/util"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Field from "@lib/components/Field.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import ModerationReportList from "@app/components/community/ModerationReportList.svelte"
  import {preventDefault} from "@lib/html"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {
    FORM_RESPONSE_KIND,
    getCommunitySectionDisplayName,
    normalizePubkey,
  } from "@app/core/community"
  import {makeCommunityGrantEvents} from "@app/core/community-admin"
  import {
    activeCommunityAdmissionForms,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    loadCommunityEvents,
    makeCommunityReportDeleteFilters,
    makeCommunityReportFilters,
  } from "@app/core/community-state"
  import {
    findProfileListEvent,
    getGrantCapability,
    getGrantCapableSectionModeratorPubkeys,
  } from "@app/core/community-permissions"
  import {
    getEffectiveCommunityModerationActionsByReporter,
    isCommunityAdmin,
  } from "@app/core/community-reports"
  import {
    COMMUNITY_FORM_REVIEW_KIND,
    type CommunityAdmissionForm,
    type CommunityAdmissionFormDraft,
    type CommunityAdmissionFormDraftOption,
    type CommunityAdmissionFormDraftQuestion,
    type CommunityAdmissionQuestionType,
    getAdmissionSubmissionState,
    makeAdmissionFormDraftFromForm,
    makeAdmissionFormFieldsFromDraft,
    makeAdmissionFormTemplate,
    makeAdmissionReview,
    parseAdmissionResponse,
    validateAdmissionFormDraft,
  } from "@app/core/community-forms"
  import {parseCommunityRouteParam} from "@app/util/routes"

  type ReviewApplication = {
    sectionName: string
    sectionDisplayName: string
    form: CommunityAdmissionForm
    response: NonNullable<ReturnType<typeof parseAdmissionResponse>>
    state: ReturnType<typeof getAdmissionSubmissionState>
  }

  type PageMode = "queue" | "forms" | "moderation"

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || "")
  let pageMode = $state<PageMode>("queue")
  let selectedSectionName = $state("")
  let drafts = $state<Record<string, CommunityAdmissionFormDraft>>({})
  let formBuilderElement = $state<HTMLFormElement | undefined>()
  let reportHydrationKey = $state("")
  let reportDeleteHydrationKey = $state("")

  const makeHydrationKey = (relays: string[], filters: unknown[]) =>
    JSON.stringify({relays: relays.slice().sort(), filters})

  const grantableSections = $derived(
    ($activeCommunityDefinition?.sections || [])
      .map(section => ({
        section,
        displayName: getCommunitySectionDisplayName(section),
        capability:
          $pubkey && $activeCommunityDefinition
            ? getGrantCapability({
                definition: $activeCommunityDefinition,
                userPubkey: $pubkey,
                sectionName: section.name,
              })
            : undefined,
      }))
      .filter(item => item.capability?.canGrant),
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
    if (!$activeCommunityDefinition || !$pubkey) return false
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
    formAddresses.length ? [{kinds: [FORM_RESPONSE_KIND], "#a": formAddresses}] : [],
  )
  const responseEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})),
  )
  const responseIds = $derived($responseEvents.map(event => event.id))
  const deleteFilters = $derived(responseIds.length ? [{kinds: [DELETE], "#e": responseIds}] : [])
  const reviewFilters = $derived(
    responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [],
  )
  const deleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})),
  )
  const reviewEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})),
  )
  const reportFilters = $derived(
    $activeCommunityDefinition ? makeCommunityReportFilters($activeCommunityDefinition) : [],
  )
  const reportDeleteFilters = $derived(
    makeCommunityReportDeleteFilters($activeCommunityReportEvents),
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

        return {...matched, response: response!, state}
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
  const pageTabs = $derived([
    {
      mode: "queue" as const,
      label: "Review queue",
      count: newApplications.length,
      disabled: grantableSections.length === 0,
      warning: newApplications.length > 0,
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
    if (!$activeCommunityDefinition || !selected?.capability?.canGrant || !selectedDraft) {
      pushToast({theme: "error", message: "You can only edit forms for sections you can grant."})
      return
    }

    const errors = validateAdmissionFormDraft(selectedDraft)
    if (errors.length) {
      pushToast({theme: "error", message: errors[0]})
      return
    }

    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    pushModal(Confirm, {
      title: "Publish application form",
      message: `Publish the application form for ${selected.displayName}? This becomes the latest active form for this section.`,
      confirm: () => {
        const template = makeAdmissionFormTemplate({
          identifier: selectedDraft.identifier,
          communityPubkey: $activeCommunityDefinition.pubkey,
          sectionName: selected.section.name,
          name: selectedDraft.name,
          description: selectedDraft.description,
          relays: $activeCommunityRelays,
          fields: makeAdmissionFormFieldsFromDraft(selectedDraft),
        })

        publishThunk({relays: $activeCommunityRelays, event: makeEvent(template.kind, template)})
        pushToast({message: `${selected.displayName} application form published.`})
        history.back()
      },
    })
  }

  const reviewApplication = (application: ReviewApplication, status: "granted" | "rejected") => {
    if (!$activeCommunityDefinition) return

    const capability = getGrantCapability({
      definition: $activeCommunityDefinition,
      userPubkey: $pubkey || "",
      sectionName: application.sectionName,
    })

    if (!capability.canGrant || !capability.profileList || !capability.badge) {
      pushToast({
        theme: "error",
        message: "You need list-manager and badge-issuer authority for this section.",
      })
      return
    }

    const applicant = normalizePubkey(application.response.event.pubkey)
    if (!applicant) return

    if (status === "granted") {
      const profileListEvent = findProfileListEvent(
        capability.profileList,
        $activeCommunityProfileListEvents,
      )
      const events = makeCommunityGrantEvents({
        profileList: capability.profileList,
        profileListEvent,
        badge: capability.badge,
        pubkey: applicant,
      })

      publishThunk({
        relays: $activeCommunityRelays,
        event: makeEvent(events.profileList.kind, events.profileList),
      })
      publishThunk({
        relays: $activeCommunityRelays,
        event: makeEvent(events.badgeAward.kind, events.badgeAward),
      })
    }

    const review = makeAdmissionReview({
      responseId: application.response.event.id,
      applicantPubkey: applicant,
      status,
    })

    publishThunk({relays: $activeCommunityRelays, event: makeEvent(review.kind, review)})
    pushToast({message: status === "granted" ? "Application granted." : "Application rejected."})
  }

  $effect(() => {
    if (!selectedSectionName && grantableSections[0])
      selectedSectionName = grantableSections[0].section.name
  })

  $effect(() => {
    if (!canAccessModerationPage) return
    if (grantableSections.length === 0 && pageMode !== "moderation") pageMode = "moderation"
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0) return

    const filters = [...responseFilters, ...deleteFilters, ...reviewFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})

    return () => controller.abort()
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0) return
    if (reportFilters.length === 0) return
    const key = makeHydrationKey($activeCommunityRelays, reportFilters)
    if (key === reportHydrationKey) return

    reportHydrationKey = key
    void loadCommunityEvents($activeCommunityRelays, reportFilters).catch(error => {
      console.warn("[community] Failed to hydrate moderation reports", error)
    })
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0) return
    if (reportDeleteFilters.length === 0) return
    const key = makeHydrationKey($activeCommunityRelays, reportDeleteFilters)
    if (key === reportDeleteHydrationKey) return

    reportDeleteHydrationKey = key
    void loadCommunityEvents($activeCommunityRelays, reportDeleteFilters).catch(error => {
      console.warn("[community] Failed to hydrate moderation report deletes", error)
    })
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

<PageContent class="content col-4 p-4">
  {#if !$activeCommunityDefinition}
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
          class={`btn justify-center gap-3 border font-semibold shadow-sm transition ${
            pageMode === tab.mode
              ? "btn-primary ring-2 ring-primary/40 ring-offset-2 ring-offset-base-300"
              : tab.warning
                ? "border-warning/60 bg-base-100 text-base-content hover:border-warning hover:bg-warning/10"
                : "border-base-300 bg-base-100 text-base-content hover:border-primary/60 hover:bg-base-200"
          }`}
          aria-current={pageMode === tab.mode ? "page" : undefined}
          disabled={tab.disabled}
          onclick={() => selectPageMode(tab.mode, tab.disabled)}>
          {tab.label}
          {#if tab.count > 0}
            <span
              class={`badge ${
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

      <div class="col-4 grid gap-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <aside class="flex flex-col gap-2">
          {#each grantableSections as item}
            {@const itemForm = $activeCommunityAdmissionForms[item.section.name]}
            {@const hasDraft = Boolean(drafts[item.section.name])}
            {@const isSelected = selectedSectionName === item.section.name}
            <button
              type="button"
              class={`card2 bg-alt p-4 text-left shadow-md transition ${isSelected ? "border-primary bg-primary/10" : ""} ${!itemForm ? "border-warning bg-warning/10" : ""}`}
              onclick={() => selectSection(item.section.name)}>
              <div class="flex items-start justify-between gap-3">
                <div>
                  <strong>{item.displayName}</strong>
                  <p class="mt-1 text-xs opacity-60">
                    Kinds: {formatSectionKinds(item.section.kinds)}
                  </p>
                </div>
                <span
                  class={`badge ${hasDraft ? "badge-info" : itemForm ? "badge-success" : "badge-warning"}`}>
                  {hasDraft ? "Draft changes" : itemForm ? "Ready" : "Missing form"}
                </span>
              </div>
              <p class="mt-2 text-sm opacity-70">
                {itemForm ? itemForm.name : "Users cannot apply until a form is published."}
              </p>
            </button>
          {/each}
        </aside>

        {#if selected && selectedDraft}
          <div class="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
            <form
              bind:this={formBuilderElement}
              class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md"
              onsubmit={preventDefault(publishSelectedForm)}>
              <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div class="flex flex-wrap items-center gap-2">
                    <h2 class="text-xl font-semibold">
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

              <div class="grid gap-3 md:grid-cols-2">
                <Field>
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
                <Field>
                  {#snippet label()}<p>Description</p>{/snippet}
                  {#snippet input()}
                    <textarea
                      class="textarea textarea-bordered min-h-20 w-full"
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

                    <div class="grid gap-3 md:grid-cols-[1fr_180px]">
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
                          class="textarea textarea-bordered min-h-24 w-full"
                          disabled
                          placeholder="Type your answer here"></textarea>
                      {:else}
                        <div class="flex flex-col gap-2">
                          {#each question.options as option}
                            <div class="flex items-center gap-2">
                              {#if question.type === "multipleChoice"}
                                <input type="checkbox" class="checkbox checkbox-sm" disabled />
                              {:else}
                                <input type="radio" class="radio radio-sm" disabled />
                              {/if}
                              <input
                                class="input input-sm input-bordered flex-1"
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
              class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md xl:sticky xl:top-4 xl:self-start">
              <div>
                <h2 class="text-xl font-semibold">Preview</h2>
                <p class="text-sm opacity-70">
                  Applicants will see this form before submitting a public application.
                </p>
              </div>
              <div class="rounded-box bg-base-100 p-4">
                <div class="rounded-box bg-base-200 p-4">
                  <span class="badge badge-primary mb-3">{selected.displayName}</span>
                  <h3 class="text-2xl font-bold">{selectedDraft.name}</h3>
                  <p class="mt-2 whitespace-pre-wrap text-sm opacity-75">
                    {selectedDraft.description}
                  </p>
                </div>

                <div class="mt-4 flex flex-col gap-3">
                  {#each selectedDraft.questions as question}
                    <div class="rounded-box border border-base-300 p-3">
                      <div class="flex items-center gap-2">
                        {#if question.required}<span class="text-error">*</span>{/if}
                        <strong>{question.label}</strong>
                      </div>
                      <p class="mb-2 text-xs opacity-60">{getQuestionTypeLabel(question.type)}</p>
                      {#if question.type === "shortAnswer"}
                        <input
                          class="input input-sm input-bordered w-full"
                          disabled
                          placeholder="Type your answer here" />
                      {:else if question.type === "paragraph"}
                        <textarea
                          class="textarea textarea-bordered min-h-20 w-full"
                          disabled
                          placeholder="Type your answer here"></textarea>
                      {:else if isChoiceQuestion(question)}
                        <div class="flex flex-col gap-2">
                          {#each question.options as option}
                            <label class="flex items-center gap-2 text-sm">
                              {#if question.type === "multipleChoice"}
                                <input type="checkbox" class="checkbox checkbox-sm" disabled />
                              {:else}
                                <input type="radio" class="radio radio-sm" disabled />
                              {/if}
                              <span>{option.label}</span>
                            </label>
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
              Review active censor reports published by this key. Revoking publishes a kind:5 delete
              for the original report.
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
            relays={$activeCommunityRelays}
            emptyMessage="No active event moderations from this key." />
        </section>

        <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
          <div class="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold">People moderation</h3>
              <p class="text-sm opacity-70">Community-wide person censor reports from this key.</p>
            </div>
            <span class="badge badge-error">{currentPersonModerationActions.length}</span>
          </div>
          <ModerationReportList
            reports={currentPersonModerationActions}
            relays={$activeCommunityRelays}
            emptyMessage="No active person moderations from this key." />
        </section>
      </div>
    {:else}
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

      <section class="card2 bg-alt col-4 flex flex-col gap-4 p-4 shadow-md">
        <div>
          <div class="flex flex-wrap items-center gap-2">
            <h2 class="text-xl font-semibold">Review queue</h2>
            {#if newApplications.length > 0}
              <span class="badge badge-warning">{newApplications.length} new</span>
            {/if}
          </div>
          <p class="text-sm opacity-70">
            New applications are shown first, followed by granted and rejected submissions.
          </p>
        </div>

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

                {#if application.response.responses[0]}
                  <div class="mt-3 rounded-box bg-base-200 p-2 text-sm">
                    <strong
                      >{application.form.fields[application.response.responses[0].fieldId]?.label ||
                        application.response.responses[0].fieldId}</strong>
                    <p class="line-clamp-3 whitespace-pre-wrap opacity-80">
                      {application.response.responses[0].value}
                    </p>
                  </div>
                {/if}

                <details class="mt-3">
                  <summary class="cursor-pointer text-sm font-medium">Review full response</summary>
                  <div class="mt-2 grid gap-2">
                    {#each application.response.responses as response}
                      <div class="rounded-box bg-base-200 p-2 text-sm">
                        <strong
                          >{application.form.fields[response.fieldId]?.label ||
                            response.fieldId}</strong>
                        <p class="whitespace-pre-wrap opacity-80">{response.value}</p>
                      </div>
                    {/each}
                  </div>
                </details>

                <div class="mt-3 flex justify-end gap-2">
                  <Button
                    class="btn btn-error btn-sm"
                    disabled={application.state.status === "rejected"}
                    onclick={() => reviewApplication(application, "rejected")}>Reject</Button>
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
      </section>
    {/if}
  {/if}
</PageContent>
