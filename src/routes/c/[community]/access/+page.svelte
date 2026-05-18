<script lang="ts">
  import {onDestroy, tick} from "svelte"
  import {page} from "$app/stores"
  import {pubkey, publishThunk, repository, waitForThunkCompletion} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE, makeEvent, type TrustedEvent} from "@welshman/util"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Field from "@lib/components/Field.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import {preventDefault} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {FORM_RESPONSE_KIND, getCommunitySectionDisplayName} from "@app/core/community"
  import {
    activeCommunityAdmissionForms,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    activeCommunityUserModeratorRequestStates,
    activeCommunityUserModeratorRequestsLoading,
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
    getAdmissionSubmissionState,
    makeAdmissionResponse,
    makeAdmissionResponseDelete,
  } from "@app/core/community-forms"
  import {
    makeModeratorBadgeRequest,
    makeModeratorProfileListRequest,
  } from "@app/core/community-moderator-requests"
  import {checked, normalizeChecked, setChecked} from "@app/util/notifications"
  import {parseCommunityRouteParam} from "@app/util/routes"

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
  const deleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})),
  )
  const reviewEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})),
  )
  const sectionItems = $derived(
    communityBootstrapReady ? ($activeCommunityDefinition?.sections || []).map(section => {
      const displayName = getCommunitySectionDisplayName(section)
      const form = forms[section.name] || forms[displayName]
      const granted = Boolean(
        $pubkey &&
        userHasSectionProfileListAccess({
          section,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
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
              moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({
                definition: $activeCommunityDefinition!,
                sectionName: section.name,
              }),
              profileListGranted: granted,
            })
          : ({status: granted ? "granted" : "none"} satisfies CommunitySubmissionState)

      return {section, displayName, form, granted, state}
    }) : [],
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

    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
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

    publishThunk({relays: $activeCommunityRelays, event: makeEvent(template.kind, template)})
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

    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
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
      relays: $activeCommunityRelays,
    }
    const profileList = makeModeratorProfileListRequest(options)
    const badge = makeModeratorBadgeRequest(options)

    setModeratorRequestPublishState(sectionName, {
      status: "publishing",
      detail: "Waiting for relay confirmation...",
    })

    let profileListThunk: ReturnType<typeof publishThunk>
    let badgeThunk: ReturnType<typeof publishThunk>

    try {
      profileListThunk = publishThunk({
        relays: $activeCommunityRelays,
        event: makeEvent(profileList.kind, profileList),
      })
      badgeThunk = publishThunk({
        relays: $activeCommunityRelays,
        event: makeEvent(badge.kind, badge),
      })

      await Promise.all([
        waitForThunkCompletion(profileListThunk),
        waitForThunkCompletion(badgeThunk),
      ])
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      setModeratorRequestPublishState(sectionName, {status: "failed", detail})
      pushToast({theme: "error", message: `Moderator request failed: ${detail}`})
      return
    }

    if (!hasSuccessfulRelay(profileListThunk) || !hasSuccessfulRelay(badgeThunk)) {
      const detail = getPublishError([profileListThunk, badgeThunk])
      setModeratorRequestPublishState(sectionName, {status: "failed", detail})
      pushToast({theme: "error", message: `Moderator request failed: ${detail}`})
      return
    }

    repository.publish(profileListThunk.event as TrustedEvent)
    repository.publish(badgeThunk.event as TrustedEvent)
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
      message: `Delete your ${sectionDisplayName} access request so you can submit a revised application?`,
      confirm: async () => {
        answers = {...answers, [sectionName]: {...response.values}}
        otherAnswers = {...otherAnswers, [sectionName]: getResponseOtherAnswers(response)}
        const template = makeAdmissionResponseDelete({responseId: response.event.id})

        publishThunk({relays: $activeCommunityRelays, event: makeEvent(template.kind, template)})
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

  const getPublishingAccessRequestId = (sectionName: string) =>
    `publishing-access-request-${encodeURIComponent(sectionName)}`

  $effect(() => {
    const sectionName = requestedSectionName

    if (!sectionName) {
      lastScrolledSectionName = ""
      return
    }
    if (sectionName === lastScrolledSectionName) return
    if (!sectionItems.some(item => item.section.name === sectionName)) return

    publishingAccessOpen = true
    lastScrolledSectionName = sectionName
    void tick().then(() => {
      document
        .getElementById(getPublishingAccessRequestId(sectionName))
        ?.scrollIntoView({behavior: "smooth", block: "start"})
    })
  })

  $effect(() => {
    if (moderatorRequestStatusUpdateCount > 0) moderatorRequestsOpen = true
  })

  onDestroy(() => {
    setChecked($page.url.pathname)
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={ShieldUser} /></div>
  {/snippet}
  {#snippet title()}<strong>Access Requests</strong>{/snippet}
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
  {:else if !$pubkey}
    <div class="card2 bg-alt p-4 text-center shadow-md">
      <strong>Log in to request publishing access</strong>
      <p class="mt-2 text-sm opacity-70">
        Community content remains readable, but applications must be tied to your pubkey.
      </p>
    </div>
  {:else}
    <div class="card2 bg-alt shrink-0 p-4 shadow-md">
      <h2 class="text-xl font-semibold">Your community permissions</h2>
      <p class="mt-1 text-sm opacity-70">
        Request section access with moderator-curated forms. Existing submissions are read-only
        until you delete them.
      </p>
    </div>

    <details
      class="card2 bg-alt shrink-0 overflow-hidden shadow-md"
      bind:open={publishingAccessOpen}>
      <summary class="cursor-pointer p-4 marker:text-primary">
        <div
          class="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-start justify-between gap-3 align-top">
          <div>
            <h2 class="text-xl font-semibold">Publishing access requests</h2>
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
                <span class={`badge ${statusClass(item.state.status)}`}>{item.state.status}</span>
              </div>

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
                                    required={!isMultipleChoiceField(field) && isRequiredField(field)}
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

    <details
      class="card2 bg-alt shrink-0 overflow-hidden shadow-md"
      bind:open={moderatorRequestsOpen}
      ontoggle={toggleModeratorRequests}>
      <summary class="cursor-pointer p-4 marker:text-primary">
        <div
          class="inline-flex w-[calc(100%-1.5rem)] flex-wrap items-start justify-between gap-3 align-top">
          <div>
            <h2 class="text-xl font-semibold">Moderator access requests</h2>
            <p class="mt-1 text-sm opacity-70">
              Ask the community key to add your pubkey as a list manager and badge issuer for a
              section.
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
                      Moderator authority can approve access requests and publish application forms.
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
</PageContent>
