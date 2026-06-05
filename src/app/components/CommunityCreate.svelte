<script lang="ts">
  import {tick} from "svelte"
  import {browser} from "$app/environment"
  import {goto} from "$app/navigation"
  import {request} from "@welshman/net"
  import {pubkey, repository, signer as sessionSigner} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {
    DELETE,
    createProfile,
    prep,
    type EventTemplate,
    type Filter,
    type SignedEvent,
    type TrustedEvent,
  } from "@welshman/util"
  import type {ISigner} from "@welshman/signer"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Tooltip from "@lib/components/Tooltip.svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import Profile from "@app/components/Profile.svelte"
  import CommunityBootstrapPeopleEditor from "@app/components/community/CommunityBootstrapPeopleEditor.svelte"
  import CommunitySectionChangeWarning from "@app/components/community/CommunitySectionChangeWarning.svelte"
  import CommunitySectionPublishConfirm from "@app/components/community/CommunitySectionPublishConfirm.svelte"
  import {preventDefault} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityAdmissionForms,
    activeCommunityProfileListEvents,
    activeCommunityReportReviewEvents,
    activeCommunityReportState,
    clearCommunityBootstrapCache,
    communityAdminDefinitionEvents,
    loadCommunityDefinitionWithOutboxFallback,
    selectLatestCommunityDefinition,
    setActiveCommunityDefinition,
    setActiveCommunityInput,
    type CommunityProfile,
  } from "@app/core/community-state"
  import {makeCommunityPath} from "@app/util/routes"
  import {
    DEFAULT_COMMUNITY_SECTION_NAMES,
    FORM_RESPONSE_KIND,
    buildCommunityDefinition,
    getCommunitySectionKindAssignments,
    getDefaultCommunitySectionKinds,
    getCommunitySectionKindKey,
    getCommunitySectionKindLabel,
    getProfileListPubkeys,
    makeCommunityNcommunity,
    makeCommunitySetupSection,
    normalizeGeohash,
    normalizeCommunitySectionName,
    normalizePubkey,
    normalizeRelay,
    normalizeRelays,
    parseCommunityDefinition,
    type CommunityBadgeRef,
    type CommunityDefinition,
    type CommunityDefinitionSectionInput,
    type CommunityMint,
    type CommunityProfileListRef,
    type CommunityRetentionPolicy,
    type CommunitySectionKind,
  } from "@app/core/community"
  import {
    applyCommunityBootstrapGrants,
    findCommunityProfileListEvent,
    isActiveCommunityProfileListEvent,
    makeManualModeratorProfileListRef,
    makeCommunityProfileList,
    type CommunityBootstrapGrantDraft,
    type CommunityProfileListDraftUpdate,
  } from "@app/core/community-admin"
  import {getGrantCapableSectionModeratorPubkeys} from "@app/core/community-permissions"
  import {
    COMMUNITY_FORM_REVIEW_KIND,
    getAdmissionSubmissionState,
    makeAdmissionFormDraftFromForm,
    makeAdmissionFormFieldsFromDraft,
    makeAdmissionFormTemplate,
  } from "@app/core/community-forms"
  import {
    makeCommunityReportReviewLabel,
    parseCommunityReportReviewLabel,
  } from "@app/core/community-reports"
  import {getCommunityRootPublishRelays} from "@app/core/community-relays"
  import {
    getNextReplacementCreatedAt,
    publishAndVerifyCommunityEvent,
    type CommunityPublishStatusUpdate,
  } from "@app/core/community-publish"
  import {uploadFile} from "@app/core/commands"
  import type {BlossomUploadStage} from "@app/core/blossom"
  import {promptBlossomMirrorUpload} from "@app/util/blossom-mirror-prompt"

  type Mode = "create" | "edit"

  type Props = {
    mode?: Mode
    definition?: CommunityDefinition
    profile?: CommunityProfile
    embedded?: boolean
  }

  type SetupSigner = {
    pubkey: string
    signer: ISigner
  }

  type FieldErrors = Record<string, string>

  type ValidatedField =
    | "name"
    | "website"
    | "picture"
    | "primaryRelay"
    | "extraRelays"
    | "blossomServers"
    | "mints"
    | "tosRef"
    | "tosRelay"
    | "geohash"

  type SectionKindDraft = {
    kind: string
    subtype: string
  }

  type SectionDraft = {
    name: string
    kinds: SectionKindDraft[]
    profileLists: CommunityProfileListRef[]
    badges: CommunityBadgeRef[]
    retention: CommunityRetentionPolicy[]
  }

  type NewProfileList = {
    sectionName: string
    profileList: CommunityProfileListRef
  }

  type ValidatedSetup = {
    name: string
    description: string
    website: string
    picture: string
    community: SetupSigner
    relays: string[]
    primaryRelay: string
    extraRelays: string[]
    blossomServers: string[]
    mints: CommunityMint[]
    tos?: {ref: string; relay?: string}
    location: string
    geohash: string
    sections: CommunityDefinitionSectionInput[]
    newProfileLists: NewProfileList[]
    profileListUpdates: CommunityProfileListDraftUpdate[]
  }

  type OriginalDraftState = {
    name: string
    description: string
    website: string
    picture: string
    primaryRelay: string
    extraRelays: string
    blossomServers: string
    mints: string
    tosRef: string
    tosRelay: string
    location: string
    geohash: string
    sectionDrafts: SectionDraft[]
  }

  type SectionLifecycleChange =
    | {type: "rename"; oldSectionName: string; newSectionName: string}
    | {
        type: "move"
        kindKey: string
        kindLabel: string
        oldSectionName: string
        newSectionName: string
      }
    | {type: "kind-remove"; kindKey: string; kindLabel: string; oldSectionName: string}
    | {type: "remove"; oldSectionName: string}

  type SectionMigrationPair = {
    oldSectionName: string
    newSectionName: string
  }

  type SectionMigrationSummary = {
    changes: SectionLifecycleChange[]
    migrationPairs: SectionMigrationPair[]
    removedSectionNames: string[]
    migratedMemberPubkeys: string[]
    moderatorPubkeys: string[]
    formCopyCount: number
    reportReviewCopyCount: number
    pendingRequestCount: number
  }

  type MigrationArtifactPlan = {
    sections: CommunityDefinitionSectionInput[]
    profileListUpdates: CommunityProfileListDraftUpdate[]
    formTemplates: Array<EventTemplate & {kind: number}>
    reportReviewLabels: Array<EventTemplate & {kind: number}>
  }

  const {mode = "create", definition, profile, embedded = false}: Props = $props()

  const SECTION_NAME_RE = /^[A-Za-z-]{1,50}$/
  const CUSTOM_KIND_VALUE = "custom"
  const KIND_DIGITS_RE = /^\d+$/
  const SUBTYPE_RE = /^[a-z-]{0,20}$/
  const SUBTYPE_HELP =
    "Optional third value in a k tag. Use it when one event kind supports multiple sections, like 11/room, 11/threads, or 9/room-message."
  const RECOMMENDED_COMMUNITY_RELAYS = normalizeRelays([
    "wss://budabit.nostr1.com",
    "wss://nos.lol",
    "wss://relay.damus.io",
  ])
  const STRFRY_RELAY_URL = "https://github.com/hoytech/strfry"
  const BLOSSOM_SERVER_URL =
    "https://budabit.club/git/naddr1qvzqqqrhnypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qyvhwumn8ghj7emfwsh8x6rpddjhxur9v9ex2tnyd9usz9rhwden5te0wfjkccte9ehxw6t59ejx2aspr9mhxue69uhhq7tjv9kkjepwve5kzar2v9nzucm0d5qqucnvdaehxmmd94ek2unkv4eqs93a9j"
  const KNOWN_SECTION_KIND_OPTIONS = [
    {label: "Room Messages", kind: 9, subtype: "room-message"},
    {label: "Rooms", kind: 11, subtype: "room"},
    {label: "Threads", kind: 11, subtype: "threads"},
    {label: "Comments", kind: 1111},
    {label: "Reactions", kind: 7},
    {label: "Reports", kind: 1984},
    {label: "Labels", kind: 1985},
    {label: "Calendar Events", kind: 31922},
    {label: "Goals", kind: 9041},
    {label: "Repository Announcements", kind: 30617},
    {label: "Permalinks", kind: 1623},
    {label: "Widgets", kind: 30033},
  ] satisfies Array<{label: string; kind: number; subtype?: string}>

  const kindOptionValue = (kind: number, subtype = "") => `${kind}:${subtype}`
  const kindDraftOptionValue = (draft: SectionKindDraft) => {
    const match = KNOWN_SECTION_KIND_OPTIONS.find(
      option =>
        String(option.kind) === draft.kind.trim() &&
        (option.subtype || "") === draft.subtype.trim(),
    )

    return match ? kindOptionValue(match.kind, match.subtype || "") : CUSTOM_KIND_VALUE
  }

  const sectionNameField = (sectionIndex: number) => `section-${sectionIndex}-name`
  const sectionKindField = (sectionIndex: number, kindIndex: number) =>
    `section-${sectionIndex}-kind-${kindIndex}`
  const sectionSubtypeField = (sectionIndex: number, kindIndex: number) =>
    `section-${sectionIndex}-subtype-${kindIndex}`
  const sectionKindsField = (sectionIndex: number) => `section-${sectionIndex}-kinds`

  const toKindDraft = (kind: CommunitySectionKind): SectionKindDraft => ({
    kind: String(kind.kind),
    subtype: kind.subtype || "",
  })

  const makeDefaultSectionDrafts = (): SectionDraft[] =>
    DEFAULT_COMMUNITY_SECTION_NAMES.map(name => ({
      name,
      kinds: getDefaultCommunitySectionKinds(name).map(toKindDraft),
      profileLists: [],
      badges: [],
      retention: [],
    }))

  const makeSectionDraftsFromDefinition = (
    communityDefinition: CommunityDefinition,
  ): SectionDraft[] =>
    communityDefinition.sections.map(section => ({
      name: section.name,
      kinds: section.kinds.map(toKindDraft),
      profileLists: section.profileLists,
      badges: section.badges,
      retention: section.retention,
    }))

  const cloneSectionDrafts = (drafts: SectionDraft[]): SectionDraft[] =>
    drafts.map(section => ({
      name: section.name,
      kinds: section.kinds.map(kind => ({...kind})),
      profileLists: section.profileLists.map(ref => ({...ref})),
      badges: section.badges.map(ref => ({...ref})),
      retention: section.retention.map(policy => ({...policy})),
    }))

  const makeOriginalDraftState = (
    communityDefinition: CommunityDefinition,
    communityProfile?: CommunityProfile,
  ): OriginalDraftState => ({
    name: communityProfile?.display_name || communityProfile?.name || "",
    description: communityDefinition.description || communityProfile?.about || "",
    website: communityProfile?.website || "",
    picture: communityProfile?.picture || "",
    primaryRelay: communityDefinition.relays[0] || "",
    extraRelays: communityDefinition.relays.slice(1).join("\n"),
    blossomServers: communityDefinition.blossomServers.join("\n"),
    mints: communityDefinition.mints
      .map(mint => [mint.url, mint.type].filter(Boolean).join(" "))
      .join("\n"),
    tosRef: communityDefinition.tos?.ref || "",
    tosRelay: communityDefinition.tos?.relay || "",
    location: communityDefinition.location || "",
    geohash: communityDefinition.geohash || "",
    sectionDrafts: makeSectionDraftsFromDefinition(communityDefinition),
  })

  const parseSectionDraftKind = (draft: SectionKindDraft): CommunitySectionKind | undefined => {
    const kindValue = draft.kind.trim()
    const kind = Number.parseInt(kindValue, 10)
    const subtype = draft.subtype.trim()

    if (!KIND_DIGITS_RE.test(kindValue) || !Number.isInteger(kind) || kind < 0 || kind > 39999) {
      return undefined
    }
    if (!SUBTYPE_RE.test(subtype)) return undefined

    return {kind, subtype: subtype || undefined}
  }

  const makeSectionInputsFromDrafts = (drafts: SectionDraft[]) =>
    drafts.map(section => ({
      name: section.name.trim(),
      kinds: section.kinds.map(parseSectionDraftKind).filter(Boolean) as CommunitySectionKind[],
      profileLists: section.profileLists,
      badges: section.badges,
      retention: section.retention,
    }))

  const getSectionNameKey = (name: string) => normalizeCommunitySectionName(name).toLowerCase()

  const getSectionKindSignature = (section: Pick<CommunityDefinitionSectionInput, "kinds">) =>
    section.kinds
      .map(kind => getCommunitySectionKindKey(kind.kind, kind.subtype))
      .sort()
      .join("|")

  const getSectionAssignmentMap = (
    sections: Array<Pick<CommunityDefinitionSectionInput, "name" | "kinds">>,
  ) => new Map(getCommunitySectionKindAssignments(sections as any).map(item => [item.key, item]))

  const getSectionLifecycleChanges = (
    currentSections: CommunityDefinitionSectionInput[],
  ): SectionLifecycleChange[] => {
    if (!isEdit || !definition) return []

    const originalSections = definition.sections
    const originalByName = new Map(
      originalSections.map(section => [getSectionNameKey(section.name), section]),
    )
    const currentByName = new Map(
      currentSections.map(section => [getSectionNameKey(section.name), section]),
    )
    const renames: Array<{oldSectionName: string; newSectionName: string}> = []
    const usedCurrentNames = new Set<string>()

    for (const [index, originalSection] of originalSections.entries()) {
      const originalKey = getSectionNameKey(originalSection.name)
      if (currentByName.has(originalKey)) continue

      const originalSignature = getSectionKindSignature(originalSection)
      const sameIndexSection = currentSections[index]
      const sameIndexKey = sameIndexSection ? getSectionNameKey(sameIndexSection.name) : ""
      const renamedSection =
        sameIndexSection &&
        sameIndexSection.name.trim() &&
        !originalByName.has(sameIndexKey) &&
        !usedCurrentNames.has(sameIndexKey)
          ? sameIndexSection
          : currentSections.find(section => {
              const sectionKey = getSectionNameKey(section.name)

              return (
                section.name.trim() &&
                !originalByName.has(sectionKey) &&
                !usedCurrentNames.has(sectionKey) &&
                getSectionKindSignature(section) === originalSignature
              )
            })

      if (!renamedSection) continue

      const renamedKey = getSectionNameKey(renamedSection.name)
      usedCurrentNames.add(renamedKey)
      renames.push({oldSectionName: originalSection.name, newSectionName: renamedSection.name})
    }

    const renameByOldName = new Map(
      renames.map(rename => [getSectionNameKey(rename.oldSectionName), rename]),
    )
    const renamedOldNames = new Set(renameByOldName.keys())
    const changes: SectionLifecycleChange[] = renames.map(rename => ({type: "rename", ...rename}))
    const originalAssignments = getSectionAssignmentMap(originalSections)
    const currentAssignments = getSectionAssignmentMap(currentSections)
    const removedSectionKeys = new Set<string>()

    for (const originalSection of originalSections) {
      const sectionKey = getSectionNameKey(originalSection.name)
      if (currentByName.has(sectionKey) || renamedOldNames.has(sectionKey)) continue

      removedSectionKeys.add(sectionKey)
      changes.push({type: "remove", oldSectionName: originalSection.name})
    }

    for (const [kindKey, originalAssignment] of originalAssignments) {
      const currentAssignment = currentAssignments.get(kindKey)
      if (!currentAssignment) {
        if (!removedSectionKeys.has(getSectionNameKey(originalAssignment.sectionName))) {
          changes.push({
            type: "kind-remove",
            kindKey,
            kindLabel: originalAssignment.label,
            oldSectionName: originalAssignment.sectionName,
          })
        }
        continue
      }

      const originalSectionKey = getSectionNameKey(originalAssignment.sectionName)
      const currentSectionKey = getSectionNameKey(currentAssignment.sectionName)
      const rename = renameByOldName.get(originalSectionKey)

      if (rename && getSectionNameKey(rename.newSectionName) === currentSectionKey) continue
      if (originalSectionKey === currentSectionKey) continue

      changes.push({
        type: "move",
        kindKey,
        kindLabel: originalAssignment.label,
        oldSectionName: originalAssignment.sectionName,
        newSectionName: currentAssignment.sectionName,
      })
    }

    return changes
  }

  const uniqueNormalizedPubkeys = (pubkeys: string[]) =>
    Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))

  const getOriginalSection = (sectionName: string) =>
    definition?.sections.find(
      section => getSectionNameKey(section.name) === getSectionNameKey(sectionName),
    )

  const getActiveSectionMemberPubkeys = (sectionName: string) => {
    const section = getOriginalSection(sectionName)
    if (!section) return []

    return uniqueNormalizedPubkeys(
      section.profileLists.flatMap(ref =>
        getProfileListPubkeys(
          findCommunityProfileListEvent(ref, $activeCommunityProfileListEvents),
        ),
      ),
    )
  }

  const getActiveSectionModeratorPubkeys = (sectionName: string) => {
    const section = getOriginalSection(sectionName)
    if (!section || !definition) return []
    const owner = normalizePubkey(definition.pubkey)

    return uniqueNormalizedPubkeys(
      section.profileLists
        .filter(ref => normalizePubkey(ref.pubkey) !== owner)
        .filter(ref =>
          isActiveCommunityProfileListEvent(
            findCommunityProfileListEvent(ref, $activeCommunityProfileListEvents),
          ),
        )
        .map(ref => ref.pubkey),
    )
  }

  const getMigrationPairs = (changes: SectionLifecycleChange[]) => {
    const pairs = new Map<string, SectionMigrationPair>()

    for (const change of changes) {
      if (change.type === "remove" || change.type === "kind-remove") continue

      const oldSectionName = change.oldSectionName
      const newSectionName = change.newSectionName
      const key = `${getSectionNameKey(oldSectionName)}>${getSectionNameKey(newSectionName)}`

      pairs.set(key, {oldSectionName, newSectionName})
    }

    return Array.from(pairs.values())
  }

  const getDroppedSectionNames = (changes: SectionLifecycleChange[]) =>
    Array.from(
      new Set(
        changes
          .filter(
            (change): change is Extract<SectionLifecycleChange, {type: "remove"}> =>
              change.type === "remove",
          )
          .map(change => change.oldSectionName),
      ),
    )

  const getActiveAdmissionResponseEvents = () =>
    $admissionResponseEventsStore ? ($admissionResponseEventsStore as TrustedEvent[]) : []

  const getAdmissionResponseDeleteEvents = () =>
    $admissionResponseDeleteEventsStore
      ? ($admissionResponseDeleteEventsStore as TrustedEvent[])
      : []

  const getAdmissionReviewEvents = () =>
    $admissionReviewEventsStore ? ($admissionReviewEventsStore as TrustedEvent[]) : []

  const getPendingRequestCountForSection = (sectionName: string) => {
    if (!definition) return 0

    const form = $activeCommunityAdmissionForms[sectionName]
    if (!form) return 0

    const responseEvents = getActiveAdmissionResponseEvents()
    const applicantPubkeys = uniqueNormalizedPubkeys(
      responseEvents
        .filter(event => event.tags.some(tag => tag[0] === "a" && tag[1] === form.address))
        .map(event => event.pubkey || ""),
    )
    const moderatorPubkeys = getGrantCapableSectionModeratorPubkeys({
      definition,
      sectionName,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
    })

    return applicantPubkeys.filter(applicantPubkey => {
      const state = getAdmissionSubmissionState({
        responseEvents,
        deleteEvents: getAdmissionResponseDeleteEvents(),
        reviewEvents: getAdmissionReviewEvents(),
        formAddress: form.address,
        applicantPubkey,
        moderatorPubkeys,
      })

      return state.status === "pending"
    }).length
  }

  const getFormCopyCount = (pairs: SectionMigrationPair[]) => {
    const copiedDestinations = new Set<string>()

    for (const pair of pairs) {
      const destinationKey = getSectionNameKey(pair.newSectionName)
      if (copiedDestinations.has(destinationKey)) continue
      if ($activeCommunityAdmissionForms[pair.newSectionName]) continue
      if (!$activeCommunityAdmissionForms[pair.oldSectionName]) continue

      copiedDestinations.add(destinationKey)
    }

    return copiedDestinations.size
  }

  const getReportReviewCopyCount = (pairs: SectionMigrationPair[]) => {
    const destinationBySource = new Map(
      pairs.map(pair => [getSectionNameKey(pair.oldSectionName), pair.newSectionName]),
    )
    const copied = new Set<string>()

    for (const event of $activeCommunityReportReviewEvents) {
      const review = parseCommunityReportReviewLabel(event, definition?.pubkey)
      if (!review) continue

      const report = $activeCommunityReportState.eventReports.find(
        report => report.event.id === review.reportId,
      )
      const nextSectionName = report?.sectionName
        ? destinationBySource.get(getSectionNameKey(report.sectionName))
        : undefined
      if (!report || !nextSectionName) continue

      copied.add(`${review.reportId}:${getSectionNameKey(nextSectionName)}`)
    }

    return copied.size
  }

  const buildSectionMigrationSummary = (
    currentSections: CommunityDefinitionSectionInput[],
  ): SectionMigrationSummary => {
    const changes = getSectionLifecycleChanges(currentSections)
    const migrationPairs = getMigrationPairs(changes)
    const removedSectionNames = getDroppedSectionNames(changes)
    const affectedOldSectionNames = Array.from(
      new Set([...migrationPairs.map(pair => pair.oldSectionName), ...removedSectionNames]),
    )
    const owner = normalizePubkey(definition?.pubkey || "")
    const migratedMemberPubkeys = uniqueNormalizedPubkeys(
      migrationPairs.flatMap(pair => getActiveSectionMemberPubkeys(pair.oldSectionName)),
    ).filter(pubkey => pubkey !== owner)
    const moderatorPubkeys = uniqueNormalizedPubkeys(
      migrationPairs.flatMap(pair => getActiveSectionModeratorPubkeys(pair.oldSectionName)),
    )
    const pendingRequestCount = affectedOldSectionNames.reduce(
      (count, sectionName) => count + getPendingRequestCountForSection(sectionName),
      0,
    )

    return {
      changes,
      migrationPairs,
      removedSectionNames,
      migratedMemberPubkeys,
      moderatorPubkeys,
      formCopyCount: getFormCopyCount(migrationPairs),
      reportReviewCopyCount: getReportReviewCopyCount(migrationPairs),
      pendingRequestCount,
    }
  }

  const makeEmptySectionDraft = (): SectionDraft => {
    const existingNames = new Set(sectionDrafts.map(section => section.name.toLowerCase()))
    const name =
      ["Custom", "Content", "Section", "Community"].find(
        candidate => !existingNames.has(candidate.toLowerCase()),
      ) || "Custom"

    return {
      name,
      kinds: [{kind: "", subtype: ""}],
      profileLists: [],
      badges: [],
      retention: [],
    }
  }

  const splitLines = (value: string) =>
    value
      .split("\n")
      .map(line => line.trim())
      .filter(Boolean)

  const normalizeWebUrl = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) return ""

    try {
      const url = new URL(trimmed)
      return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : ""
    } catch {
      return ""
    }
  }

  const validateRelayLines = (value: string, field: string, nextErrors: FieldErrors) => {
    const relays: string[] = []

    for (const [index, line] of splitLines(value).entries()) {
      const relay = normalizeRelay(line)
      if (!relay) {
        nextErrors[field] =
          `Line ${index + 1} must be a valid relay URL, like wss://relay.example.com.`
        continue
      }

      relays.push(relay)
    }

    return relays
  }

  const validateWebUrlField = (
    value: string,
    field: string,
    label: string,
    nextErrors: FieldErrors,
  ) => {
    const trimmed = value.trim()
    if (!trimmed) return ""

    const url = normalizeWebUrl(trimmed)
    if (!url) nextErrors[field] = `${label} must be a valid http:// or https:// URL.`

    return url
  }

  const validateMints = (nextErrors: FieldErrors) => {
    const normalizedMints: CommunityMint[] = []

    for (const [index, line] of splitLines(mints).entries()) {
      const [urlValue, type, extra] = line.split(/\s+/)
      const url = normalizeWebUrl(urlValue || "")

      if (!url || extra) {
        nextErrors.mints = `Line ${index + 1} must use: https://mint.example.com optional-type.`
        continue
      }

      normalizedMints.push({url, type})
    }

    return normalizedMints
  }

  const setFieldError = (field: string, message = "") => {
    const nextErrors = {...errors}

    if (message) nextErrors[field] = message
    else delete nextErrors[field]

    errors = nextErrors
  }

  const validateTosFields = () => {
    const trimmedTosRef = tosRef.trim()
    const normalizedTosRelay = normalizeRelay(tosRelay)

    if (tosRelay.trim() && normalizedTosRelay) tosRelay = normalizedTosRelay
    setFieldError(
      "tosRelay",
      tosRelay.trim() && !normalizedTosRelay ? "Terms relay must be a valid wss:// relay URL." : "",
    )
    setFieldError(
      "tosRef",
      tosRelay.trim() && !trimmedTosRef ? "Add a terms reference or clear the terms relay." : "",
    )
  }

  const validateSectionNames = (drafts = sectionDrafts) => {
    const nextErrors = Object.fromEntries(
      Object.entries(errors).filter(([key]) => !key.match(/^section-\d+-name$/)),
    )
    const seenNames = new Map<string, number>()

    for (const [sectionIndex, section] of drafts.entries()) {
      const name = section.name.trim()
      const nameKey = name.toLowerCase()
      const field = sectionNameField(sectionIndex)

      if (!SECTION_NAME_RE.test(name)) {
        nextErrors[field] = "Use only A-Z letters and dashes, with a maximum of 50 characters."
        continue
      }

      const duplicateIndex = seenNames.get(nameKey)
      if (duplicateIndex !== undefined) {
        nextErrors[field] = "Section names must be unique."
        nextErrors[sectionNameField(duplicateIndex)] = "Section names must be unique."
        continue
      }

      seenNames.set(nameKey, sectionIndex)
    }

    errors = nextErrors
  }

  const validateSectionKinds = (drafts = sectionDrafts) => {
    const nextErrors = Object.fromEntries(
      Object.entries(errors).filter(
        ([key]) =>
          !key.match(/^section-\d+-(kind|subtype)-\d+$/) && !key.match(/^section-\d+-kinds$/),
      ),
    )
    const seenKinds = new Map<
      string,
      {sectionIndex: number; kindIndex: number; sectionName: string; label: string}
    >()

    for (const [sectionIndex, section] of drafts.entries()) {
      for (const [kindIndex, draft] of section.kinds.entries()) {
        const kindValue = draft.kind.trim()
        const kind = Number.parseInt(kindValue, 10)
        const subtype = draft.subtype.trim()
        let valid = true

        if (
          !KIND_DIGITS_RE.test(kindValue) ||
          !Number.isInteger(kind) ||
          kind < 0 ||
          kind > 39999
        ) {
          nextErrors[sectionKindField(sectionIndex, kindIndex)] =
            "Kind must be an integer between 0 and 39999."
          valid = false
        }
        if (!SUBTYPE_RE.test(subtype)) {
          nextErrors[sectionSubtypeField(sectionIndex, kindIndex)] =
            "Subtype must be lowercase letters or dashes, up to 20 characters."
          valid = false
        }

        if (!valid) continue

        const key = getCommunitySectionKindKey(kind, subtype || undefined)
        const label = getCommunitySectionKindLabel(kind, subtype || undefined)
        const previous = seenKinds.get(key)

        if (previous) {
          const message = `${label} is already assigned to ${previous.sectionName}. Move or remove the duplicate kind.`
          nextErrors[sectionKindField(sectionIndex, kindIndex)] = message
          nextErrors[sectionKindField(previous.sectionIndex, previous.kindIndex)] =
            `${label} is also assigned to ${section.name.trim() || "another section"}. Kind/subtype pairs must be unique.`
          nextErrors[sectionKindsField(sectionIndex)] =
            "Each kind/subtype pair can belong to only one section."
          nextErrors[sectionKindsField(previous.sectionIndex)] =
            "Each kind/subtype pair can belong to only one section."
          continue
        }

        seenKinds.set(key, {
          sectionIndex,
          kindIndex,
          sectionName: section.name.trim() || `section ${sectionIndex + 1}`,
          label,
        })
      }
    }

    errors = nextErrors
  }

  const validateField = (field: ValidatedField) => {
    switch (field) {
      case "name":
        setFieldError(field, name.trim() ? "" : "Community name is required.")
        break
      case "website": {
        const normalized = validateWebUrlField(website, field, "Website", {})
        if (normalized) website = normalized
        setFieldError(
          field,
          website.trim() && !normalized ? "Website must be a valid http:// or https:// URL." : "",
        )
        break
      }
      case "picture": {
        const normalized = validateWebUrlField(picture, field, "Picture URL", {})
        if (normalized) picture = normalized
        setFieldError(
          field,
          picture.trim() && !normalized
            ? "Picture URL must be a valid http:// or https:// URL."
            : "",
        )
        break
      }
      case "primaryRelay": {
        const normalized = normalizeRelay(primaryRelay)
        if (normalized) primaryRelay = normalized
        setFieldError(
          field,
          normalized ? "" : "Primary relay is required and must be a valid wss:// relay URL.",
        )
        break
      }
      case "extraRelays": {
        const nextErrors: FieldErrors = {}
        const normalized = validateRelayLines(extraRelays, field, nextErrors)
        if (!nextErrors[field]) extraRelays = normalized.join("\n")
        setFieldError(field, nextErrors[field] || "")
        break
      }
      case "blossomServers": {
        const normalized = splitLines(blossomServers)
          .map((server, index) => {
            const url = normalizeWebUrl(server)
            if (!url)
              setFieldError(field, `Line ${index + 1} must be a valid http:// or https:// URL.`)
            return url
          })
          .filter(Boolean)
        if (normalized.length === splitLines(blossomServers).length) {
          blossomServers = normalized.join("\n")
          setFieldError(field)
        }
        break
      }
      case "mints": {
        const nextErrors: FieldErrors = {}
        const normalized = validateMints(nextErrors)
        if (!nextErrors[field]) {
          mints = normalized.map(mint => [mint.url, mint.type].filter(Boolean).join(" ")).join("\n")
        }
        setFieldError(field, nextErrors[field] || "")
        break
      }
      case "tosRef":
      case "tosRelay":
        validateTosFields()
        break
      case "geohash": {
        const normalized = normalizeGeohash(geohash)
        if (normalized) geohash = normalized
        setFieldError(
          field,
          geohash.trim() && !normalized
            ? "Geohash must be lowercase base32, with optional geo: prefix."
            : "",
        )
        break
      }
    }
  }

  const fromCurrentSession = (): SetupSigner | undefined => {
    const activePubkey = $pubkey
    const activeSigner = $sessionSigner
    if (!activePubkey || !activeSigner) return undefined

    return {pubkey: activePubkey, signer: activeSigner as ISigner}
  }

  const makeBudabitCommunityUrl = (communityPubkey: string) => {
    const path = makeCommunityPath(communityPubkey)

    return browser ? new URL(path, window.location.origin).toString() : path
  }

  const redirectToExistingCommunity = (definition: CommunityDefinition) => {
    const communityInput = makeCommunityNcommunity({
      pubkey: definition.pubkey,
      relayHints: definition.relays,
    })

    setActiveCommunityDefinition(definition)
    goto(makeCommunityPath(communityInput, "admin"))
  }

  const findExistingCommunityDefinition = async (communityPubkey: string, relayHints: string[]) => {
    const localDefinition = selectLatestCommunityDefinition(
      $communityAdminDefinitionEvents,
      communityPubkey,
    )
    if (localDefinition) return localDefinition

    return loadCommunityDefinitionWithOutboxFallback(communityPubkey, {
      relayHints,
      authenticate: true,
    })
  }

  const ensureCreateAllowed = async (validated: ValidatedSetup) => {
    if (isEdit) return true

    loading = true
    publishStatus = "Checking for an existing community..."

    try {
      const existingDefinition = await findExistingCommunityDefinition(
        validated.community.pubkey,
        validated.relays,
      )

      if (!existingDefinition) return true

      errors = {
        ...errors,
        auth: "This signer already has a community. Edit it from the community menu instead.",
      }
      pushToast({
        theme: "error",
        message: "This signer already has a community. Edit it from the community menu instead.",
      })
      redirectToExistingCommunity(existingDefinition)

      return false
    } finally {
      loading = false
      publishStatus = ""
    }
  }

  const normalizeSectionDrafts = (nextErrors: FieldErrors) => {
    const sections: CommunityDefinitionSectionInput[] = []
    const seenNames = new Map<string, number>()
    const seenKinds = new Map<
      string,
      {sectionIndex: number; kindIndex: number; sectionName: string; label: string}
    >()

    if (sectionDrafts.length === 0) nextErrors.sections = "Add at least one content section."

    for (const [sectionIndex, section] of sectionDrafts.entries()) {
      const name = section.name.trim()
      const nameKey = name.toLowerCase()
      const kinds: CommunitySectionKind[] = []

      if (!SECTION_NAME_RE.test(name)) {
        nextErrors[sectionNameField(sectionIndex)] =
          "Use only A-Z letters and dashes, with a maximum of 50 characters."
      } else if (seenNames.has(nameKey)) {
        nextErrors[sectionNameField(sectionIndex)] = "Section names must be unique."
        nextErrors[sectionNameField(seenNames.get(nameKey)!)] = "Section names must be unique."
      } else {
        seenNames.set(nameKey, sectionIndex)
      }

      if (section.kinds.length === 0) {
        nextErrors[sectionKindsField(sectionIndex)] = "Add at least one event kind."
      }

      for (const [kindIndex, draft] of section.kinds.entries()) {
        const kindValue = draft.kind.trim()

        if (!KIND_DIGITS_RE.test(kindValue)) {
          nextErrors[sectionKindField(sectionIndex, kindIndex)] =
            "Kind must be an integer between 0 and 39999."
          continue
        }

        const kind = Number.parseInt(kindValue, 10)
        if (!Number.isSafeInteger(kind) || kind < 0 || kind > 39999) {
          nextErrors[sectionKindField(sectionIndex, kindIndex)] =
            "Kind must be an integer between 0 and 39999."
          continue
        }

        const subtype = draft.subtype.trim()
        if (!SUBTYPE_RE.test(subtype)) {
          nextErrors[sectionSubtypeField(sectionIndex, kindIndex)] =
            "Subtype must be lowercase letters or dashes, up to 20 characters."
          continue
        }

        const key = getCommunitySectionKindKey(kind, subtype || undefined)
        const label = getCommunitySectionKindLabel(kind, subtype || undefined)
        const previous = seenKinds.get(key)
        if (previous) {
          const message = `${label} is already assigned to ${previous.sectionName}. Move or remove the duplicate kind.`
          nextErrors[sectionKindField(sectionIndex, kindIndex)] = message
          nextErrors[sectionKindField(previous.sectionIndex, previous.kindIndex)] =
            `${label} is also assigned to ${name || "another section"}. Kind/subtype pairs must be unique.`
          nextErrors[sectionKindsField(sectionIndex)] =
            "Each kind/subtype pair can belong to only one section."
          nextErrors[sectionKindsField(previous.sectionIndex)] =
            "Each kind/subtype pair can belong to only one section."
          continue
        }

        seenKinds.set(key, {
          sectionIndex,
          kindIndex,
          sectionName: name || `section ${sectionIndex + 1}`,
          label,
        })

        kinds.push({kind, subtype: subtype || undefined})
      }

      sections.push({
        name,
        kinds,
        profileLists: section.profileLists,
        badges: section.badges,
        retention: section.retention,
      })
    }

    return sections
  }

  const ensureSectionAuthorities = ({
    sections,
    communityPubkey,
    relays,
  }: {
    sections: CommunityDefinitionSectionInput[]
    communityPubkey: string
    relays: string[]
  }) => {
    const nextSections: CommunityDefinitionSectionInput[] = []
    const newProfileLists: NewProfileList[] = []

    for (const section of sections) {
      const setup = makeCommunitySetupSection({
        communityPubkey,
        profileListPubkey: communityPubkey,
        relays,
        name: section.name,
        kinds: section.kinds,
      })
      const profileLists = [...(section.profileLists || [])]
      const badges = [...(section.badges || [])]

      if (profileLists.length === 0) {
        profileLists.push(setup.profileList)
        newProfileLists.push({sectionName: section.name, profileList: setup.profileList})
      }

      nextSections.push({...section, profileLists, badges})
    }

    return {sections: nextSections, newProfileLists}
  }

  const validateForm = (): ValidatedSetup | undefined => {
    const nextErrors: FieldErrors = {}
    const community = fromCurrentSession()
    const trimmedName = name.trim()
    const normalizedPrimaryRelay = normalizeRelay(primaryRelay)
    const normalizedExtraRelays = validateRelayLines(extraRelays, "extraRelays", nextErrors)
    const relays = normalizeRelays([normalizedPrimaryRelay, ...normalizedExtraRelays])
    const normalizedWebsite = validateWebUrlField(website, "website", "Website", nextErrors)
    const normalizedPicture = validateWebUrlField(picture, "picture", "Picture URL", nextErrors)
    const normalizedBlossomServers = splitLines(blossomServers)
      .map((server, index) => {
        const url = normalizeWebUrl(server)
        if (!url)
          nextErrors.blossomServers = `Line ${index + 1} must be a valid http:// or https:// URL.`
        return url
      })
      .filter(Boolean)
    const normalizedMints = validateMints(nextErrors)
    const trimmedTosRef = tosRef.trim()
    const normalizedTosRelay = normalizeRelay(tosRelay)
    const normalizedGeohash = normalizeGeohash(geohash)
    const normalizedSections = normalizeSectionDrafts(nextErrors)

    if (!community) nextErrors.auth = "Log in with the community signer first."
    if (isEdit && definition && community && community.pubkey !== definition.pubkey) {
      nextErrors.auth = "Only the community pubkey can publish community definition updates."
    }
    if (!trimmedName) nextErrors.name = "Community name is required."
    if (!normalizedPrimaryRelay) {
      nextErrors.primaryRelay = "Primary relay is required and must be a valid wss:// relay URL."
    }
    if (tosRelay.trim() && !normalizedTosRelay) {
      nextErrors.tosRelay = "Terms relay must be a valid wss:// relay URL."
    }
    if (tosRelay.trim() && !trimmedTosRef) {
      nextErrors.tosRef = "Add a terms reference or clear the terms relay."
    }
    if (geohash.trim() && !normalizedGeohash) {
      nextErrors.geohash = "Geohash must be lowercase base32, with optional geo: prefix."
    }

    errors = nextErrors

    if (Object.keys(nextErrors).length > 0 || !community || relays.length === 0) {
      pushToast({theme: "error", message: "Fix the highlighted fields before publishing."})
      return undefined
    }

    const authority = ensureSectionAuthorities({
      sections: normalizedSections,
      communityPubkey: community.pubkey,
      relays,
    })
    const bootstrapGrants = applyCommunityBootstrapGrants({
      sections: authority.sections,
      communityPubkey: community.pubkey,
      relays,
      profileListEvents: $activeCommunityProfileListEvents,
      grants: bootstrapGrantDrafts,
    })

    return {
      name: trimmedName,
      description: description.trim(),
      website: normalizedWebsite,
      picture: normalizedPicture,
      community,
      relays,
      primaryRelay: normalizedPrimaryRelay,
      extraRelays: normalizedExtraRelays,
      blossomServers: normalizedBlossomServers,
      mints: normalizedMints,
      tos: trimmedTosRef ? {ref: trimmedTosRef, relay: normalizedTosRelay || undefined} : undefined,
      location: location.trim(),
      geohash: normalizedGeohash,
      sections: bootstrapGrants.sections,
      newProfileLists: authority.newProfileLists,
      profileListUpdates: bootstrapGrants.profileListUpdates,
    }
  }

  const makeSignedEvent = async (
    role: SetupSigner,
    template: EventTemplate,
  ): Promise<SignedEvent> => role.signer.sign(prep(template, role.pubkey))

  const mergeProfileListUpdates = (updates: CommunityProfileListDraftUpdate[]) => {
    const byAddress = new Map<string, CommunityProfileListDraftUpdate>()

    for (const update of updates) {
      const current = byAddress.get(update.profileList.address)

      byAddress.set(update.profileList.address, {
        profileList: update.profileList,
        pubkeys: uniqueNormalizedPubkeys([...(current?.pubkeys || []), ...update.pubkeys]),
      })
    }

    return Array.from(byAddress.values())
  }

  const dedupeProfileListRefs = (refs: CommunityProfileListRef[]) =>
    Array.from(new Map(refs.map(ref => [ref.address, ref])).values())

  const applySectionMigration = (
    validated: ValidatedSetup,
    summary: SectionMigrationSummary,
  ): MigrationArtifactPlan => {
    if (!definition || summary.migrationPairs.length === 0) {
      return {
        sections: validated.sections,
        profileListUpdates: validated.profileListUpdates,
        formTemplates: [],
        reportReviewLabels: [],
      }
    }

    const owner = normalizePubkey(validated.community.pubkey)
    const sections = validated.sections.map(section => ({
      ...section,
      kinds: section.kinds.map(kind => ({...kind})),
      profileLists: [...(section.profileLists || [])],
      badges: [...(section.badges || [])],
      retention: [...(section.retention || [])],
    }))
    const profileListUpdates: CommunityProfileListDraftUpdate[] = [...validated.profileListUpdates]
    const formTemplates: MigrationArtifactPlan["formTemplates"] = []
    const reportReviewLabels: MigrationArtifactPlan["reportReviewLabels"] = []
    const sourceNamesByDestination = new Map<string, string[]>()

    for (const pair of summary.migrationPairs) {
      const destinationKey = getSectionNameKey(pair.newSectionName)

      sourceNamesByDestination.set(destinationKey, [
        ...(sourceNamesByDestination.get(destinationKey) || []),
        pair.oldSectionName,
      ])
    }

    for (const [destinationKey, sourceNames] of sourceNamesByDestination) {
      const sectionIndex = sections.findIndex(
        section => getSectionNameKey(section.name) === destinationKey,
      )
      const section = sections[sectionIndex]
      if (!section) continue

      const setup = makeCommunitySetupSection({
        communityPubkey: owner,
        profileListPubkey: owner,
        relays: validated.relays,
        name: section.name,
        kinds: section.kinds,
      })
      const sourceProfileListAddresses = new Set(
        sourceNames.flatMap(sectionName =>
          (getOriginalSection(sectionName)?.profileLists || []).map(ref => ref.address),
        ),
      )
      const moderatorRefs = uniqueNormalizedPubkeys(
        sourceNames.flatMap(getActiveSectionModeratorPubkeys),
      ).map(moderatorPubkey =>
        makeManualModeratorProfileListRef({
          moderatorPubkey,
          sectionName: section.name,
          relays: validated.relays,
        }),
      )
      const existingDestinationPubkeys = uniqueNormalizedPubkeys(
        section.profileLists.flatMap(ref =>
          getProfileListPubkeys(
            findCommunityProfileListEvent(ref, $activeCommunityProfileListEvents),
          ),
        ),
      )
      const migratedPubkeys = uniqueNormalizedPubkeys(
        sourceNames.flatMap(getActiveSectionMemberPubkeys),
      )

      sections[sectionIndex] = {
        ...section,
        profileLists: dedupeProfileListRefs([
          ...section.profileLists.filter(ref => !sourceProfileListAddresses.has(ref.address)),
          setup.profileList,
          ...moderatorRefs,
        ]),
      }
      profileListUpdates.push({
        profileList: setup.profileList,
        pubkeys: uniqueNormalizedPubkeys([
          owner,
          ...existingDestinationPubkeys,
          ...migratedPubkeys,
        ]),
      })
    }

    const copiedFormDestinations = new Set<string>()
    for (const pair of summary.migrationPairs) {
      const section = sections.find(
        section => getSectionNameKey(section.name) === getSectionNameKey(pair.newSectionName),
      )
      if (!section) continue
      const destinationKey = getSectionNameKey(section.name)
      if (copiedFormDestinations.has(destinationKey)) continue
      if ($activeCommunityAdmissionForms[section.name]) continue

      const sourceForm = $activeCommunityAdmissionForms[pair.oldSectionName]
      if (!sourceForm) continue

      const draft = makeAdmissionFormDraftFromForm({
        form: sourceForm,
        communityPubkey: owner,
        sectionName: section.name,
      })

      copiedFormDestinations.add(destinationKey)
      formTemplates.push(
        makeAdmissionFormTemplate({
          identifier: draft.identifier,
          communityPubkey: owner,
          sectionName: section.name,
          name: draft.name,
          description: draft.description,
          relays: validated.relays,
          fields: makeAdmissionFormFieldsFromDraft(draft),
        }),
      )
    }

    const destinationBySource = new Map(
      summary.migrationPairs.map(pair => [
        getSectionNameKey(pair.oldSectionName),
        pair.newSectionName,
      ]),
    )
    const copiedReportReviews = new Set<string>()

    for (const event of $activeCommunityReportReviewEvents) {
      const review = parseCommunityReportReviewLabel(event, owner)
      if (!review) continue

      const report = $activeCommunityReportState.eventReports.find(
        report => report.event.id === review.reportId,
      )
      const nextSectionName = report?.sectionName
        ? destinationBySource.get(getSectionNameKey(report.sectionName))
        : undefined
      if (!report || !nextSectionName) continue

      const key = `${review.reportId}:${getSectionNameKey(nextSectionName)}`
      if (copiedReportReviews.has(key)) continue

      copiedReportReviews.add(key)
      reportReviewLabels.push(
        makeCommunityReportReviewLabel({
          communityPubkey: owner,
          reportId: review.reportId,
          targetEventId: review.targetEventId || report.targetEventId || "",
          targetEventKind: review.targetEventKind || report.targetEventKind,
          sectionName: nextSectionName,
          reporterPubkey: report.reporterPubkey,
          content: event.content || "",
        }),
      )
    }

    return {
      sections,
      profileListUpdates: mergeProfileListUpdates(profileListUpdates),
      formTemplates,
      reportReviewLabels,
    }
  }

  const makeChangeSummaryItems = (summary: SectionMigrationSummary) =>
    summary.changes.map(change => {
      if (change.type === "rename") {
        return `${change.oldSectionName} renamed to ${change.newSectionName}`
      }
      if (change.type === "move") {
        return `${change.kindLabel} moved from ${change.oldSectionName} to ${change.newSectionName}`
      }
      if (change.type === "kind-remove") {
        return `${change.kindLabel} removed from ${change.oldSectionName}`
      }

      return `${change.oldSectionName} section removed`
    })

  const makeMigrationSummaryItems = (summary: SectionMigrationSummary) => {
    const items: string[] = []

    if (summary.migratedMemberPubkeys.length > 0) {
      items.push(
        `${summary.migratedMemberPubkeys.length} granted member${summary.migratedMemberPubkeys.length === 1 ? "" : "s"} will be migrated`,
      )
    }
    if (summary.moderatorPubkeys.length > 0) {
      items.push(
        `${summary.moderatorPubkeys.length} moderator${summary.moderatorPubkeys.length === 1 ? "" : "s"} will need to accept new permissions`,
      )
    }
    if (summary.formCopyCount > 0) {
      items.push(
        `${summary.formCopyCount} application form${summary.formCopyCount === 1 ? "" : "s"} will be copied to the new section`,
      )
    }
    if (summary.reportReviewCopyCount > 0) {
      items.push(
        `${summary.reportReviewCopyCount} reviewed report decision${summary.reportReviewCopyCount === 1 ? "" : "s"} will be preserved`,
      )
    }
    if (items.length > 0) {
      items.push(
        "Permission migration updates will be published and verified before the community update",
      )
    }

    return items
  }

  const makeDropSummaryItems = (summary: SectionMigrationSummary) => {
    const items: string[] = []

    if (summary.pendingRequestCount > 0) {
      items.push(
        `${summary.pendingRequestCount} pending request${summary.pendingRequestCount === 1 ? "" : "s"} will be dropped`,
      )
    }
    if (summary.removedSectionNames.length > 0) {
      items.push("Removed sections will lose their old publishing permissions")
    }
    if (summary.changes.some(change => change.type === "kind-remove")) {
      items.push("Removed publish types will lose their old publishing permissions")
    }
    if (summary.changes.length > 0) {
      items.push("Applicant submissions and user reports will not be copied or impersonated")
    }

    return items
  }

  const makePublishSummarySections = (summary: SectionMigrationSummary) => [
    {title: "Permission changes", items: makeChangeSummaryItems(summary), tone: "warning" as const},
    {title: "Migration", items: makeMigrationSummaryItems(summary), tone: "success" as const},
    {title: "Not migrated", items: makeDropSummaryItems(summary), tone: "info" as const},
  ]

  const publishMigrationEvents = async (
    events: SignedEvent[],
    relays: string[],
    requiredRelay: string,
    setStatus: CommunityPublishStatusUpdate,
  ) => {
    const verifiedEvents: TrustedEvent[] = []

    for (const [index, event] of events.entries()) {
      verifiedEvents.push(
        await publishAndVerifyCommunityEvent({
          event,
          relays,
          requiredRelay,
          label: `migration update ${index + 1} of ${events.length}`,
          setStatus,
        }),
      )
    }

    return verifiedEvents
  }

  const performCommunitySettingsPublish = async ({
    validated,
    migrate,
    summary,
    setStatus = () => undefined,
  }: {
    validated: ValidatedSetup
    migrate: boolean
    summary: SectionMigrationSummary
    setStatus?: CommunityPublishStatusUpdate
  }) => {
    loading = true
    publishStatus = ""

    const reportStatus: CommunityPublishStatusUpdate = message => {
      publishStatus = message
      setStatus(message)
    }

    try {
      const migration = migrate
        ? applySectionMigration(validated, summary)
        : {
            sections: validated.sections,
            profileListUpdates: validated.profileListUpdates,
            formTemplates: [],
            reportReviewLabels: [],
          }
      const createdAt = getNextReplacementCreatedAt([])
      const communityProfile = {
        ...createProfile({
          name: validated.name,
          display_name: validated.name,
          about: validated.description,
          website: validated.website,
          picture: validated.picture,
        }),
        created_at: createdAt,
      }
      const communityDefinition = {
        ...buildCommunityDefinition({
          relays: validated.relays,
          sections: migration.sections,
          description: validated.description,
          blossomServers: validated.blossomServers,
          mints: validated.mints,
          tos: validated.tos,
          location: validated.location,
          geohash: validated.geohash,
        }),
        created_at: getNextReplacementCreatedAt([definition?.event], createdAt),
      }
      const profileListUpdates = mergeProfileListUpdates(migration.profileListUpdates)
      const updatedProfileListAddresses = new Set(
        profileListUpdates.map(update => update.profileList.address),
      )
      const profileLists = [
        ...profileListUpdates.map(update => {
          const currentEvent = findCommunityProfileListEvent(
            update.profileList,
            $activeCommunityProfileListEvents,
          )

          return {
            ...makeCommunityProfileList({profileList: update.profileList, pubkeys: update.pubkeys}),
            created_at: getNextReplacementCreatedAt([currentEvent], createdAt),
          }
        }),
        ...validated.newProfileLists
          .filter(({profileList}) => !updatedProfileListAddresses.has(profileList.address))
          .map(({profileList}) => {
            const currentEvent = findCommunityProfileListEvent(
              profileList,
              $activeCommunityProfileListEvents,
            )

            return {
              ...makeCommunityProfileList({profileList, pubkeys: [validated.community.pubkey]}),
              created_at: getNextReplacementCreatedAt([currentEvent], createdAt),
            }
          }),
      ]
      const signedCommunityProfile = await makeSignedEvent(validated.community, communityProfile)
      const signedDefinition = await makeSignedEvent(validated.community, communityDefinition)
      const signedProfileLists = await Promise.all(
        profileLists.map(template => makeSignedEvent(validated.community, template)),
      )
      const signedMigrationEvents = migrate
        ? await Promise.all(
            [...migration.formTemplates, ...migration.reportReviewLabels].map(template =>
              makeSignedEvent(validated.community, template),
            ),
          )
        : []
      const rootRelays = getCommunityRootPublishRelays(validated.relays, validated.community.pubkey)
      const preDefinitionEvents = migrate ? [...signedProfileLists, ...signedMigrationEvents] : []
      const postDefinitionEvents = migrate ? [] : signedProfileLists
      const verifiedEvents: TrustedEvent[] = []

      if (preDefinitionEvents.length > 0) {
        verifiedEvents.push(
          ...(await publishMigrationEvents(
            preDefinitionEvents,
            validated.relays,
            validated.primaryRelay,
            reportStatus,
          )),
        )
      }

      verifiedEvents.push(
        await publishAndVerifyCommunityEvent({
          event: signedCommunityProfile,
          relays: rootRelays,
          requiredRelay: validated.primaryRelay,
          label: "community profile",
          setStatus: reportStatus,
        }),
      )
      verifiedEvents.push(
        await publishAndVerifyCommunityEvent({
          event: signedDefinition,
          relays: rootRelays,
          requiredRelay: validated.primaryRelay,
          label: "community definition",
          setStatus: reportStatus,
        }),
      )

      for (const [index, event] of postDefinitionEvents.entries()) {
        verifiedEvents.push(
          await publishAndVerifyCommunityEvent({
            event,
            relays: validated.relays,
            requiredRelay: validated.primaryRelay,
            label: `member list update ${index + 1} of ${postDefinitionEvents.length}`,
            setStatus: reportStatus,
          }),
        )
      }

      for (const event of verifiedEvents) repository.publish(event)

      const communityInput = makeCommunityNcommunity({
        pubkey: validated.community.pubkey,
        relayHints: validated.relays,
      })
      clearCommunityBootstrapCache(validated.community.pubkey)
      setActiveCommunityInput(communityInput)
      const parsedDefinition = parseCommunityDefinition(signedDefinition)
      if (parsedDefinition) setActiveCommunityDefinition(parsedDefinition)
      bootstrapGrantDrafts = []
      keptImmediateWarningKeys = []
      if (parsedDefinition) {
        originalDraftState = makeOriginalDraftState(parsedDefinition, {
          name: validated.name,
          display_name: validated.name,
          about: validated.description,
          website: validated.website,
          picture: validated.picture,
        })
      }

      reportStatus(
        isEdit ? "Community update verified on relay." : "Community creation verified on relay.",
      )
      pushToast({
        theme: "success",
        message: isEdit ? "Community settings updated." : "Community created.",
      })
      if (!isEdit) goto(makeCommunityPath(validated.community.pubkey))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      publishStatus = message
      pushToast({theme: "error", message: `Community setup failed: ${message}`})
      throw error
    } finally {
      loading = false
    }
  }

  const cancel = () =>
    goto(isEdit && definition ? makeCommunityPath(definition.pubkey) : "/explore")

  const applyOriginalDraftState = () => {
    if (!originalDraftState) return

    name = originalDraftState.name
    description = originalDraftState.description
    website = originalDraftState.website
    picture = originalDraftState.picture
    primaryRelay = originalDraftState.primaryRelay
    extraRelays = originalDraftState.extraRelays
    blossomServers = originalDraftState.blossomServers
    mints = originalDraftState.mints
    tosRef = originalDraftState.tosRef
    tosRelay = originalDraftState.tosRelay
    location = originalDraftState.location
    geohash = originalDraftState.geohash
    pictureUploadStage = "idle"
    sectionDrafts = cloneSectionDrafts(originalDraftState.sectionDrafts)
    bootstrapGrantDrafts = []
    expandedSectionIndex = 0
    errors = {}
    keptImmediateWarningKeys = []
  }

  const keepImmediateWarning = (key: string) => {
    keptImmediateWarningKeys = Array.from(new Set([...keptImmediateWarningKeys, key]))
  }

  const showImmediateWarning = ({
    key,
    title,
    description,
    details,
    resetLabel,
    onReset,
  }: {
    key: string
    title: string
    description: string
    details?: string[]
    resetLabel: string
    onReset: () => void
  }) => {
    if (!isEdit || keptImmediateWarningKeys.includes(key)) return

    pushModal(CommunitySectionChangeWarning, {
      title,
      description,
      details,
      resetLabel,
      onReset,
      onKeep: () => keepImmediateWarning(key),
    })
  }

  const showDestructiveConfirm = ({
    title,
    description,
    details,
    confirmLabel,
    onConfirm,
  }: {
    title: string
    description: string
    details?: string[]
    confirmLabel: string
    onConfirm: () => void
  }) => {
    pushModal(CommunitySectionChangeWarning, {
      title,
      description,
      details,
      resetLabel: confirmLabel,
      keepLabel: "Cancel",
      onReset: onConfirm,
    })
  }

  const shouldDeferRenameWarning = (event: FocusEvent, sectionIndex: number) => {
    const target = event.relatedTarget
    if (!(target instanceof HTMLElement)) return false
    if (target.closest("button")) return true

    return Boolean(target.closest(`[data-section-accordion="${sectionIndex}"]`))
  }

  const maybeWarnSectionRename = (sectionIndex: number, event: FocusEvent) => {
    if (!definition) return
    if (shouldDeferRenameWarning(event, sectionIndex)) return

    const originalSection = definition.sections[sectionIndex]
    const draft = sectionDrafts[sectionIndex]
    if (!originalSection || !draft) return

    const originalName = originalSection.name
    const nextName = draft.name.trim()
    if (!SECTION_NAME_RE.test(nextName)) return
    if (getSectionNameKey(originalName) === getSectionNameKey(nextName)) return

    showImmediateWarning({
      key: `rename:${getSectionNameKey(originalName)}>${getSectionNameKey(nextName)}`,
      title: "Rename section?",
      description: `Renaming ${originalName} to ${nextName} changes who can publish there until permissions are migrated.`,
      details: [
        "Existing member lists are tied to the old section name.",
        "You can keep the rename and review the migration summary before publishing.",
      ],
      resetLabel: "Reset rename",
      onReset: () => {
        sectionDrafts = sectionDrafts.map((section, index) =>
          index === sectionIndex ? {...section, name: originalName} : section,
        )
        validateSectionNames()
      },
    })
  }

  const parseDraftKindKey = (draft: SectionKindDraft) => {
    const kind = parseSectionDraftKind(draft)

    return kind ? getCommunitySectionKindKey(kind.kind, kind.subtype) : ""
  }

  const getOriginalAssignmentForKindKey = (kindKey: string) =>
    kindKey ? getSectionAssignmentMap(definition?.sections || []).get(kindKey) : undefined

  const applySectionKindUpdate = (
    sectionIndex: number,
    kindIndex: number,
    update: Partial<SectionKindDraft>,
  ) => {
    const nextDrafts = sectionDrafts.map((section, index) => {
      if (index !== sectionIndex) return section

      return {
        ...section,
        kinds: section.kinds.map((kind, currentKindIndex) =>
          currentKindIndex === kindIndex ? {...kind, ...update} : kind,
        ),
      }
    })

    sectionDrafts = nextDrafts
    validateSectionKinds(nextDrafts)
  }

  const requestSectionKindUpdate = (
    sectionIndex: number,
    kindIndex: number,
    update: Partial<SectionKindDraft>,
  ) => {
    const section = sectionDrafts[sectionIndex]
    const currentDraft = section?.kinds[kindIndex]
    if (!section || !currentDraft) return

    const nextDraft = {...currentDraft, ...update}
    const currentKindKey = parseDraftKindKey(currentDraft)
    const nextKind = parseSectionDraftKind(nextDraft)
    const nextKindKey = nextKind ? getCommunitySectionKindKey(nextKind.kind, nextKind.subtype) : ""
    if (currentKindKey === nextKindKey) return

    const previousDrafts = cloneSectionDrafts(sectionDrafts)
    const currentAssignment = getOriginalAssignmentForKindKey(currentKindKey)
    const nextAssignment = getOriginalAssignmentForKindKey(nextKindKey)
    const applyUpdate = () => applySectionKindUpdate(sectionIndex, kindIndex, update)

    if (
      nextAssignment &&
      getSectionNameKey(nextAssignment.sectionName) !== getSectionNameKey(section.name)
    ) {
      applyUpdate()
      showImmediateWarning({
        key: `move:${nextKindKey}:${getSectionNameKey(nextAssignment.sectionName)}>${getSectionNameKey(section.name)}`,
        title: "Move permission?",
        description: `${nextAssignment.label} was moved from ${nextAssignment.sectionName} to ${section.name}.`,
        details: [
          "People who could publish this content before may need migrated access to the new section.",
          "Moderators for the old section will need to accept new permissions after publish.",
        ],
        resetLabel: "Reset move",
        onReset: () => {
          sectionDrafts = previousDrafts
          validateSectionKinds(sectionDrafts)
        },
      })
      return
    }

    if (currentAssignment && nextKind) {
      applyUpdate()
      showImmediateWarning({
        key: `kind-change:${currentKindKey}>${nextKindKey}:${getSectionNameKey(section.name)}`,
        title: "Change kind?",
        description: `${currentAssignment.label} was changed to ${getCommunitySectionKindLabel(nextKind.kind, nextKind.subtype)} in ${section.name}.`,
        details: [
          "The old publishing permission will be removed from this section unless you reset the change.",
          "You can keep the kind change and review the permission summary before publishing.",
        ],
        resetLabel: "Reset kind change",
        onReset: () => {
          sectionDrafts = previousDrafts
          validateSectionKinds(sectionDrafts)
        },
      })
      return
    }

    applyUpdate()
  }

  const submitCommunitySettings = async () => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in with the community signer first."})
      return
    }

    const validated = validateForm()
    if (!validated) return
    if (!(await ensureCreateAllowed(validated))) return

    name = validated.name
    description = validated.description
    website = validated.website
    picture = validated.picture
    primaryRelay = validated.primaryRelay
    extraRelays = validated.extraRelays.join("\n")
    blossomServers = validated.blossomServers.join("\n")
    mints = validated.mints.map(mint => [mint.url, mint.type].filter(Boolean).join(" ")).join("\n")
    tosRef = validated.tos?.ref || ""
    tosRelay = validated.tos?.relay || ""
    location = validated.location
    geohash = validated.geohash

    const summary = buildSectionMigrationSummary(validated.sections)
    const publishWithMode = (migrate: boolean, setStatus?: CommunityPublishStatusUpdate) =>
      performCommunitySettingsPublish({
        validated,
        migrate,
        summary,
        setStatus,
      })

    if (isEdit && summary.changes.length > 0) {
      pushModal(CommunitySectionPublishConfirm, {
        sections: makePublishSummarySections(summary),
        onPublishAndMigrate: (setStatus: CommunityPublishStatusUpdate) =>
          publishWithMode(true, setStatus),
        onPublishWithoutMigration: (setStatus: CommunityPublishStatusUpdate) =>
          publishWithMode(false, setStatus),
      })
      return
    }

    try {
      await publishWithMode(false)
    } catch {
      // performCommunitySettingsPublish already surfaced the failure to the user.
    }
  }

  const updateSection = (sectionIndex: number, update: Partial<SectionDraft>) => {
    const nextDrafts = sectionDrafts.map((section, index) =>
      index === sectionIndex ? {...section, ...update} : section,
    )

    sectionDrafts = nextDrafts
    if (update.name !== undefined) validateSectionNames(nextDrafts)
  }

  const setKnownKind = (sectionIndex: number, kindIndex: number, value: string) => {
    if (value === CUSTOM_KIND_VALUE) return

    const option = KNOWN_SECTION_KIND_OPTIONS.find(
      candidate => kindOptionValue(candidate.kind, candidate.subtype || "") === value,
    )
    if (!option) return

    requestSectionKindUpdate(sectionIndex, kindIndex, {
      kind: String(option.kind),
      subtype: option.subtype || "",
    })
    errors = Object.fromEntries(
      Object.entries(errors).filter(
        ([key]) =>
          key !== sectionKindField(sectionIndex, kindIndex) &&
          key !== sectionSubtypeField(sectionIndex, kindIndex),
      ),
    )
  }

  const scrollToSection = async (sectionIndex: number) => {
    expandedSectionIndex = sectionIndex

    await tick()

    if (!browser) return

    document
      .querySelector(`[data-section-accordion="${sectionIndex}"]`)
      ?.scrollIntoView({behavior: "smooth", block: "start"})
  }

  const toggleSectionAccordion = (sectionIndex: number) => {
    expandedSectionIndex = expandedSectionIndex === sectionIndex ? -1 : sectionIndex
  }

  const addSection = () => {
    const nextSectionIndex = sectionDrafts.length

    sectionDrafts = [...sectionDrafts, makeEmptySectionDraft()]
    scrollToSection(nextSectionIndex)
  }

  const makeRestoredDefaultSectionDrafts = () =>
    DEFAULT_COMMUNITY_SECTION_NAMES.map(name => {
      const existing = sectionDrafts.find(
        section => section.name.toLowerCase() === name.toLowerCase(),
      )

      return {
        name,
        kinds: getDefaultCommunitySectionKinds(name).map(toKindDraft),
        profileLists: existing?.profileLists || [],
        badges: existing?.badges || [],
        retention: existing?.retention || [],
      }
    })

  const applyDefaultSections = (nextDrafts = makeRestoredDefaultSectionDrafts()) => {
    sectionDrafts = nextDrafts
    errors = Object.fromEntries(
      Object.entries(errors).filter(([key]) => !key.startsWith("section-") && key !== "sections"),
    )
    expandedSectionIndex = 0
  }

  const restoreDefaultSections = () => {
    const nextDrafts = makeRestoredDefaultSectionDrafts()
    const nextSummary = buildSectionMigrationSummary(makeSectionInputsFromDrafts(nextDrafts))
    const removesExistingState = nextSummary.changes.some(
      change => change.type === "remove" || change.type === "kind-remove",
    )

    if (isEdit && removesExistingState) {
      showDestructiveConfirm({
        title: "Restore default sections?",
        description:
          "Restoring defaults will remove existing custom sections or publish types from this draft.",
        details: [
          "People with permissions for removed sections or publish types can lose publishing access after publish.",
          "This change will be listed in the final permission summary.",
        ],
        confirmLabel: "Restore defaults",
        onConfirm: () => applyDefaultSections(nextDrafts),
      })
      return
    }

    applyDefaultSections(nextDrafts)
  }

  const removeSectionAtIndex = (sectionIndex: number) => {
    const nextDrafts = sectionDrafts.filter((_, index) => index !== sectionIndex)

    sectionDrafts = nextDrafts
    expandedSectionIndex = Math.max(0, Math.min(expandedSectionIndex, nextDrafts.length - 1))
    validateSectionNames(nextDrafts)
    validateSectionKinds(nextDrafts)
  }

  const removeSection = (sectionIndex: number) => {
    const removedSection = sectionDrafts[sectionIndex]
    if (!removedSection) return

    if (removedSection && getOriginalSection(removedSection.name)) {
      showDestructiveConfirm({
        title: "Remove section?",
        description: `Remove ${removedSection.name} from this community draft?`,
        details: [
          "People with permissions for this section will lose them when the update is published.",
          "Pending requests for this section will not be migrated.",
        ],
        confirmLabel: "Remove section",
        onConfirm: () => removeSectionAtIndex(sectionIndex),
      })
      return
    }

    removeSectionAtIndex(sectionIndex)
  }

  const addKind = async (sectionIndex: number) => {
    sectionDrafts = sectionDrafts.map((section, index) =>
      index === sectionIndex
        ? {...section, kinds: [{kind: "", subtype: ""}, ...section.kinds]}
        : section,
    )

    await tick()

    if (!browser) return

    document
      .querySelector(`[data-section-kind-row="${sectionIndex}-0"]`)
      ?.scrollIntoView({behavior: "smooth", block: "center"})
  }

  const removeKindAtIndex = (sectionIndex: number, kindIndex: number) => {
    const nextDrafts = sectionDrafts.map((section, index) =>
      index === sectionIndex
        ? {
            ...section,
            kinds: section.kinds.filter((_, currentKindIndex) => currentKindIndex !== kindIndex),
          }
        : section,
    )

    sectionDrafts = nextDrafts
    validateSectionKinds(nextDrafts)
  }

  const removeKind = (sectionIndex: number, kindIndex: number) => {
    const section = sectionDrafts[sectionIndex]
    const kindDraft = section?.kinds[kindIndex]
    if (!section || !kindDraft) return

    const kindKey = parseDraftKindKey(kindDraft)
    const originalAssignment = kindKey
      ? getSectionAssignmentMap(definition?.sections || []).get(kindKey)
      : undefined

    if (originalAssignment) {
      showDestructiveConfirm({
        title: "Remove kind?",
        description: `Remove ${originalAssignment.label} from ${section.name}?`,
        details: [
          "People with permissions for this publish type will lose them when the update is published.",
          "This removal will be listed in the final permission summary.",
        ],
        confirmLabel: "Remove kind",
        onConfirm: () => removeKindAtIndex(sectionIndex, kindIndex),
      })
      return
    }

    removeKindAtIndex(sectionIndex, kindIndex)
  }

  const addRecommendedCommunityRelay = (url: string) => {
    const normalized = normalizeRelay(url)
    if (!normalized) return

    const currentPrimary = normalizeRelay(primaryRelay)
    const currentExtras = normalizeRelays(splitLines(extraRelays))

    if (currentPrimary === normalized || currentExtras.includes(normalized)) return

    if (!currentPrimary) {
      primaryRelay = normalized
      setFieldError("primaryRelay")
      return
    }

    extraRelays = normalizeRelays([...currentExtras, normalized]).join("\n")
    setFieldError("extraRelays")
  }

  const getPictureUploadTargetOptions = () => {
    const servers = splitLines(blossomServers)
    const normalizedServers: string[] = []

    for (const [index, server] of servers.entries()) {
      const normalized = normalizeWebUrl(server)

      if (!normalized) {
        setFieldError(
          "blossomServers",
          `Line ${index + 1} must be a valid http:// or https:// URL.`,
        )
        return undefined
      }

      normalizedServers.push(normalized)
    }

    if (normalizedServers.length === 0) return {}

    blossomServers = normalizedServers.join("\n")
    setFieldError("blossomServers")

    return {url: normalizedServers[0], mirrorUrls: normalizedServers.slice(1)}
  }

  const uploadPictureFile = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    pictureUploadStage = "preparing"

    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file.")

      const targetOptions = getPictureUploadTargetOptions()
      if (!targetOptions) {
        pictureUploadStage = "failed"
        pushToast({theme: "error", message: "Fix Blossom server URLs before uploading a picture."})
        return
      }

      const {error, result, uploadId} = await uploadFile(file, {
        ...targetOptions,
        maxWidth: 2048,
        maxHeight: 2048,
        onStage: stage => (pictureUploadStage = stage),
      })

      if (error || !result?.url) throw new Error(error || "Picture upload failed.")

      picture = result.url
      setFieldError("picture")
      promptBlossomMirrorUpload(uploadId)
      pushToast({theme: "success", message: "Community picture uploaded."})
    } catch (error) {
      pictureUploadStage = "failed"
      pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
    } finally {
      input.value = ""
    }
  }

  let loading = $state(false)
  let publishStatus = $state("")
  let name = $state("")
  let description = $state("")
  let website = $state("")
  let picture = $state("")
  let primaryRelay = $state("")
  let extraRelays = $state("")
  let blossomServers = $state("")
  let mints = $state("")
  let tosRef = $state("")
  let tosRelay = $state("")
  let location = $state("")
  let geohash = $state("")
  let pictureUploadStage = $state<BlossomUploadStage>("idle")
  let sectionDrafts = $state<SectionDraft[]>(makeDefaultSectionDrafts())
  let bootstrapGrantDrafts = $state<CommunityBootstrapGrantDraft[]>([])
  let expandedSectionIndex = $state(0)
  let websitePrefilled = $state(false)
  let initializedKey = $state("")
  let errors = $state<FieldErrors>({})
  let originalDraftState = $state<OriginalDraftState | undefined>()
  let keptImmediateWarningKeys = $state<string[]>([])

  const isEdit = $derived(mode === "edit")
  const disabled = $derived(loading ? true : undefined)
  const actionLabel = $derived(isEdit ? "Update" : "Create")
  const title = $derived(isEdit ? "Edit community settings." : "Create a BudaBit community.")
  const eyebrow = $derived(isEdit ? "Community Admin" : "Community Setup")
  const activeCommunityPubkey = $derived(definition?.pubkey || $pubkey || "")
  const sectionCount = $derived(sectionDrafts.length)
  const newAuthorityCount = $derived(
    sectionDrafts.filter(section => section.profileLists.length === 0).length,
  )
  const bootstrapDraftGrantCount = $derived(
    bootstrapGrantDrafts.reduce((count, grant) => count + grant.sectionNames.length, 0),
  )
  const pictureUploading = $derived(!["idle", "ready", "failed"].includes(pictureUploadStage))
  const activeCommunityRelays = $derived.by(() =>
    normalizeRelays([primaryRelay, ...splitLines(extraRelays)]),
  )
  const activeAdmissionFormAddresses = $derived(
    Object.values($activeCommunityAdmissionForms).map(form => form.address),
  )
  const admissionResponseFilters = $derived.by((): Filter[] =>
    isEdit && activeAdmissionFormAddresses.length > 0
      ? [{kinds: [FORM_RESPONSE_KIND], "#a": activeAdmissionFormAddresses, limit: 500}]
      : [],
  )
  const admissionResponseEventsStore = $derived(
    admissionResponseFilters.length > 0
      ? deriveEventsAsc(deriveEventsById({repository, filters: admissionResponseFilters}))
      : undefined,
  )
  const admissionResponseIds = $derived(
    ($admissionResponseEventsStore ? ($admissionResponseEventsStore as TrustedEvent[]) : []).map(
      event => event.id,
    ),
  )
  const admissionResponseDeleteFilters = $derived.by((): Filter[] =>
    admissionResponseIds.length > 0
      ? [{kinds: [DELETE], "#e": admissionResponseIds, "#k": [String(FORM_RESPONSE_KIND)]}]
      : [],
  )
  const admissionReviewFilters = $derived.by((): Filter[] =>
    admissionResponseIds.length > 0
      ? [
          {
            kinds: [COMMUNITY_FORM_REVIEW_KIND],
            "#e": admissionResponseIds,
            "#k": [String(FORM_RESPONSE_KIND)],
            limit: 500,
          },
        ]
      : [],
  )
  const admissionResponseDeleteEventsStore = $derived(
    admissionResponseDeleteFilters.length > 0
      ? deriveEventsAsc(deriveEventsById({repository, filters: admissionResponseDeleteFilters}))
      : undefined,
  )
  const admissionReviewEventsStore = $derived(
    admissionReviewFilters.length > 0
      ? deriveEventsAsc(deriveEventsById({repository, filters: admissionReviewFilters}))
      : undefined,
  )
  const sectionMigrationSummary = $derived.by(() =>
    buildSectionMigrationSummary(makeSectionInputsFromDrafts(sectionDrafts)),
  )
  const recommendedCommunityRelays = $derived.by(() => {
    const active = new Set(activeCommunityRelays)

    return RECOMMENDED_COMMUNITY_RELAYS.filter(relay => !active.has(relay))
  })

  $effect(() => {
    const activePubkey = $pubkey || ""
    const profileKey = [
      profile?.name,
      profile?.display_name,
      profile?.about,
      profile?.website,
      profile?.picture,
    ].join("|")
    const nextKey = isEdit
      ? `edit:${definition?.event.id || ""}:${profileKey}`
      : `create:${activePubkey}`

    if (!nextKey || initializedKey === nextKey) return
    if (isEdit && !definition) return

    initializedKey = nextKey
    errors = {}

    if (isEdit && definition) {
      originalDraftState = makeOriginalDraftState(definition, profile)
      applyOriginalDraftState()
      websitePrefilled = true
      return
    }

    name = ""
    description = ""
    website = activePubkey ? makeBudabitCommunityUrl(activePubkey) : ""
    picture = ""
    primaryRelay = ""
    extraRelays = ""
    blossomServers = ""
    mints = ""
    tosRef = ""
    tosRelay = ""
    location = ""
    geohash = ""
    pictureUploadStage = "idle"
    sectionDrafts = makeDefaultSectionDrafts()
    bootstrapGrantDrafts = []
    expandedSectionIndex = 0
    originalDraftState = undefined
    keptImmediateWarningKeys = []
    websitePrefilled = Boolean(activePubkey)
  })

  $effect(() => {
    if (isEdit || !$pubkey || websitePrefilled) return

    websitePrefilled = true

    if (!website.trim()) website = makeBudabitCommunityUrl($pubkey)
  })

  $effect(() => {
    if (!isEdit || activeCommunityRelays.length === 0) return

    const filters = [
      ...admissionResponseFilters,
      ...admissionResponseDeleteFilters,
      ...admissionReviewFilters,
    ]
    if (filters.length === 0) return

    const controller = new AbortController()

    request({
      relays: activeCommunityRelays,
      autoClose: true,
      filters,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })
</script>

<form
  class={embedded ? "col-4" : "min-h-full bg-base-200"}
  onsubmit={preventDefault(submitCommunitySettings)}>
  <div class={embedded ? "col-4" : "mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10"}>
    <section
      class="relative isolate overflow-hidden rounded-[2rem] border border-base-300 bg-base-100 p-6 shadow-sm sm:p-8 lg:p-10">
      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-end">
        <div>
          <div
            class="mb-5 inline-flex rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-primary">
            {eyebrow}
          </div>
          <h1 class="max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            {title}
          </h1>
          <p class="mt-5 max-w-2xl text-base leading-relaxed opacity-70 sm:text-lg">
            {#if isEdit}
              Publish a fresh community definition with updated relays, metadata, and content
              sections.
            {:else}
              Publish the community definition. Your logged-in account becomes the community.
            {/if}
          </p>
        </div>
        <div
          class="min-w-0 rounded-2xl border border-warning/35 bg-warning/15 p-4 text-sm leading-relaxed text-base-content shadow-sm shadow-warning/5">
          <strong class="block text-base font-semibold text-warning">Community signer</strong>
          <span class="mt-1 block text-base-content/80">
            {#if activeCommunityPubkey}
              <span class="mb-3 block">Publishing as</span>
              <Profile pubkey={activeCommunityPubkey} avatarSize={9} showPubkey />
              <span class="mt-3 block">
                The active signer shown here owns and publishes this community. Better keep the
                community owner key in cold storage and sign with it
                <a
                  class="link font-medium"
                  href="https://nostrapps.com#signers"
                  target="_blank"
                  rel="noopener noreferrer">remotely</a
                >.
              </span>
            {:else}
              Log in with the npub that should own this community.
            {/if}
          </span>
          {#if !isEdit}
            <p
              class="mt-4 break-words rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-semibold leading-snug text-error">
              Warning: The Community you create with this key overwrites Profile, and possibly other
              metadata this account already has!
            </p>
          {/if}
        </div>
      </div>
    </section>

    <div class="mt-6 space-y-6">
      <div class="space-y-6">
        {#if errors.auth}
          <p class="rounded-box bg-error/10 p-4 text-sm font-medium text-error">{errors.auth}</p>
        {/if}

        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <div class="mb-5 flex items-start justify-between gap-4">
            <div>
              <strong class="text-lg">Community identity</strong>
              <p class="mt-1 text-sm opacity-65">
                The active signer publishes the public profile and kind:10222 rules.
              </p>
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <Field error={errors.name}>
              {#snippet label()}<p>Name <span class="text-primary">(required)</span></p>{/snippet}
              {#snippet input()}<input
                  bind:value={name}
                  class="input input-bordered w-full {errors.name ? 'input-error' : ''}"
                  onblur={() => validateField("name")}
                  type="text" />{/snippet}
            </Field>
            <div class="rounded-xl border border-base-300 bg-base-200 p-3 text-sm">
              <strong>Community pubkey</strong>
              <code class="mt-2 block break-all text-xs opacity-75"
                >{activeCommunityPubkey || "Not logged in"}</code>
            </div>
            <div class="md:col-span-2">
              <Field>
                {#snippet label()}<p>
                    Description <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<textarea
                    bind:value={description}
                    class="textarea textarea-bordered min-h-28"
                    rows="3"></textarea
                  >{/snippet}
              </Field>
            </div>
            <Field error={errors.website}>
              {#snippet label()}<p>Website <span class="opacity-60">(optional)</span></p>{/snippet}
              {#snippet input()}<input
                  bind:value={website}
                  class="input input-bordered w-full {errors.website ? 'input-error' : ''}"
                  onblur={() => validateField("website")}
                  type="url" />{/snippet}
            </Field>
            <Field error={errors.picture}>
              {#snippet label()}<p>
                  Picture URL <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<div class="space-y-2">
                  <div class="space-y-2">
                    <input
                      bind:value={picture}
                      class="input input-bordered w-full {errors.picture ? 'input-error' : ''}"
                      disabled={pictureUploading}
                      oninput={() => (pictureUploadStage = "idle")}
                      onblur={() => validateField("picture")}
                      type="url" />
                    <label
                      class="btn btn-outline btn-sm w-full sm:w-auto {pictureUploading || loading
                        ? 'btn-disabled'
                        : ''}">
                      {#if pictureUploading}
                        <span class="loading loading-spinner loading-xs"></span>
                      {/if}
                      Upload picture
                      <input
                        type="file"
                        accept="image/*"
                        class="hidden"
                        disabled={pictureUploading || loading}
                        onchange={uploadPictureFile} />
                    </label>
                  </div>
                  <BlossomUploadStatus stage={pictureUploadStage} />
                </div>{/snippet}
            </Field>
          </div>
        </section>

        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <div class="mb-5 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <strong class="text-lg">Content sections</strong>
              <p class="mt-1 text-sm opacity-65">
                Section names may use only A-Z letters and must be 50 characters or fewer.
              </p>
            </div>
            <div
              class="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0 sm:flex-row sm:flex-wrap sm:justify-end">
              {#if isEdit && originalDraftState}
                <Button
                  class="btn btn-outline btn-sm w-full sm:w-auto"
                  onclick={applyOriginalDraftState}
                  {disabled}>
                  Reset changes
                </Button>
              {/if}
              <Button
                class="btn btn-ghost btn-sm w-full sm:w-auto"
                onclick={restoreDefaultSections}
                {disabled}>
                Restore defaults
              </Button>
              <Button
                class="btn btn-primary btn-sm w-full sm:w-auto"
                onclick={addSection}
                {disabled}>
                Add section
              </Button>
            </div>
          </div>
          {#if errors.sections}
            <p class="mb-4 rounded-box bg-error/10 p-3 text-sm text-error">{errors.sections}</p>
          {/if}
          <div class="space-y-4">
            {#each sectionDrafts as section, sectionIndex}
              {@const isExpanded = expandedSectionIndex === sectionIndex}
              <div
                class="scroll-mt-24 overflow-hidden rounded-2xl border border-base-300 bg-base-200/60"
                data-section-accordion={sectionIndex}>
                <button
                  type="button"
                  class="flex w-full items-center justify-between gap-4 p-4 text-left transition-colors hover:bg-base-200"
                  aria-expanded={isExpanded}
                  onclick={() => toggleSectionAccordion(sectionIndex)}>
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <strong class="truncate text-base"
                        >{section.name || `Section ${sectionIndex + 1}`}</strong>
                      {#if errors[sectionNameField(sectionIndex)] || errors[sectionKindsField(sectionIndex)]}
                        <span class="badge badge-error badge-sm">Needs review</span>
                      {/if}
                    </div>
                    <p class="mt-1 text-sm opacity-65">
                      {section.kinds.length} kind{section.kinds.length === 1 ? "" : "s"}
                    </p>
                  </div>
                  <span class="btn btn-ghost btn-sm shrink-0" aria-hidden="true">
                    {isExpanded ? "Collapse" : "Expand"}
                  </span>
                </button>

                {#if isExpanded}
                  <div class="space-y-5 border-t border-base-300 p-4">
                    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                      <Field class="flex-1" error={errors[sectionNameField(sectionIndex)]}>
                        {#snippet label()}<p>Section name</p>{/snippet}
                        {#snippet input()}<input
                            value={section.name}
                            maxlength="50"
                            class="input input-bordered w-full {errors[
                              sectionNameField(sectionIndex)
                            ]
                              ? 'input-error'
                              : ''}"
                            oninput={event =>
                              updateSection(sectionIndex, {
                                name: (event.currentTarget as HTMLInputElement).value,
                              })}
                            onblur={event => {
                              validateSectionNames()
                              maybeWarnSectionRename(sectionIndex, event)
                            }}
                            type="text" />{/snippet}
                      </Field>
                      <Button
                        class="btn btn-outline btn-error btn-sm w-full sm:w-auto"
                        disabled={disabled || sectionDrafts.length === 1}
                        onclick={() => removeSection(sectionIndex)}>
                        Remove section
                      </Button>
                    </div>

                    <div class="space-y-3">
                      <div class="flex items-center justify-between gap-3">
                        <strong class="text-sm">Event kinds</strong>
                        <Button
                          class="btn btn-outline btn-sm shadow-sm"
                          onclick={() => addKind(sectionIndex)}
                          {disabled}>Add kind</Button>
                      </div>
                      {#if errors[sectionKindsField(sectionIndex)]}
                        <p class="text-sm text-error">{errors[sectionKindsField(sectionIndex)]}</p>
                      {/if}
                      {#each section.kinds as kindDraft, kindIndex}
                        <div
                          data-section-kind-row={`${sectionIndex}-${kindIndex}`}
                          class="grid gap-2 rounded-2xl border border-base-300 bg-base-100/75 p-3 text-sm shadow-sm sm:grid-cols-2 sm:gap-3 sm:p-4 sm:text-base lg:grid-cols-[minmax(220px,2fr)_minmax(100px,1fr)_minmax(170px,1fr)_auto] lg:items-end">
                          <Field class="sm:col-span-2 lg:col-span-1">
                            {#snippet label()}<p>Known kind</p>{/snippet}
                            {#snippet input()}<select
                                class="select select-bordered select-sm w-full text-sm sm:select-md sm:text-base"
                                value={kindDraftOptionValue(kindDraft)}
                                onchange={event =>
                                  setKnownKind(
                                    sectionIndex,
                                    kindIndex,
                                    (event.currentTarget as HTMLSelectElement).value,
                                  )}>
                                <option value={CUSTOM_KIND_VALUE}>Custom kind</option>
                                {#each KNOWN_SECTION_KIND_OPTIONS as option}
                                  <option value={kindOptionValue(option.kind, option.subtype || "")}
                                    >{option.label} ({option.kind}{option.subtype
                                      ? ` / ${option.subtype}`
                                      : ""})</option>
                                {/each}
                              </select>{/snippet}
                          </Field>
                          <Field error={errors[sectionKindField(sectionIndex, kindIndex)]}>
                            {#snippet label()}<p>Kind</p>{/snippet}
                            {#snippet input()}<input
                                value={kindDraft.kind}
                                class="input input-sm input-bordered w-full text-sm sm:input-md sm:text-base {errors[
                                  sectionKindField(sectionIndex, kindIndex)
                                ]
                                  ? 'input-error'
                                  : ''}"
                                inputmode="numeric"
                                onblur={event =>
                                  requestSectionKindUpdate(sectionIndex, kindIndex, {
                                    kind: event.currentTarget.value,
                                  })}
                                type="text" />{/snippet}
                          </Field>
                          <Field error={errors[sectionSubtypeField(sectionIndex, kindIndex)]}>
                            {#snippet label()}
                              <p>Subtype</p>
                              <Tooltip content={SUBTYPE_HELP} class="inline-flex">
                                <button
                                  type="button"
                                  class="badge badge-ghost badge-sm"
                                  aria-label={SUBTYPE_HELP}>
                                  ?
                                </button>
                              </Tooltip>
                            {/snippet}
                            {#snippet input()}<input
                                value={kindDraft.subtype}
                                maxlength="20"
                                class="input input-sm input-bordered w-full text-sm sm:input-md sm:text-base {errors[
                                  sectionSubtypeField(sectionIndex, kindIndex)
                                ]
                                  ? 'input-error'
                                  : ''}"
                                onblur={event =>
                                  requestSectionKindUpdate(sectionIndex, kindIndex, {
                                    subtype: event.currentTarget.value,
                                  })}
                                type="text" />{/snippet}
                          </Field>
                          <div class="flex sm:col-span-2 lg:col-span-1">
                            <Button
                              class="btn btn-outline btn-error btn-sm w-full lg:w-auto"
                              disabled={disabled || section.kinds.length === 1}
                              onclick={() => removeKind(sectionIndex, kindIndex)}>
                              Remove
                            </Button>
                          </div>
                        </div>
                      {/each}
                    </div>

                    {#if sectionIndex < sectionDrafts.length - 1}
                      <div class="flex justify-end border-t border-base-300 pt-4">
                        <Button
                          class="btn btn-primary btn-sm"
                          onclick={() => scrollToSection(sectionIndex + 1)}
                          {disabled}>
                          Next section
                        </Button>
                      </div>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </section>

        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <div class="mb-5 flex items-start justify-between gap-4">
            <div>
              <strong class="text-lg">Relay and infrastructure</strong>
              <p class="mt-1 text-sm opacity-65">
                One prepared community relay is the minimum requirement.
              </p>
            </div>
          </div>
          <div class="mb-5 grid gap-3 lg:grid-cols-2">
            <div class="rounded-2xl border border-info/20 bg-info/5 p-4">
              <p class="text-sm font-semibold text-info">Recommended community relays</p>
              <p class="mt-1 text-xs leading-relaxed text-base-content/70">
                Click once to add a starter relay to your community definition.
              </p>
              <div class="mt-3 flex flex-wrap gap-2">
                {#if recommendedCommunityRelays.length === 0}
                  <p class="text-sm text-base-content/65">
                    All recommended relays are already added.
                  </p>
                {:else}
                  {#each recommendedCommunityRelays as relay (relay)}
                    <button
                      type="button"
                      class="max-w-full rounded-full border border-dashed border-base-content/30 px-3 py-1 text-left text-sm transition hover:border-info hover:text-info disabled:cursor-not-allowed disabled:opacity-50"
                      onclick={() => addRecommendedCommunityRelay(relay)}
                      {disabled}>
                      + <span class="break-all">{relay.replace(/^wss?:\/\//, "")}</span>
                    </button>
                  {/each}
                {/if}
              </div>
            </div>
            <div
              class="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-base-content">
              <p class="font-semibold text-warning">Public relay caution</p>
              <p class="mt-1 text-base-content/75">
                These relays do not have availability or data retention guarantees. Run your own
                relays to become fully independent.
              </p>
              <a
                class="link mt-2 inline-block text-sm font-medium"
                href={STRFRY_RELAY_URL}
                target="_blank"
                rel="noopener noreferrer">strfry relay implementation</a>
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <Field error={errors.primaryRelay}>
              {#snippet label()}<p>
                  Primary community relay <span class="text-primary">(required)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  bind:value={primaryRelay}
                  class="input input-bordered w-full {errors.primaryRelay ? 'input-error' : ''}"
                  onblur={() => validateField("primaryRelay")}
                  type="url"
                  placeholder="wss://relay.example.com" />{/snippet}
            </Field>
            <Field error={errors.extraRelays}>
              {#snippet label()}<p>
                  Extra relays <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<textarea
                  bind:value={extraRelays}
                  class="textarea textarea-bordered {errors.extraRelays ? 'textarea-error' : ''}"
                  onblur={() => validateField("extraRelays")}
                  rows="2"
                  placeholder="One relay per line"></textarea>
                >{/snippet}
            </Field>
            <div class="space-y-3">
              <Field error={errors.blossomServers}>
                {#snippet label()}<p>
                    Blossom servers <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<textarea
                    bind:value={blossomServers}
                    class="textarea textarea-bordered {errors.blossomServers
                      ? 'textarea-error'
                      : ''}"
                    onblur={() => validateField("blossomServers")}
                    rows="2"
                    placeholder="One server per line"></textarea>
                  >{/snippet}
              </Field>
              <div
                class="rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm leading-relaxed text-base-content">
                <p class="font-semibold text-warning">Blossom media ownership</p>
                <p class="mt-1 text-base-content/75">
                  BudaBit comes with a last-resort Blossom media server, but you should run your own
                  to have full control over media storage, retention, and policy.
                </p>
                <a
                  class="link mt-2 inline-block text-sm font-medium"
                  href={BLOSSOM_SERVER_URL}
                  target="_blank"
                  rel="noopener noreferrer">Blossom server implementation</a>
              </div>
            </div>
            <Field error={errors.mints}>
              {#snippet label()}<p>Mints <span class="opacity-60">(optional)</span></p>{/snippet}
              {#snippet input()}<textarea
                  bind:value={mints}
                  class="textarea textarea-bordered {errors.mints ? 'textarea-error' : ''}"
                  onblur={() => validateField("mints")}
                  rows="2"
                  placeholder="https://mint.example.com cashu"></textarea>
                >{/snippet}
            </Field>
          </div>
        </section>
      </div>

      <div class="space-y-6">
        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <strong class="text-lg">Policy and location</strong>
          <p class="mt-2 text-sm opacity-65">Optional metadata for rules or regional context.</p>
          <div class="mt-5 space-y-4">
            <Field error={errors.tosRef}>
              {#snippet label()}<p>
                  Terms reference <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  bind:value={tosRef}
                  class="input input-bordered w-full {errors.tosRef ? 'input-error' : ''}"
                  onblur={() => validateField("tosRef")}
                  type="text"
                  placeholder="event id, URL, or policy ref" />{/snippet}
            </Field>
            <Field error={errors.tosRelay}>
              {#snippet label()}<p>
                  Terms relay <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  bind:value={tosRelay}
                  class="input input-bordered w-full {errors.tosRelay ? 'input-error' : ''}"
                  onblur={() => validateField("tosRelay")}
                  type="url" />{/snippet}
            </Field>
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Field>
                {#snippet label()}<p>
                    Location <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<input
                    bind:value={location}
                    class="input input-bordered w-full"
                    type="text" />{/snippet}
              </Field>
              <Field error={errors.geohash}>
                {#snippet label()}<p>
                    Geohash <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<input
                    bind:value={geohash}
                    class="input input-bordered w-full {errors.geohash ? 'input-error' : ''}"
                    onblur={() => validateField("geohash")}
                    type="text" />{/snippet}
              </Field>
            </div>
          </div>
        </section>

        {#if isEdit && definition}
          <CommunityBootstrapPeopleEditor
            {definition}
            sections={sectionDrafts
              .map(section => ({
                name: section.name.trim(),
                displayName: section.name.trim() || "Unnamed section",
                profileLists: section.profileLists,
              }))
              .filter(section => section.name)}
            profileListEvents={$activeCommunityProfileListEvents}
            relays={activeCommunityRelays}
            bind:draftGrants={bootstrapGrantDrafts}
            {disabled} />
        {/if}

        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <strong class="text-lg">What gets published</strong>
          {#if isEdit && sectionMigrationSummary.changes.length > 0}
            <div
              class="mt-4 rounded-2xl border border-warning/35 bg-warning/10 p-4 text-sm leading-relaxed">
              <strong class="block text-warning">Permission changes to review</strong>
              <div class="mt-3 space-y-3">
                <div>
                  <p class="font-semibold">Dangerous changes</p>
                  <ul class="mt-1 list-disc space-y-1 pl-5">
                    {#each makeChangeSummaryItems(sectionMigrationSummary) as item}
                      <li>{item}</li>
                    {/each}
                  </ul>
                </div>
                {#if makeMigrationSummaryItems(sectionMigrationSummary).length > 0}
                  <div>
                    <p class="font-semibold">Migration available</p>
                    <ul class="mt-1 list-disc space-y-1 pl-5">
                      {#each makeMigrationSummaryItems(sectionMigrationSummary) as item}
                        <li>{item}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
                {#if makeDropSummaryItems(sectionMigrationSummary).length > 0}
                  <div>
                    <p class="font-semibold">Not migrated</p>
                    <ul class="mt-1 list-disc space-y-1 pl-5">
                      {#each makeDropSummaryItems(sectionMigrationSummary) as item}
                        <li>{item}</li>
                      {/each}
                    </ul>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
          <div class="mt-4 grid grid-cols-2 gap-2 text-sm">
            <div class="rounded-xl bg-base-200 p-3"><strong>1</strong><br />profile</div>
            <div class="rounded-xl bg-base-200 p-3"><strong>1</strong><br />definition</div>
            <div class="rounded-xl bg-base-200 p-3">
              <strong>{sectionCount}</strong><br />sections
            </div>
            <div class="rounded-xl bg-base-200 p-3">
              <strong>{newAuthorityCount}</strong><br />new lists
            </div>
          </div>
          {#if bootstrapDraftGrantCount > 0}
            <p class="mt-3 rounded-xl bg-warning/10 p-3 text-xs leading-relaxed text-warning">
              {bootstrapDraftGrantCount} draft member/moderator grant{bootstrapDraftGrantCount === 1
                ? ""
                : "s"} will publish with this update.
            </p>
          {/if}
          {#if publishStatus}
            <div
              class="mt-4 rounded-box border border-base-300 bg-base-200 p-3 text-sm"
              aria-live="polite">
              <Spinner {loading}>{publishStatus}</Spinner>
            </div>
          {/if}
          <div class="mt-5 flex gap-2">
            <Button class="btn btn-ghost flex-1" onclick={cancel} {disabled}>Cancel</Button>
            {#if isEdit && originalDraftState}
              <Button class="btn btn-outline flex-1" onclick={applyOriginalDraftState} {disabled}>
                Reset changes
              </Button>
            {/if}
            <Button
              class="btn btn-primary flex-1"
              type="submit"
              disabled={disabled ||
                !$pubkey ||
                !name.trim() ||
                !primaryRelay.trim() ||
                pictureUploading ||
                sectionDrafts.length === 0}>
              {#if loading}<span class="loading loading-spinner mr-2"></span>{/if}
              {actionLabel}
            </Button>
          </div>
        </section>
      </div>
    </div>
  </div>
</form>
