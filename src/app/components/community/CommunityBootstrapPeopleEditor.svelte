<script lang="ts">
  import {tick} from "svelte"
  import {writable} from "svelte/store"
  import * as nip19 from "nostr-tools/nip19"
  import type {TrustedEvent} from "@welshman/util"
  import type {Instance} from "tippy.js"
  import {profileSearch} from "@welshman/app"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import Suggestions from "@lib/components/Suggestions.svelte"
  import Tippy from "@lib/components/Tippy.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import ProfileSuggestion from "@app/editor/ProfileSuggestion.svelte"
  import {pushToast} from "@app/util/toast"
  import {activeCommunityReportState, hydratePubkeyProfiles} from "@app/core/community-state"
  import {
    getProfileListPubkeys,
    normalizePubkey,
    type CommunityDefinition,
    type CommunityProfileListRef,
  } from "@app/core/community"
  import {
    findCommunityProfileListEvent,
    type CommunityBootstrapGrantDraft,
    type CommunityBootstrapGrantRole,
  } from "@app/core/community-admin"
  import {
    selectCommunityMemberList,
    type CommunityMemberListItem,
  } from "@app/core/community-membership"

  type SectionOption = {
    name: string
    displayName: string
    profileLists: CommunityProfileListRef[]
  }

  type Props = {
    definition: CommunityDefinition
    sections: SectionOption[]
    profileListEvents?: TrustedEvent[]
    relays?: string[]
    draftGrants: CommunityBootstrapGrantDraft[]
    disabled?: boolean
  }

  let {
    definition,
    sections,
    profileListEvents = [],
    relays = [],
    draftGrants = $bindable(),
    disabled = false,
  }: Props = $props()

  let selectedPubkey = $state("")
  let peopleSearchTerm = $state("")
  let selectedRole = $state<CommunityBootstrapGrantRole>("member")
  let selectedSectionNames = $state<string[]>([])
  let grantPickerOpen = $state(false)
  let grantPickerSelection = $state<string[]>([])
  let openPopover = $state<string | null>(null)
  let peopleInput: Element | undefined = $state()
  let personGrantEditor: HTMLElement | undefined = $state()
  let addPersonButton: HTMLButtonElement | undefined = $state()
  let peoplePopover: Instance | undefined = $state()
  let peopleSuggestions: any = $state()
  const peopleSearchStore = writable("")
  const normalizedSelectedPubkey = $derived(normalizePubkey(selectedPubkey))
  const sectionNames = $derived(sections.map(section => section.name))
  const sectionsByName = $derived(new Map(sections.map(section => [section.name, section])))
  const memberItems = $derived(
    selectCommunityMemberList({
      definition,
      profileListEvents,
      reportState: $activeCommunityReportState,
    }),
  )
  const moderatorCount = $derived(memberItems.filter(member => member.isModerator).length)
  const pendingModeratorCount = $derived(
    memberItems.filter(member => member.isPendingModerator).length,
  )
  const draftPubkeys = $derived(Array.from(new Set(draftGrants.map(grant => grant.pubkey))))
  const existingGroupPubkeys = $derived(memberItems.map(member => member.pubkey))
  let profileHydrationKey = ""

  const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
    `${count} ${count === 1 ? singular : plural}`

  const getSectionDisplayName = (sectionName: string) =>
    sectionsByName.get(sectionName)?.displayName || sectionName

  const encodeNpub = (pubkey: string) => {
    try {
      return nip19.npubEncode(pubkey)
    } catch {
      return pubkey
    }
  }

  const getMemberPopoverKey = (
    member: CommunityMemberListItem,
    type: "grants" | "moderators" | "pending-moderators",
  ) => `${member.pubkey}:${type}`

  const getDraftPopoverKey = (grant: CommunityBootstrapGrantDraft) =>
    `draft:${grant.pubkey}:${grant.role}`

  const showPopover = (key: string) => {
    openPopover = key
  }

  const isExistingGroupPubkey = (pubkey: string) =>
    existingGroupPubkeys.includes(normalizePubkey(pubkey))

  const rejectExistingPerson = () => {
    selectedPubkey = ""
    peopleSearchTerm = ""
    selectedSectionNames = []
    peoplePopover?.hide()
    pushToast({theme: "warning", message: "Already on the list."})
  }

  const selectPerson = (pubkey: string) => {
    const normalized = normalizePubkey(pubkey)
    if (!normalized) return

    if (isExistingGroupPubkey(normalized)) {
      rejectExistingPerson()
      return
    }

    selectedPubkey = normalized
    peopleSearchTerm = encodeNpub(normalized)
    selectedSectionNames = []
    grantPickerOpen = false
    grantPickerSelection = []
    peoplePopover?.hide()
  }

  const searchPeople = (term: string) => {
    const query = term.trim()
    if (!query) return []

    const typedPubkey = normalizePubkey(query)
    const matches = $profileSearch.searchValues(query) as string[]

    return Array.from(new Set([typedPubkey, ...matches].map(normalizePubkey).filter(Boolean)))
  }

  const onPeopleKeyDown = (event: Event) => {
    if (peopleSuggestions?.onKeyDown(event)) event.preventDefault()
  }

  const getExistingMemberSections = (pubkey: string) => {
    const normalized = normalizePubkey(pubkey)
    const names = new Set<string>()
    if (!normalized) return names

    for (const section of sections) {
      for (const profileList of section.profileLists) {
        const event = findCommunityProfileListEvent(profileList, profileListEvents)
        if (getProfileListPubkeys(event).includes(normalized)) names.add(section.name)
      }
    }

    return names
  }

  const getExistingModeratorSections = (pubkey: string) => {
    const normalized = normalizePubkey(pubkey)
    const names = new Set<string>()
    if (!normalized) return names

    for (const section of sections) {
      if (section.profileLists.some(ref => normalizePubkey(ref.pubkey) === normalized)) {
        names.add(section.name)
      }
    }

    return names
  }

  const getDraftSections = (pubkey: string, role: CommunityBootstrapGrantRole) => {
    const normalized = normalizePubkey(pubkey)
    const names = new Set<string>()
    if (!normalized) return names

    for (const grant of draftGrants) {
      if (normalizePubkey(grant.pubkey) !== normalized || grant.role !== role) continue
      for (const sectionName of grant.sectionNames) names.add(sectionName)
    }

    return names
  }

  const getUnavailableSections = (pubkey: string, role: CommunityBootstrapGrantRole) => {
    const existing =
      role === "moderator"
        ? getExistingModeratorSections(pubkey)
        : getExistingMemberSections(pubkey)
    const draft = getDraftSections(pubkey, role)

    return new Set([...existing, ...draft])
  }

  const openGrantPicker = () => {
    if (!normalizedSelectedPubkey) {
      pushToast({theme: "error", message: "Select a person first."})
      return
    }

    grantPickerSelection = [...selectedSectionNames]
    grantPickerOpen = true
  }

  const closeGrantPicker = () => {
    grantPickerOpen = false
    grantPickerSelection = []
  }

  const toggleGrantPickerSection = (sectionName: string, checked: boolean) => {
    const unavailable = getUnavailableSections(normalizedSelectedPubkey, selectedRole)
    if (unavailable.has(sectionName) && !selectedSectionNames.includes(sectionName)) return

    const next = new Set(grantPickerSelection)
    if (checked) next.add(sectionName)
    else next.delete(sectionName)

    grantPickerSelection = sectionNames.filter(sectionName => next.has(sectionName))
  }

  const saveGrantPicker = async () => {
    selectedSectionNames = [...grantPickerSelection]
    closeGrantPicker()

    await tick()

    personGrantEditor?.scrollIntoView({behavior: "smooth", block: "start"})
    addPersonButton?.focus({preventScroll: true})
  }

  const addDraftGrant = () => {
    if (!normalizedSelectedPubkey) {
      pushToast({theme: "error", message: "Select a person first."})
      return
    }

    const unavailable = getUnavailableSections(normalizedSelectedPubkey, selectedRole)
    const sectionNamesToAdd = sectionNames.filter(
      sectionName => selectedSectionNames.includes(sectionName) && !unavailable.has(sectionName),
    )

    if (sectionNamesToAdd.length === 0) {
      pushToast({theme: "error", message: "Select at least one new section grant."})
      return
    }

    let merged = false
    draftGrants = draftGrants.map(grant => {
      if (
        normalizePubkey(grant.pubkey) !== normalizedSelectedPubkey ||
        grant.role !== selectedRole
      ) {
        return grant
      }

      merged = true
      return {
        ...grant,
        sectionNames: sectionNames.filter(sectionName =>
          new Set([...grant.sectionNames, ...sectionNamesToAdd]).has(sectionName),
        ),
      }
    })

    if (!merged) {
      draftGrants = [
        {
          pubkey: normalizedSelectedPubkey,
          role: selectedRole,
          sectionNames: sectionNamesToAdd,
        },
        ...draftGrants,
      ]
    }

    selectedPubkey = ""
    peopleSearchTerm = ""
    selectedSectionNames = []
    grantPickerOpen = false
    grantPickerSelection = []
    pushToast({message: "Draft grant added. Use Update to publish it."})
  }

  const removeDraftGrant = (grant: CommunityBootstrapGrantDraft) => {
    draftGrants = draftGrants.filter(
      item => !(item.pubkey === grant.pubkey && item.role === grant.role),
    )
  }

  const clearSelectedPerson = () => {
    selectedPubkey = ""
    peopleSearchTerm = ""
    selectedSectionNames = []
    grantPickerOpen = false
    grantPickerSelection = []
  }

  $effect(() => {
    const pubkeys = Array.from(
      new Set([
        ...memberItems.map(member => member.pubkey),
        ...draftPubkeys,
        ...(normalizedSelectedPubkey ? [normalizedSelectedPubkey] : []),
      ]),
    )
    const key = `${relays.join(",")}:${pubkeys.join(",")}`
    if (pubkeys.length === 0 || key === profileHydrationKey) return

    profileHydrationKey = key
    hydratePubkeyProfiles({pubkeys, relayHints: relays}).catch(error => {
      console.warn("[community-admin] Failed to hydrate bootstrap people profiles", error)
    })
  })

  $effect(() => {
    peopleSearchStore.set(peopleSearchTerm)

    const typedPubkey = normalizePubkey(peopleSearchTerm)
    if (!typedPubkey || typedPubkey === normalizedSelectedPubkey) return

    selectPerson(typedPubkey)
  })

  $effect(() => {
    if (peopleSearchTerm && !normalizedSelectedPubkey) peoplePopover?.show()
    else peoplePopover?.hide()
  })
</script>

<section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
  <div class="mb-5 flex flex-wrap items-start justify-between gap-3">
    <div>
      <strong class="text-lg">Members and moderators</strong>
      <p class="mt-1 text-sm opacity-65">
        Add brand-new people during bootstrapping. Draft grants publish when you press Update.
      </p>
    </div>
    <div class="flex flex-wrap gap-2">
      <span class="badge badge-neutral">{pluralize(memberItems.length, "person", "people")}</span>
      <span class="badge badge-info">{pluralize(moderatorCount, "moderator")}</span>
      {#if pendingModeratorCount > 0}
        <span class="badge badge-warning">
          {pluralize(pendingModeratorCount, "pending moderator")}
        </span>
      {/if}
      {#if draftGrants.length > 0}
        <span class="badge badge-warning">{pluralize(draftGrants.length, "draft")}</span>
      {/if}
    </div>
  </div>

  <div
    class="scroll-mt-24 rounded-2xl border border-dashed border-base-300 bg-base-200/50 p-4"
    bind:this={personGrantEditor}>
    {#if normalizedSelectedPubkey}
      <div
        class="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-box border border-base-300 bg-base-100 p-3">
        <div class="flex min-w-0 items-center gap-3">
          <ProfileCircle pubkey={normalizedSelectedPubkey} {relays} size={8} />
          <div class="min-w-0">
            <p class="text-xs font-medium uppercase tracking-wide opacity-60">Selected person</p>
            <strong class="block min-w-0 truncate">
              <ProfileLink pubkey={normalizedSelectedPubkey} {relays} />
            </strong>
          </div>
        </div>
        <button class="btn btn-ghost btn-sm" type="button" onclick={clearSelectedPerson} {disabled}>
          Clear
        </button>
      </div>
    {/if}

    <div class="grid gap-3 lg:grid-cols-[minmax(0,1fr)_160px_auto_auto] lg:items-end">
      <div class="grid min-w-0 grid-rows-[1.25rem_3.5rem] gap-2">
        <span class="flex h-5 items-center text-sm font-medium">Person</span>
        <label
          class="input input-bordered flex h-14 min-h-14 w-full min-w-0 items-center gap-2"
          bind:this={peopleInput}>
          <Icon icon={Magnifier} />
          <input
            class="min-w-0 grow"
            type="text"
            placeholder="Search for profiles..."
            bind:value={peopleSearchTerm}
            readonly={Boolean(normalizedSelectedPubkey)}
            onkeydown={onPeopleKeyDown} />
        </label>
        <Tippy
          class="contents"
          bind:popover={peoplePopover}
          bind:instance={peopleSuggestions}
          component={Suggestions}
          props={{
            term: peopleSearchStore,
            search: searchPeople,
            select: selectPerson,
            component: ProfileSuggestion,
            disabledValues: existingGroupPubkeys,
            disabledLabel: "Already on the list",
            class: "rounded-box",
            style: `left: 4px; width: ${(peopleInput?.clientWidth || 0) + 12}px`,
          }}
          params={{
            trigger: "manual",
            interactive: true,
            maxWidth: "none",
            getReferenceClientRect: () => peopleInput!.getBoundingClientRect(),
          }} />
      </div>
      <label class="grid w-full grid-rows-[1.25rem_3.5rem] gap-2">
        <span class="flex h-5 items-center text-sm font-medium">Role</span>
        <select
          class="select select-bordered h-14 min-h-14 w-full"
          bind:value={selectedRole}
          {disabled}>
          <option value="member">Member</option>
          <option value="moderator">Moderator</option>
        </select>
      </label>
      <div class="flex items-end">
        <button
          type="button"
          class="btn btn-neutral h-14 min-h-14 w-full justify-center"
          onclick={openGrantPicker}
          disabled={disabled || !normalizedSelectedPubkey}>
          Add grant
        </button>
      </div>
      <div class="flex items-end">
        <button
          bind:this={addPersonButton}
          type="button"
          class="btn btn-primary h-14 min-h-14 w-full justify-center"
          onclick={addDraftGrant}
          disabled={disabled || !normalizedSelectedPubkey || selectedSectionNames.length === 0}>
          Add person
        </button>
      </div>
    </div>

    {#if selectedSectionNames.length > 0}
      <div class="mt-3 flex flex-wrap gap-2">
        {#each selectedSectionNames as sectionName (sectionName)}
          <span class="badge badge-neutral">{getSectionDisplayName(sectionName)}</span>
        {/each}
      </div>
    {/if}

    {#if grantPickerOpen}
      {@const unavailableSections = getUnavailableSections(normalizedSelectedPubkey, selectedRole)}
      {@const pickerSelection = new Set(grantPickerSelection)}
      <div class="mt-4 rounded-2xl border border-base-300 bg-base-100 p-4">
        <div class="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <strong>
              {selectedRole === "moderator" ? "Select moderator sections" : "Select member grants"}
            </strong>
            <p class="mt-1 text-sm opacity-70">
              {selectedRole === "moderator"
                ? "Sections where this person should be invited to moderate."
                : "Sections where this person should receive publishing access."}
            </p>
          </div>
          <button class="btn btn-ghost btn-sm" type="button" onclick={closeGrantPicker}>
            Cancel
          </button>
        </div>

        <div class="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {#each sections as section (section.name)}
            {@const isAlreadyAdded = unavailableSections.has(section.name) &&
              !selectedSectionNames.includes(section.name)}
            <label
              class={`flex items-start gap-3 rounded-box border border-base-300 bg-base-200/50 p-3 ${isAlreadyAdded ? "opacity-60" : "cursor-pointer hover:border-primary/60"}`}>
              <input
                type="checkbox"
                class="checkbox-primary checkbox mt-1"
                checked={pickerSelection.has(section.name) || isAlreadyAdded}
                disabled={isAlreadyAdded}
                onchange={event =>
                  toggleGrantPickerSection(section.name, event.currentTarget.checked)} />
              <span class="min-w-0">
                <strong class="block">{section.displayName}</strong>
                {#if isAlreadyAdded}
                  <span class="text-xs opacity-70">Already added</span>
                {/if}
              </span>
            </label>
          {/each}
        </div>

        <div class="mt-4 flex justify-end">
          <button
            class="btn btn-primary"
            type="button"
            disabled={grantPickerSelection.length === 0}
            onclick={saveGrantPicker}>
            Save grants
          </button>
        </div>
      </div>
    {/if}
  </div>

  <div class="mt-4 flex flex-col gap-2">
    {#each draftGrants as grant (getDraftPopoverKey(grant))}
      {@const draftKey = getDraftPopoverKey(grant)}
      <article class="rounded-box border border-warning/70 bg-warning/10 p-3 sm:p-4">
        <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
          <div class="flex min-w-0 items-start gap-3">
            <ProfileCircle pubkey={grant.pubkey} {relays} size={9} />
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <strong class="min-w-0"><ProfileLink pubkey={grant.pubkey} {relays} /></strong>
                <span class="badge badge-warning">draft</span>
                <span
                  class={`badge ${grant.role === "moderator" ? "badge-info" : "badge-neutral"}`}>
                  {grant.role}
                </span>
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 sm:justify-end">
            <div class="relative">
              <Button
                class={`btn btn-sm ${grant.role === "moderator" ? "btn-info" : "btn-neutral"}`}
                aria-expanded={openPopover === draftKey}
                onclick={() => showPopover(draftKey)}>
                {pluralize(
                  grant.sectionNames.length,
                  grant.role === "moderator" ? "moderator section" : "grant",
                )}
              </Button>
              {#if openPopover === draftKey}
                <InlinePopover
                  align="right"
                  widthClass="w-80 sm:w-96"
                  onClose={() => (openPopover = null)}>
                  <div class="flex flex-col gap-3 text-sm">
                    <div>
                      <h3 class="font-semibold">
                        {grant.role === "moderator"
                          ? "Draft moderator sections"
                          : "Draft section grants"}
                      </h3>
                      <p class="text-xs opacity-70">These changes publish with Update.</p>
                    </div>
                    {#each grant.sectionNames as sectionName (sectionName)}
                      <div class="rounded-box bg-base-200 p-3">
                        <strong>{getSectionDisplayName(sectionName)}</strong>
                      </div>
                    {/each}
                  </div>
                </InlinePopover>
              {/if}
            </div>
            <Button class="btn btn-error btn-sm" onclick={() => removeDraftGrant(grant)} {disabled}>
              Remove draft
            </Button>
          </div>
        </div>
      </article>
    {/each}

    {#if memberItems.length > 0}
      {#each memberItems as member (member.pubkey)}
        {@const grantsKey = getMemberPopoverKey(member, "grants")}
        <article class="rounded-box border border-base-300 bg-base-100 p-3 sm:p-4">
          <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div class="flex min-w-0 items-start gap-3">
              <ProfileCircle pubkey={member.pubkey} {relays} size={9} />
              <div class="min-w-0">
                <div class="flex flex-wrap items-center gap-2">
                  <strong class="min-w-0"><ProfileLink pubkey={member.pubkey} {relays} /></strong>
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
                  {#if member.grantCount > 0}
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
                    aria-expanded={openPopover === moderatorKey}
                    onclick={() => showPopover(moderatorKey)}>
                    {pluralize(member.moderatorSectionCount, "moderator section")}
                  </Button>
                  {#if openPopover === moderatorKey}
                    <InlinePopover
                      align="right"
                      widthClass="w-80 sm:w-96"
                      onClose={() => (openPopover = null)}>
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
                                <p class="break-all font-mono text-[11px] opacity-70">{address}</p>
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
                    aria-expanded={openPopover === pendingModeratorKey}
                    onclick={() => showPopover(pendingModeratorKey)}>
                    Pending {pluralize(
                      member.pendingModeratorSectionCount,
                      "moderator section",
                    )}
                  </Button>
                  {#if openPopover === pendingModeratorKey}
                    <InlinePopover
                      align="right"
                      widthClass="w-80 sm:w-96"
                      onClose={() => (openPopover = null)}>
                      <div class="flex flex-col gap-3 text-sm">
                        <div>
                          <h3 class="font-semibold">Pending moderator sections</h3>
                          <p class="text-xs opacity-70">
                            Sections where this pubkey was invited to moderate but has not published
                            its profile list yet.
                          </p>
                        </div>
                        {#each member.pendingModeratorSections as section}
                          <div class="rounded-box bg-base-200 p-3">
                            <strong>{section.displayName}</strong>
                            <div class="mt-2 flex flex-col gap-1">
                              {#each section.profileListAddresses as address}
                                <p class="break-all font-mono text-[11px] opacity-70">{address}</p>
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
                  aria-expanded={openPopover === grantsKey}
                  onclick={() => showPopover(grantsKey)}>
                  {pluralize(member.grantCount, "grant")}
                </Button>
                {#if openPopover === grantsKey}
                  <InlinePopover
                    align="right"
                    widthClass="w-80 sm:w-96"
                    onClose={() => (openPopover = null)}>
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
                                <p class="break-all font-mono text-[11px] opacity-70">{address}</p>
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
    {:else if draftGrants.length === 0}
      <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70">
        No current members are indexed for this community yet.
      </p>
    {/if}
  </div>
</section>
