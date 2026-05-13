<script lang="ts">
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent} from "@welshman/util"
  import ShieldUser from "@assets/icons/shield-user.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import {preventDefault} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {FORM_RESPONSE_KIND, getProfileListPubkeys} from "@app/core/community"
  import {
    activeCommunityAdmissionForms,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {findProfileListEvent, getGrantCapableSectionModeratorPubkeys, getPrimaryProfileListRef} from "@app/core/community-permissions"
  import {
    COMMUNITY_FORM_DELETE_KIND,
    COMMUNITY_FORM_REVIEW_KIND,
    type CommunityAdmissionForm,
    type CommunityFormField,
    type CommunityFormResponse,
    type CommunitySubmissionState,
    getAdmissionSubmissionState,
    makeAdmissionResponse,
    makeAdmissionResponseDelete,
  } from "@app/core/community-forms"

  let answers = $state<Record<string, Record<string, string>>>({})
  let previousStatuses = $state<Record<string, string>>({})
  let statusesInitialized = $state(false)

  const forms = $derived($activeCommunityAdmissionForms)
  const formAddresses = $derived(Object.values(forms).map(form => form.address))
  const responseFilters = $derived(
    $pubkey && formAddresses.length
      ? [{kinds: [FORM_RESPONSE_KIND], authors: [$pubkey], "#a": formAddresses}]
      : [],
  )
  const responseEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})))
  const responseIds = $derived($responseEvents.map(event => event.id))
  const deleteFilters = $derived(
    $pubkey && responseIds.length
      ? [{kinds: [COMMUNITY_FORM_DELETE_KIND], authors: [$pubkey], "#e": responseIds}]
      : [],
  )
  const reviewFilters = $derived(
    responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [],
  )
  const deleteEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})))
  const reviewEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})))
  const sectionItems = $derived(
    ($activeCommunityDefinition?.sections || []).map(section => {
      const form = forms[section.name]
      const profileListEvent = findProfileListEvent(getPrimaryProfileListRef(section), $activeCommunityProfileListEvents)
      const granted = Boolean($pubkey && getProfileListPubkeys(profileListEvent).includes($pubkey))
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

      return {section, form, granted, state}
    }),
  )

  const getAnswer = (sectionName: string, field: CommunityFormField, response?: CommunityFormResponse) =>
    answers[sectionName]?.[field.id] ?? response?.values[field.id] ?? ""

  const setAnswer = (sectionName: string, fieldId: string, value: string) => {
    answers = {
      ...answers,
      [sectionName]: {
        ...(answers[sectionName] || {}),
        [fieldId]: value,
      },
    }
  }

  const submitApplication = (sectionName: string, form: CommunityAdmissionForm) => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in before requesting access."})
      return
    }

    if ($activeCommunityRelays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const values = Object.fromEntries(
      form.fieldOrder
        .filter(fieldId => form.fields[fieldId]?.type !== "label")
        .map(fieldId => [fieldId, answers[sectionName]?.[fieldId] || ""]),
    )
    const template = makeAdmissionResponse({formAddress: form.address, values})

    publishThunk({relays: $activeCommunityRelays, event: makeEvent(template.kind, template)})
    pushToast({message: `Application submitted for ${sectionName}.`})
  }

  const deleteSubmission = (sectionName: string, response: CommunityFormResponse) => {
    pushModal(Confirm, {
      title: "Delete submission",
      message: `Delete your ${sectionName} access request so you can submit a revised application?`,
      confirm: async () => {
        answers = {...answers, [sectionName]: {...response.values}}
        const template = makeAdmissionResponseDelete({responseId: response.event.id})

        publishThunk({relays: $activeCommunityRelays, event: makeEvent(template.kind, template)})
        pushToast({message: "Submission deleted. You can submit a revised application after relays confirm it."})
        history.back()
      },
    })
  }

  const statusClass = (status: string) => {
    if (status === "granted") return "badge-success"
    if (status === "rejected") return "badge-error"
    if (status === "pending") return "badge-warning"

    return "badge-neutral"
  }

  $effect(() => {
    if ($activeCommunityRelays.length === 0) return

    const filters = [...responseFilters, ...deleteFilters, ...reviewFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters, signal: controller.signal})

    return () => controller.abort()
  })

  $effect(() => {
    const nextStatuses = Object.fromEntries(sectionItems.map(item => [item.section.name, item.state.status]))

    if (statusesInitialized) {
      for (const item of sectionItems) {
        const previous = previousStatuses[item.section.name]
        const current = item.state.status

        if (previous && previous !== current && (current === "granted" || current === "rejected")) {
          pushToast({
            theme: current === "granted" ? "success" : "warning",
            message:
              current === "granted"
                ? `${item.section.name} access granted.`
                : `${item.section.name} application rejected.`,
          })
        }
      }
    }

    previousStatuses = nextStatuses
    statusesInitialized = true
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={ShieldUser} /></div>
  {/snippet}
  {#snippet title()}<strong>Access Requests</strong>{/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  {#if !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else if !$pubkey}
    <div class="card2 bg-alt p-4 text-center shadow-md">
      <strong>Log in to request publishing access</strong>
      <p class="mt-2 text-sm opacity-70">Community content remains readable, but applications must be tied to your pubkey.</p>
    </div>
  {:else}
    <div class="card2 bg-alt p-4 shadow-md">
      <h2 class="text-xl font-semibold">Your community permissions</h2>
      <p class="mt-1 text-sm opacity-70">
        Request section access with moderator-curated forms. Existing submissions are read-only until you delete them.
      </p>
    </div>

    <div class="grid gap-3 lg:grid-cols-2">
      {#each sectionItems as item (item.section.name)}
        <section
          class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md"
          class:border-success={item.state.status === "granted"}
          class:border-error={item.state.status === "rejected"}
          class:border-warning={item.state.status === "pending"}>
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 class="text-lg font-semibold">{item.section.name}</h3>
              <p class="text-sm opacity-70">
                Grants {item.section.kinds.map(kind => kind.subtype ? `${kind.kind}:${kind.subtype}` : kind.kind).join(", ")}
              </p>
            </div>
            <span class={`badge ${statusClass(item.state.status)}`}>{item.state.status}</span>
          </div>

          {#if item.state.status === "granted"}
            <p class="rounded-box bg-success/10 p-3 text-sm text-success">Access is granted for this section.</p>
          {:else if item.form}
            <form class="flex flex-col gap-3" onsubmit={preventDefault(() => submitApplication(item.section.name, item.form!))}>
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
                  <fieldset class="flex flex-col gap-2" disabled={item.state.status !== "none"}>
                    <legend class="font-medium">{field.label}</legend>
                    {#each field.options as option}
                      <label class="flex items-center gap-2 text-sm">
                        <input
                          type="radio"
                          name={`${item.section.name}-${field.id}`}
                          class="radio radio-sm"
                          checked={getAnswer(item.section.name, field, item.state.response) === option.id}
                          onchange={() => setAnswer(item.section.name, field.id, option.id)} />
                        <span>{option.label}</span>
                      </label>
                    {/each}
                  </fieldset>
                {:else if field}
                  <label class="flex flex-col gap-1">
                    <span class="font-medium">{field.label}</span>
                    <textarea
                      class="textarea textarea-bordered min-h-24"
                      disabled={item.state.status !== "none"}
                      value={getAnswer(item.section.name, field, item.state.response)}
                      oninput={event => setAnswer(item.section.name, field.id, event.currentTarget.value)}></textarea>
                  </label>
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
                    This application was rejected. Delete it before submitting a revised application.
                  {/if}
                </div>
                <div class="flex justify-end">
                  <Button class="btn btn-error" onclick={() => deleteSubmission(item.section.name, item.state.response!)}>
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
  {/if}
</PageContent>
