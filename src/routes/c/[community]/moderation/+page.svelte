<script lang="ts">
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent} from "@welshman/util"
  import Settings from "@assets/icons/settings.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {pushToast} from "@app/util/toast"
  import {FORM_RESPONSE_KIND, normalizePubkey} from "@app/core/community"
  import {makeCommunityGrantEvents} from "@app/core/community-admin"
  import {
    activeCommunityAdmissionForms,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {findProfileListEvent, getGrantCapability, getGrantCapableSectionModeratorPubkeys} from "@app/core/community-permissions"
  import {
    COMMUNITY_FORM_DELETE_KIND,
    COMMUNITY_FORM_REVIEW_KIND,
    type CommunityAdmissionForm,
    type CommunityFormFieldInput,
    getAdmissionSubmissionState,
    makeAdmissionFormTemplate,
    makeAdmissionReview,
    parseAdmissionResponse,
  } from "@app/core/community-forms"

  type EditableForm = {
    identifier: string
    name: string
    description: string
    questions: string
  }

  type ReviewApplication = {
    sectionName: string
    form: CommunityAdmissionForm
    response: NonNullable<ReturnType<typeof parseAdmissionResponse>>
    state: ReturnType<typeof getAdmissionSubmissionState>
  }

  let selectedSectionName = $state("")
  let editors = $state<Record<string, EditableForm>>({})

  const grantableSections = $derived(
    ($activeCommunityDefinition?.sections || [])
      .map(section => ({
        section,
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
  const selected = $derived(grantableSections.find(item => item.section.name === selectedSectionName))
  const activeForm = $derived(selectedSectionName ? $activeCommunityAdmissionForms[selectedSectionName] : undefined)
  const formAddresses = $derived(Object.values($activeCommunityAdmissionForms).map(form => form.address))
  const responseFilters = $derived(formAddresses.length ? [{kinds: [FORM_RESPONSE_KIND], "#a": formAddresses}] : [])
  const responseEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})))
  const responseIds = $derived($responseEvents.map(event => event.id))
  const deleteFilters = $derived(responseIds.length ? [{kinds: [COMMUNITY_FORM_DELETE_KIND], "#e": responseIds}] : [])
  const reviewFilters = $derived(responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [])
  const deleteEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})))
  const reviewEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})))
  const applications = $derived.by(() => {
    if (!$activeCommunityDefinition) return []

    const sectionByForm = new Map<string, {sectionName: string; form: CommunityAdmissionForm}>()
    for (const item of grantableSections) {
      const form = $activeCommunityAdmissionForms[item.section.name]
      if (form) sectionByForm.set(form.address, {sectionName: item.section.name, form})
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
  const newApplications = $derived(applications.filter(item => item!.state.status === "pending"))
  const grantedApplications = $derived(applications.filter(item => item!.state.status === "granted"))
  const rejectedApplications = $derived(applications.filter(item => item!.state.status === "rejected"))
  const applicationGroups = $derived([
    {label: "New", items: newApplications},
    {label: "Granted", items: grantedApplications},
    {label: "Rejected", items: rejectedApplications},
  ] satisfies Array<{label: string; items: ReviewApplication[]}>)

  const defaultIdentifier = (sectionName: string) =>
    `${sectionName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section"}-application`

  const normalizeOptionId = (value: string, index: number) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `option-${index + 1}`

  const formatFormFields = (form?: CommunityAdmissionForm) => {
    if (!form) return "text: Why should this community grant you access?"

    return form.fieldOrder
      .map(fieldId => form.fields[fieldId])
      .filter(Boolean)
      .map(field => {
        if (field.type === "label") return `label: ${field.label}`
        if (field.type === "option") {
          const options = field.options.map(option => `${option.id}=${option.label}`).join(", ")

          return `option: ${field.label}${options ? ` | ${options}` : ""}`
        }

        return `text: ${field.label}`
      })
      .join("\n")
  }

  const parseEditorFields = (source: string): CommunityFormFieldInput[] =>
    source
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)
      .map((line, index) => {
        const separatorIndex = line.indexOf(":")
        const prefix = separatorIndex > -1 ? line.slice(0, separatorIndex).trim().toLowerCase() : ""
        const body = separatorIndex > -1 ? line.slice(separatorIndex + 1).trim() : line
        const id = `q${index + 1}`

        if (prefix === "label") return {id, type: "label", label: body}

        if (prefix === "option") {
          const [label = "", optionSource = ""] = body.split("|").map(value => value.trim())
          const options = optionSource
            .split(",")
            .map(value => value.trim())
            .filter(Boolean)
            .map((value, optionIndex) => {
              const [rawId, rawLabel] = value.includes("=")
                ? value.split(/=(.*)/s).filter(Boolean)
                : [normalizeOptionId(value, optionIndex), value]

              return {
                id: normalizeOptionId(rawId || rawLabel || "", optionIndex),
                label: (rawLabel || rawId || "").trim(),
              }
            })
            .filter(option => option.id && option.label)

          return {id, type: "option", label, options, settings: {required: true}}
        }

        return {id, type: "text", label: prefix === "text" ? body : line, settings: {required: true}}
      })
      .filter(field => field.label.trim() && (field.type !== "option" || Boolean(field.options?.length)))

  const getEditor = (sectionName: string, form?: CommunityAdmissionForm): EditableForm =>
    editors[sectionName] || {
      identifier: form?.identifier || defaultIdentifier(sectionName),
      name: form?.name || `${sectionName} application`,
      description: form?.description || "",
      questions: formatFormFields(form),
    }

  const updateEditor = (sectionName: string, updates: Partial<EditableForm>) => {
    editors = {...editors, [sectionName]: {...getEditor(sectionName, activeForm), ...updates}}
  }

  const saveForm = () => {
    if (!$activeCommunityDefinition || !selected?.capability?.canGrant) {
      pushToast({theme: "error", message: "You can only edit forms for sections you can grant."})
      return
    }

    const editor = getEditor(selected.section.name, activeForm)
    const fields = parseEditorFields(editor.questions)

    if (!editor.identifier.trim() || !editor.name.trim() || fields.length === 0) {
      pushToast({theme: "error", message: "Add an identifier, name, and at least one valid field."})
      return
    }

    const template = makeAdmissionFormTemplate({
      identifier: editor.identifier,
      communityPubkey: $activeCommunityDefinition.pubkey,
      sectionName: selected.section.name,
      name: editor.name,
      description: editor.description,
      relays: $activeCommunityRelays,
      fields,
    })

    publishThunk({relays: $activeCommunityRelays, event: makeEvent(template.kind, template)})
    pushToast({message: `${selected.section.name} application form published.`})
  }

  const reviewApplication = (application: ReviewApplication, status: "granted" | "rejected") => {
    if (!$activeCommunityDefinition) return

    const capability = getGrantCapability({
      definition: $activeCommunityDefinition,
      userPubkey: $pubkey || "",
      sectionName: application.sectionName,
    })

    if (!capability.canGrant || !capability.profileList || !capability.badge) {
      pushToast({theme: "error", message: "You need list-manager and badge-issuer authority for this section."})
      return
    }

    const applicant = normalizePubkey(application.response.event.pubkey)
    if (!applicant) return

    if (status === "granted") {
      const profileListEvent = findProfileListEvent(capability.profileList, $activeCommunityProfileListEvents)
      const events = makeCommunityGrantEvents({
        profileList: capability.profileList,
        profileListEvent,
        badge: capability.badge,
        pubkey: applicant,
      })

      publishThunk({relays: $activeCommunityRelays, event: makeEvent(events.profileList.kind, events.profileList)})
      publishThunk({relays: $activeCommunityRelays, event: makeEvent(events.badgeAward.kind, events.badgeAward)})
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
    if (!selectedSectionName && grantableSections[0]) selectedSectionName = grantableSections[0].section.name
  })

  $effect(() => {
    if ($activeCommunityRelays.length === 0) return

    const filters = [...responseFilters, ...deleteFilters, ...reviewFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Settings} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Moderation</strong>{/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  {#if !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else if !$pubkey}
    <p class="py-8 text-center opacity-70">Log in with a moderator key to manage applications.</p>
  {:else if grantableSections.length === 0}
    <p class="py-8 text-center opacity-70">This signer cannot grant any community section access.</p>
  {:else}
    <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {#each grantableSections as item}
        <button
          type="button"
          class="card2 bg-alt p-4 text-left shadow-md"
          class:border-primary={selectedSectionName === item.section.name}
          onclick={() => (selectedSectionName = item.section.name)}>
          <strong>{item.section.name}</strong>
          <p class="text-sm opacity-70">Form and review access enabled</p>
        </button>
      {/each}
    </div>

    {#if selected}
      {@const editor = getEditor(selected.section.name, activeForm)}
      <form class="card2 bg-alt col-3 flex flex-col gap-3 p-4 shadow-md" onsubmit={preventDefault(saveForm)}>
        <div>
          <strong>{activeForm ? "Replace application form" : "Create application form"}</strong>
          <p class="text-sm opacity-70">This publishes a moderator-authored NIP-101 form for {selected.section.name}.</p>
        </div>
        <Field>
          {#snippet label()}<p>Identifier</p>{/snippet}
          {#snippet input()}
            <input class="input input-bordered w-full" value={editor.identifier} oninput={event => updateEditor(selected.section.name, {identifier: event.currentTarget.value})} />
          {/snippet}
        </Field>
        <Field>
          {#snippet label()}<p>Name</p>{/snippet}
          {#snippet input()}
            <input class="input input-bordered w-full" value={editor.name} oninput={event => updateEditor(selected.section.name, {name: event.currentTarget.value})} />
          {/snippet}
        </Field>
        <Field>
          {#snippet label()}<p>Description</p>{/snippet}
          {#snippet input()}
            <textarea class="textarea textarea-bordered w-full" value={editor.description} oninput={event => updateEditor(selected.section.name, {description: event.currentTarget.value})}></textarea>
          {/snippet}
        </Field>
        <Field>
          {#snippet label()}<p>Fields</p>{/snippet}
          {#snippet input()}
            <textarea class="textarea textarea-bordered min-h-36 w-full" value={editor.questions} oninput={event => updateEditor(selected.section.name, {questions: event.currentTarget.value})}></textarea>
            <span class="text-xs opacity-60">
              One field per line. Use "text: Question", "label: Instructions", or "option: Question | yes=Yes, no=No".
            </span>
          {/snippet}
        </Field>
        <div class="flex justify-end">
          <Button type="submit" class="btn btn-primary">Publish form</Button>
        </div>
      </form>
    {/if}

    <section class="card2 bg-alt col-4 flex flex-col gap-4 p-4 shadow-md">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-xl font-semibold">Review queue</h2>
          {#if newApplications.length > 0}
            <span class="badge badge-warning">{newApplications.length} new</span>
          {/if}
        </div>
        <p class="text-sm opacity-70">New applications are shown first, followed by granted and rejected submissions.</p>
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
                  <strong>{application.sectionName}</strong>
                  <p class="truncate text-xs opacity-70">
                    Applicant: <ProfileLink pubkey={application.response.event.pubkey} />
                  </p>
                  <p class="text-xs opacity-70">Submitted {new Date(application.response.event.created_at * 1000).toLocaleString()}</p>
                </div>
                <span class="badge">{application.state.status}</span>
              </div>

              {#if application.response.responses[0]}
                <div class="mt-3 rounded-box bg-base-200 p-2 text-sm">
                  <strong>{application.form.fields[application.response.responses[0].fieldId]?.label || application.response.responses[0].fieldId}</strong>
                  <p class="line-clamp-3 whitespace-pre-wrap opacity-80">{application.response.responses[0].value}</p>
                </div>
              {/if}

              <details class="mt-3">
                <summary class="cursor-pointer text-sm font-medium">Review full response</summary>
                <div class="mt-2 grid gap-2">
                  {#each application.response.responses as response}
                  <div class="rounded-box bg-base-200 p-2 text-sm">
                    <strong>{application.form.fields[response.fieldId]?.label || response.fieldId}</strong>
                    <p class="whitespace-pre-wrap opacity-80">{response.value}</p>
                  </div>
                  {/each}
                </div>
              </details>

              <div class="mt-3 flex justify-end gap-2">
                <Button class="btn btn-error btn-sm" disabled={application.state.status === "rejected"} onclick={() => reviewApplication(application, "rejected")}>Reject</Button>
                <Button class="btn btn-success btn-sm" disabled={application.state.status === "granted"} onclick={() => reviewApplication(application, "granted")}>Grant</Button>
              </div>
            </article>
          {:else}
            <p class="rounded-box bg-base-200 p-3 text-sm opacity-70">No {group.label.toLowerCase()} applications.</p>
          {/each}
        </div>
      {/each}
    </section>
  {/if}
</PageContent>
