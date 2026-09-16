<script lang="ts">
  import {tick} from "svelte"
  import {browser} from "$app/environment"
  import {goto} from "$app/navigation"
  import {randomId} from "@welshman/lib"
  import {request} from "@welshman/net"
  import {pubkey, repository, signer as sessionSigner} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {
    DELETE,
    EVENT_DATE,
    EVENT_TIME,
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
  import LogIn from "@app/components/LogIn.svelte"
  import Profile from "@app/components/Profile.svelte"
  import CommunityBootstrapPeopleEditor from "@app/components/community/CommunityBootstrapPeopleEditor.svelte"
  import CommunitySectionChangeWarning from "@app/components/community/CommunitySectionChangeWarning.svelte"
  import CommunitySectionPublishConfirm from "@app/components/community/CommunitySectionPublishConfirm.svelte"
  import {preventDefault} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityAdmissionForms,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeCommunityProfileListEvents,
    activeCommunityReportReviewEvents,
    activeCommunityReportState,
    clearCommunityBootstrapCache,
    setActiveExactCommunityDefinition,
  } from "@app/core/community-state"
  import {COMMUNITY_EXPLAINER_PATH, makeExactCommunityPath} from "@app/util/routes"
  import {
    DEFAULT_COMMUNITY_SECTION_NAMES,
    COMMUNITY_DEFINITION_KIND,
    FORM_RESPONSE_KIND,
    buildCommunityDefinition,
    getCommunitySectionKindAssignments,
    getDefaultCommunitySectionKinds,
    getCommunitySectionKindKey,
    getCommunitySectionKindLabel,
    getProfileListPubkeys,
    getCommunitySectionPurpose,
    isHexPubkey,
    makeCommunityProfileListIdentifier,
    parseCommunityDefinition,
    parseAddressRef,
    isCommunityDefinitionReference,
    normalizeCommunityAlertHandlerAddress,
    normalizeCommunityAlertService,
    normalizeCommunityEmailDigestHandlerAddress,
    normalizeCommunityEmailDigestService,
    normalizeCommunityServiceRelay,
    normalizeCommunityRelay,
    normalizeGeohash,
    normalizePubkey,
    updateCommunityDefinition,
    PROFILE_LIST_KIND,
    type CommunityAlertService,
    type CommunityDefinitionBadgeRef,
    type CommunityEmailDigestService,
    type CommunityMint,
    type CommunityDefinition,
    type CommunityDefinitionProfileListRef,
    type CommunityDefinitionRetentionPolicy,
    type CommunityDefinitionSectionInput,
    type CommunityDefinitionSectionKind,
  } from "@app/core/community"
  import {
    getCommunitySectionNameKey,
    getSectionLifecycleChanges,
    type KeyedCommunitySectionInput,
    type SectionLifecycleChange,
  } from "@app/core/community-section-lifecycle"
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
  import {createCommunity} from "@app/core/community-create"
  import {uploadFile} from "@app/core/commands"
  import type {BlossomUploadStage} from "@app/core/blossom"
  import {promptBlossomMirrorUpload} from "@app/util/blossom-mirror-prompt"

  type Mode = "create" | "edit"

  type OwnerProfile = {
    name?: string
    display_name?: string
    about?: string
    website?: string
    picture?: string
  }

  type Props = {
    mode?: Mode
    definition?: CommunityDefinition
    profile?: OwnerProfile
    embedded?: boolean
    operationId?: string
  }

  type SetupSigner = {
    pubkey: string
    signer: ISigner
  }

  type FieldErrors = Record<string, string>

  type ValidatedField =
    | "name"
    | "description"
    | "website"
    | "picture"
    | "primaryRelay"
    | "extraRelays"
    | "blossomServers"
    | "graspServers"
    | "emailDigestServicePubkey"
    | "emailDigestRequestRelay"
    | "emailDigestHandlerAddress"
    | "emailDigestHandlerRelay"
    | "communityAlertServicePubkey"
    | "communityAlertRequestRelay"
    | "communityAlertHandlerAddress"
    | "communityAlertHandlerRelay"
    | "mints"
    | "tosRef"
    | "tosRelay"
    | "location"
    | "geohash"

  type SectionKindDraft = {
    kind: string
    subtype: string
  }

  type SectionDraft = {
    draftKey: string
    originalNameKey?: string
    name: string
    kinds: SectionKindDraft[]
    profileLists: CommunityDefinitionProfileListRef[]
    badges: CommunityDefinitionBadgeRef[]
    retention: CommunityDefinitionRetentionPolicy[]
  }

  type NewProfileList = {
    sectionName: string
    profileList: CommunityDefinitionProfileListRef
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
    graspServers: string[]
    emailDigestServices: CommunityEmailDigestService[]
    communityAlertServices: CommunityAlertService[]
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
    graspServers: string
    emailDigestServicePubkey: string
    emailDigestRequestRelay: string
    emailDigestHandlerAddress: string
    emailDigestHandlerRelay: string
    additionalEmailDigestServices: CommunityEmailDigestService[]
    communityAlertServicePubkey: string
    communityAlertRequestRelay: string
    communityAlertHandlerAddress: string
    communityAlertHandlerRelay: string
    additionalCommunityAlertServices: CommunityAlertService[]
    mints: string
    tosRef: string
    tosRelay: string
    location: string
    geohash: string
    sectionDrafts: SectionDraft[]
  }

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
    draftModeratorInvitePubkeys: string[]
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

  const {
    mode = "create",
    definition,
    embedded = false,
    operationId: communityCreateOperationId = "",
  }: Props = $props()

  const SECTION_NAME_RE = /^[A-Za-z-]{1,50}$/
  const CUSTOM_KIND_VALUE = "custom"
  const KIND_DIGITS_RE = /^\d+$/
  const SUBTYPE_RE = /^[a-z-]{0,20}$/
  const SUBTYPE_HELP =
    "Optional third value in a k tag. Use it when one event kind supports multiple sections, like 11/room, 11/threads, or 9/room-message."
  const COMMENTS_KIND_HELP = "Used for messages in Threads, Calendar events, and fundraiser Goals"
  const normalizeDefinitionRelay = (value?: string) => normalizeCommunityRelay(value?.trim()) || ""
  const normalizeDefinitionRelays = (relays: string[]) =>
    Array.from(new Set(relays.map(normalizeDefinitionRelay).filter(Boolean)))
  const RECOMMENDED_COMMUNITY_RELAYS = normalizeDefinitionRelays([
    "wss://relay.budabit.club",
    "wss://nos.lol",
  ])
  const STRFRY_RELAY_URL = "https://github.com/hoytech/strfry"
  const BLOSSOM_SERVER_URL =
    "https://budabit.club/git/naddr1qvzqqqrhnypzqfngzhsvjggdlgeycm96x4emzjlwf8dyyzdfg4hefp89zpkdgz99qyvhwumn8ghj7emfwsh8x6rpddjhxur9v9ex2tnyd9usz9rhwden5te0wfjkccte9ehxw6t59ejx2aspr9mhxue69uhhq7tjv9kkjepwve5kzar2v9nzucm0d5qqucnvdaehxmmd94ek2unkv4eqs93a9j"
  const EMAIL_DIGEST_PROVIDER_IMPLEMENTATION_URL =
    "https://budabit.club/git/naddr1qvzqqqrhnypzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqyxhwumn8ghj7mn0wvhxcmmvqyv8wumn8ghj7cn4v3sky6t59ehx7um5wgcjucm0d5q3samnwvaz7tm8wfshxupwvf6kgctzd96zucmvw43qqpnpde3ksmmjdnfhh0"
  const KNOWN_SECTION_KIND_OPTIONS = [
    {label: "Room Messages", kind: 9, subtype: "room-message"},
    {label: "Rooms", kind: 11, subtype: "room"},
    {label: "Threads", kind: 11, subtype: "threads"},
    {label: "Comments", kind: 1111},
    {label: "Reactions", kind: 7},
    {label: "Reports", kind: 1984},
    {label: "Labels", kind: 1985},
    {label: "All-day Calendar Events", kind: EVENT_DATE},
    {label: "Calendar Events", kind: EVENT_TIME},
    {label: "Fundraiser Goals", kind: 9041},
    {label: "Repository Announcements", kind: 30617},
    {label: "Permalinks", kind: 1623},
    {label: "Smart Widgets", kind: 30033},
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
  const controlId = (field: string) => `community-${field}`
  const describedBy = (field: string, hasHint = false) =>
    [hasHint ? `${controlId(field)}-hint` : "", errors[field] ? `${controlId(field)}-error` : ""]
      .filter(Boolean)
      .join(" ") || undefined

  const getErrorLabel = (field: string) => {
    const labels: Record<string, string> = {
      auth: "Community owner",
      name: "Community name",
      description: "Description",
      website: "Website",
      picture: "Picture URL",
      sections: "Content sections",
      primaryRelay: "Primary community relay",
      extraRelays: "Extra relays",
      blossomServers: "Blossom servers",
      graspServers: "GRASP servers",
      mints: "Mints",
      emailDigestServicePubkey: "Repository digest service pubkey",
      emailDigestRequestRelay: "Repository digest request relay",
      emailDigestHandlerAddress: "Repository digest handler address",
      emailDigestHandlerRelay: "Repository digest handler relay",
      communityAlertServicePubkey: "Community digest service pubkey",
      communityAlertRequestRelay: "Community digest request relay",
      communityAlertHandlerAddress: "Community digest handler address",
      communityAlertHandlerRelay: "Community digest handler relay",
      tosRef: "Terms reference",
      tosRelay: "Terms relay",
      location: "Location",
      geohash: "Geohash",
    }
    if (labels[field]) return labels[field]

    const sectionMatch = field.match(/^section-(\d+)-(name|kinds|kind-\d+|subtype-\d+)$/)
    if (!sectionMatch) return "Community settings"
    const sectionNumber = Number(sectionMatch[1]) + 1
    const part = sectionMatch[2]
    if (part === "name") return `Section ${sectionNumber} name`
    if (part === "kinds") return `Section ${sectionNumber} event kinds`
    return `Section ${sectionNumber} ${part.startsWith("subtype") ? "subtype" : "event kind"}`
  }

  const toKindDraft = (kind: CommunityDefinitionSectionKind): SectionKindDraft => ({
    kind: String(kind.kind),
    subtype: kind.subtype || "",
  })

  const getSectionNameKey = getCommunitySectionNameKey
  const makeDefaultSectionDraftKey = (name: string) => `default:${getSectionNameKey(name)}`
  const makeOriginalSectionDraftKey = (name: string) => `original:${getSectionNameKey(name)}`
  const makeNewSectionDraftKey = () => `new:${randomId()}`

  const makeDefaultSectionDrafts = (): SectionDraft[] =>
    DEFAULT_COMMUNITY_SECTION_NAMES.map(name => ({
      draftKey: makeDefaultSectionDraftKey(name),
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
      draftKey: makeOriginalSectionDraftKey(section.name),
      originalNameKey: getSectionNameKey(section.name),
      name: section.name,
      kinds: section.kinds.map(toKindDraft),
      profileLists: section.profileLists.map(ref => ({...ref})),
      badges: section.badges.map(ref => ({...ref})),
      retention: section.retention,
    }))

  const cloneSectionDrafts = (drafts: SectionDraft[]): SectionDraft[] =>
    drafts.map(section => ({
      draftKey: section.draftKey,
      originalNameKey: section.originalNameKey,
      name: section.name,
      kinds: section.kinds.map(kind => ({...kind})),
      profileLists: section.profileLists.map(ref => ({...ref})),
      badges: section.badges.map(ref => ({...ref})),
      retention: section.retention.map(policy => ({...policy})),
    }))

  const makeOriginalDraftState = (
    communityDefinition: CommunityDefinition,
  ): OriginalDraftState => ({
    name: communityDefinition.metadata.name || "",
    description: communityDefinition.metadata.description || "",
    website: communityDefinition.metadata.website || "",
    picture: communityDefinition.metadata.picture || "",
    primaryRelay: communityDefinition.relays[0] || "",
    extraRelays: communityDefinition.relays.slice(1).join("\n"),
    blossomServers: communityDefinition.blossomServers.join("\n"),
    graspServers: communityDefinition.graspServers.join("\n"),
    emailDigestServicePubkey:
      communityDefinition.services.find(service => service.name === "email-digest")?.pubkey || "",
    emailDigestRequestRelay:
      communityDefinition.services.find(service => service.name === "email-digest")?.requestRelay ||
      "",
    emailDigestHandlerAddress:
      communityDefinition.services.find(service => service.name === "email-digest")
        ?.handlerAddress || "",
    emailDigestHandlerRelay:
      communityDefinition.services.find(service => service.name === "email-digest")?.handlerRelay ||
      "",
    additionalEmailDigestServices: communityDefinition.services
      .filter(service => service.name === "email-digest")
      .slice(1)
      .map(service => ({servicePubkey: service.pubkey, ...service})),
    communityAlertServicePubkey:
      communityDefinition.services.find(service => service.name === "community-alerts")?.pubkey ||
      "",
    communityAlertRequestRelay:
      communityDefinition.services.find(service => service.name === "community-alerts")
        ?.requestRelay || "",
    communityAlertHandlerAddress:
      communityDefinition.services.find(service => service.name === "community-alerts")
        ?.handlerAddress || "",
    communityAlertHandlerRelay:
      communityDefinition.services.find(service => service.name === "community-alerts")
        ?.handlerRelay || "",
    additionalCommunityAlertServices: communityDefinition.services
      .filter(service => service.name === "community-alerts")
      .slice(1)
      .map(service => ({servicePubkey: service.pubkey, ...service})),
    mints: communityDefinition.mints
      .map(mint => [mint.url, mint.type].filter(Boolean).join(" "))
      .join("\n"),
    tosRef: communityDefinition.terms?.reference || "",
    tosRelay: communityDefinition.terms?.relay || "",
    location: communityDefinition.metadata.location || "",
    geohash: communityDefinition.metadata.geohash || "",
    sectionDrafts: makeSectionDraftsFromDefinition(communityDefinition),
  })

  const parseSectionDraftKind = (
    draft: SectionKindDraft,
  ): CommunityDefinitionSectionKind | undefined => {
    const kindValue = draft.kind.trim()
    const kind = Number.parseInt(kindValue, 10)
    const subtype = draft.subtype.trim()

    if (!KIND_DIGITS_RE.test(kindValue) || !Number.isInteger(kind) || kind < 0 || kind > 39999) {
      return undefined
    }
    if (!SUBTYPE_RE.test(subtype)) return undefined

    return {kind, subtype: subtype || undefined}
  }

  const makeSectionInputsFromDrafts = (drafts: SectionDraft[]): KeyedCommunitySectionInput[] =>
    drafts.map(section => ({
      originalNameKey: section.originalNameKey,
      name: section.name.trim(),
      kinds: section.kinds
        .map(parseSectionDraftKind)
        .filter(Boolean) as CommunityDefinitionSectionKind[],
    }))

  const getSectionAssignmentMap = (
    sections: Array<Pick<CommunityDefinitionSectionInput, "name" | "kinds">>,
  ) => new Map(getCommunitySectionKindAssignments(sections as any).map(item => [item.key, item]))

  const uniqueNormalizedPubkeys = (pubkeys: string[]) =>
    Array.from(new Set(pubkeys.map(normalizePubkey).filter(Boolean)))

  const getOriginalSectionByKey = (sectionNameKey?: string) =>
    sectionNameKey
      ? definition &&
        makeSectionDraftsFromDefinition(definition).find(
          section => getSectionNameKey(section.name) === sectionNameKey,
        )
      : undefined

  const getOriginalSection = (sectionName: string) =>
    getOriginalSectionByKey(getSectionNameKey(sectionName))

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
    const owner = normalizePubkey(definition.ownerPubkey)

    return uniqueNormalizedPubkeys(
      section.profileLists
        .filter(ref => normalizePubkey(parseAddressRef(ref.address)?.pubkey || "") !== owner)
        .filter(ref =>
          isActiveCommunityProfileListEvent(
            findCommunityProfileListEvent(ref, $activeCommunityProfileListEvents),
          ),
        )
        .map(ref => parseAddressRef(ref.address)?.pubkey || ""),
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
        community: form.community,
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
      const review = parseCommunityReportReviewLabel(event)
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

  const getDraftModeratorInvitePubkeys = () =>
    uniqueNormalizedPubkeys(
      bootstrapGrantDrafts.flatMap(grant => (grant.role === "moderator" ? [grant.pubkey] : [])),
    )

  const buildSectionMigrationSummary = (
    currentSections: KeyedCommunitySectionInput[],
  ): SectionMigrationSummary => {
    const changes =
      isEdit && definition
        ? getSectionLifecycleChanges({originalSections: definition.sections, currentSections})
        : []
    const migrationPairs = getMigrationPairs(changes)
    const removedSectionNames = getDroppedSectionNames(changes)
    const affectedOldSectionNames = Array.from(
      new Set([...migrationPairs.map(pair => pair.oldSectionName), ...removedSectionNames]),
    )
    const owner = normalizePubkey(definition?.ownerPubkey || "")
    const migratedMemberPubkeys = uniqueNormalizedPubkeys(
      migrationPairs.flatMap(pair => getActiveSectionMemberPubkeys(pair.oldSectionName)),
    ).filter(pubkey => pubkey !== owner)
    const moderatorPubkeys = uniqueNormalizedPubkeys(
      migrationPairs.flatMap(pair => getActiveSectionModeratorPubkeys(pair.oldSectionName)),
    ).filter(pubkey => pubkey !== owner)
    const draftModeratorInvitePubkeys = getDraftModeratorInvitePubkeys().filter(
      pubkey => pubkey !== owner,
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
      draftModeratorInvitePubkeys,
      formCopyCount: getFormCopyCount(migrationPairs),
      reportReviewCopyCount: getReportReviewCopyCount(migrationPairs),
      pendingRequestCount,
    }
  }

  const makeEmptySectionDraft = (): SectionDraft => {
    const existingNames = new Set(sectionDrafts.map(section => getSectionNameKey(section.name)))
    const name =
      ["Custom", "Content", "Section", "Community"].find(
        candidate => !existingNames.has(getSectionNameKey(candidate)),
      ) || "Custom"

    return {
      draftKey: makeNewSectionDraftKey(),
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

  const utf8Length = (value: string) => new TextEncoder().encode(value).length

  const normalizeWebUrl = (value: string, httpsOnly = false) => {
    const trimmed = value.trim()
    if (!trimmed || utf8Length(trimmed) > 2048) return ""

    try {
      const url = new URL(trimmed)
      const validProtocol = httpsOnly
        ? url.protocol === "https:"
        : url.protocol === "http:" || url.protocol === "https:"
      if (!validProtocol || !url.hostname || url.username || url.password || url.hash) return ""

      let normalized = url.toString()
      if (url.pathname === "/" && !url.search) normalized = normalized.slice(0, -1)
      return normalized
    } catch {
      return ""
    }
  }

  const validateRelayLines = (value: string, field: string, nextErrors: FieldErrors) => {
    const relays: string[] = []

    for (const [index, line] of splitLines(value).entries()) {
      const relay = normalizeDefinitionRelay(line)
      if (!relay) {
        nextErrors[field] =
          `Line ${index + 1} must be a secure relay URL, like wss://relay.example.com.`
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
    httpsOnly = false,
  ) => {
    const trimmed = value.trim()
    if (!trimmed) return ""

    const url = normalizeWebUrl(trimmed, httpsOnly)
    if (!url) {
      nextErrors[field] = httpsOnly
        ? `${label} must be a valid https:// URL without login details or a # fragment.`
        : `${label} must be a valid http:// or https:// URL without login details or a # fragment.`
    }

    return url
  }

  const validateMints = (nextErrors: FieldErrors) => {
    const normalizedMints: CommunityMint[] = []

    for (const [index, line] of splitLines(mints).entries()) {
      const [urlValue, type, extra] = line.split(/\s+/)
      const url = normalizeWebUrl(urlValue || "", true)

      if (!url || extra || (type && !/^[\x21-\x7e]{1,32}$/.test(type))) {
        nextErrors.mints = `Line ${index + 1} must use: https://mint.example.com optional-type.`
        continue
      }

      normalizedMints.push({url, type})
    }

    return normalizedMints
  }

  const validateEmailDigestServiceFields = (
    nextErrors: FieldErrors,
    updateValues = false,
  ): CommunityEmailDigestService | undefined => {
    const fieldNames = [
      "emailDigestServicePubkey",
      "emailDigestRequestRelay",
      "emailDigestHandlerAddress",
      "emailDigestHandlerRelay",
    ]
    for (const field of fieldNames) delete nextErrors[field]

    const servicePubkeyValue = emailDigestServicePubkey.trim()
    const requestRelayValue = emailDigestRequestRelay.trim()
    const handlerAddressValue = emailDigestHandlerAddress.trim()
    const handlerRelayValue = emailDigestHandlerRelay.trim()
    if (!servicePubkeyValue && !requestRelayValue && !handlerAddressValue && !handlerRelayValue) {
      return undefined
    }

    const normalizedServicePubkey = isHexPubkey(servicePubkeyValue)
      ? servicePubkeyValue.toLowerCase()
      : ""
    const normalizedRequestRelay = normalizeCommunityServiceRelay(requestRelayValue)
    const normalizedHandlerAddress =
      normalizeCommunityEmailDigestHandlerAddress(handlerAddressValue)
    const normalizedHandlerRelay = normalizeCommunityServiceRelay(handlerRelayValue)

    if (!servicePubkeyValue) {
      nextErrors.emailDigestServicePubkey = "Service pubkey is required when adding a provider."
    } else if (!normalizedServicePubkey) {
      nextErrors.emailDigestServicePubkey = "Service pubkey must be 64 hexadecimal characters."
    }
    if (!requestRelayValue) {
      nextErrors.emailDigestRequestRelay =
        "Request/status relay is required when adding a provider."
    } else if (!normalizedRequestRelay) {
      nextErrors.emailDigestRequestRelay = "Request/status relay must be a valid wss:// URL."
    }
    if (!handlerAddressValue) {
      nextErrors.emailDigestHandlerAddress = "Handler address is required when adding a provider."
    } else if (!normalizedHandlerAddress) {
      nextErrors.emailDigestHandlerAddress =
        "Handler address must use 31990:<64hex pubkey>:<nonempty id>."
    }
    if (!handlerRelayValue) {
      nextErrors.emailDigestHandlerRelay = "Handler relay is required when adding a provider."
    } else if (!normalizedHandlerRelay) {
      nextErrors.emailDigestHandlerRelay = "Handler relay must be a valid wss:// URL."
    }

    if (updateValues) {
      if (normalizedServicePubkey) emailDigestServicePubkey = normalizedServicePubkey
      if (normalizedRequestRelay) emailDigestRequestRelay = normalizedRequestRelay
      if (normalizedHandlerAddress) emailDigestHandlerAddress = normalizedHandlerAddress
      if (normalizedHandlerRelay) emailDigestHandlerRelay = normalizedHandlerRelay
    }

    return normalizeCommunityEmailDigestService({
      servicePubkey: servicePubkeyValue,
      requestRelay: requestRelayValue,
      handlerAddress: handlerAddressValue,
      handlerRelay: handlerRelayValue,
    })
  }

  const validateCommunityAlertServiceFields = (
    nextErrors: FieldErrors,
    updateValues = false,
  ): CommunityAlertService | undefined => {
    const fieldNames = [
      "communityAlertServicePubkey",
      "communityAlertRequestRelay",
      "communityAlertHandlerAddress",
      "communityAlertHandlerRelay",
    ]
    for (const field of fieldNames) delete nextErrors[field]

    const servicePubkeyValue = communityAlertServicePubkey.trim()
    const requestRelayValue = communityAlertRequestRelay.trim()
    const handlerAddressValue = communityAlertHandlerAddress.trim()
    const handlerRelayValue = communityAlertHandlerRelay.trim()
    if (!servicePubkeyValue && !requestRelayValue && !handlerAddressValue && !handlerRelayValue) {
      return undefined
    }

    const normalizedServicePubkey = isHexPubkey(servicePubkeyValue)
      ? servicePubkeyValue.toLowerCase()
      : ""
    const normalizedRequestRelay = normalizeCommunityServiceRelay(requestRelayValue)
    const normalizedHandlerAddress = normalizeCommunityAlertHandlerAddress(handlerAddressValue)
    const normalizedHandlerRelay = normalizeCommunityServiceRelay(handlerRelayValue)

    if (!servicePubkeyValue) {
      nextErrors.communityAlertServicePubkey = "Service pubkey is required when adding a provider."
    } else if (!normalizedServicePubkey) {
      nextErrors.communityAlertServicePubkey = "Service pubkey must be 64 hexadecimal characters."
    }
    if (!requestRelayValue) {
      nextErrors.communityAlertRequestRelay =
        "Request/status relay is required when adding a provider."
    } else if (!normalizedRequestRelay) {
      nextErrors.communityAlertRequestRelay = "Request/status relay must be a valid wss:// URL."
    }
    if (!handlerAddressValue) {
      nextErrors.communityAlertHandlerAddress =
        "Handler address is required when adding a provider."
    } else if (!normalizedHandlerAddress) {
      nextErrors.communityAlertHandlerAddress =
        "Handler address must use 31990:<64hex pubkey>:<nonempty id>."
    }
    if (!handlerRelayValue) {
      nextErrors.communityAlertHandlerRelay = "Handler relay is required when adding a provider."
    } else if (!normalizedHandlerRelay) {
      nextErrors.communityAlertHandlerRelay = "Handler relay must be a valid wss:// URL."
    }

    if (updateValues) {
      if (normalizedServicePubkey) communityAlertServicePubkey = normalizedServicePubkey
      if (normalizedRequestRelay) communityAlertRequestRelay = normalizedRequestRelay
      if (normalizedHandlerAddress) communityAlertHandlerAddress = normalizedHandlerAddress
      if (normalizedHandlerRelay) communityAlertHandlerRelay = normalizedHandlerRelay
    }

    return normalizeCommunityAlertService({
      servicePubkey: servicePubkeyValue,
      requestRelay: requestRelayValue,
      handlerAddress: handlerAddressValue,
      handlerRelay: handlerRelayValue,
    })
  }

  const setFieldError = (field: string, message = "") => {
    const nextErrors = {...errors}

    if (message) nextErrors[field] = message
    else delete nextErrors[field]

    errors = nextErrors
  }

  const validateTosFields = () => {
    const trimmedTosRef = tosRef.trim()
    const normalizedTosRelay = normalizeDefinitionRelay(tosRelay)

    if (tosRelay.trim() && normalizedTosRelay) tosRelay = normalizedTosRelay
    setFieldError(
      "tosRelay",
      tosRelay.trim() && !normalizedTosRelay ? "Terms relay must be a valid wss:// relay URL." : "",
    )
    setFieldError(
      "tosRef",
      tosRelay.trim() && !trimmedTosRef
        ? "Add a terms reference or clear the terms relay."
        : trimmedTosRef && !isCommunityDefinitionReference(trimmedTosRef)
          ? "Use a 64-character event ID or an address like 30023:<pubkey>:<identifier>."
          : "",
    )
  }

  const validateSectionNames = (drafts = sectionDrafts) => {
    const nextErrors = Object.fromEntries(
      Object.entries(errors).filter(([key]) => !key.match(/^section-\d+-name$/)),
    )
    const seenNames = new Map<string, number>()

    for (const [sectionIndex, section] of drafts.entries()) {
      const name = section.name.trim()
      const nameKey = getSectionNameKey(name)
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
        setFieldError(
          field,
          !name.trim()
            ? "Community name is required."
            : utf8Length(name.trim()) > 100
              ? "Community name must be 100 characters or fewer."
              : "",
        )
        break
      case "description":
        setFieldError(
          field,
          utf8Length(description.trim()) > 4096
            ? "Description must be 4,096 characters or fewer."
            : "",
        )
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
        const normalized = validateWebUrlField(picture, field, "Picture URL", {}, true)
        if (normalized) picture = normalized
        setFieldError(
          field,
          picture.trim() && !normalized
            ? "Picture URL must be a valid https:// URL without login details or a # fragment."
            : "",
        )
        break
      }
      case "primaryRelay": {
        const normalized = normalizeDefinitionRelay(primaryRelay)
        if (normalized) primaryRelay = normalized
        setFieldError(
          field,
          normalized ? "" : "Enter a secure relay URL, like wss://relay.example.com.",
        )
        break
      }
      case "extraRelays": {
        const nextErrors: FieldErrors = {}
        const normalized = validateRelayLines(extraRelays, field, nextErrors)
        if (
          !nextErrors[field] &&
          normalizeDefinitionRelays([primaryRelay, ...normalized]).length > 20
        ) {
          nextErrors[field] = "A community can use no more than 20 relays."
        }
        if (!nextErrors[field]) extraRelays = normalized.join("\n")
        setFieldError(field, nextErrors[field] || "")
        break
      }
      case "blossomServers": {
        if (splitLines(blossomServers).length > 20) {
          setFieldError(field, "Add no more than 20 Blossom servers.")
          break
        }
        const normalized = splitLines(blossomServers)
          .map((server, index) => {
            const url = normalizeWebUrl(server, true)
            if (!url) setFieldError(field, `Line ${index + 1} must be a valid https:// URL.`)
            return url
          })
          .filter(Boolean)
        if (normalized.length === splitLines(blossomServers).length) {
          blossomServers = normalized.join("\n")
          setFieldError(field)
        }
        break
      }
      case "graspServers": {
        if (splitLines(graspServers).length > 20) {
          setFieldError(field, "Add no more than 20 GRASP servers.")
          break
        }
        const normalized = splitLines(graspServers)
          .map((server, index) => {
            const url = normalizeDefinitionRelay(server)
            if (!url) {
              setFieldError(field, `Line ${index + 1} must be a valid wss:// URL.`)
            }
            return url
          })
          .filter(Boolean)
        if (normalized.length === splitLines(graspServers).length) {
          graspServers = normalized.join("\n")
          setFieldError(field)
        }
        break
      }
      case "emailDigestServicePubkey":
      case "emailDigestRequestRelay":
      case "emailDigestHandlerAddress":
      case "emailDigestHandlerRelay": {
        const nextErrors = {...errors}
        validateEmailDigestServiceFields(nextErrors, true)
        errors = nextErrors
        break
      }
      case "communityAlertServicePubkey":
      case "communityAlertRequestRelay":
      case "communityAlertHandlerAddress":
      case "communityAlertHandlerRelay": {
        const nextErrors = {...errors}
        validateCommunityAlertServiceFields(nextErrors, true)
        errors = nextErrors
        break
      }
      case "mints": {
        const nextErrors: FieldErrors = {}
        if (splitLines(mints).length > 20) {
          setFieldError(field, "Add no more than 20 mint declarations.")
          break
        }
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
      case "location":
        setFieldError(
          field,
          utf8Length(location.trim()) > 256 ? "Location must be 256 characters or fewer." : "",
        )
        break
      case "geohash": {
        const normalized = normalizeGeohash(geohash)
        if (normalized) geohash = normalized
        setFieldError(
          field,
          geohash.trim() && (!normalized || normalized.length > 12)
            ? "Geohash must contain 1 to 12 base32 characters; an optional geo: prefix is accepted."
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
      const nameKey = getSectionNameKey(name)
      const kinds: CommunityDefinitionSectionKind[] = []

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

  const ensureSectionAuthorities = ({sections}: {sections: CommunityDefinitionSectionInput[]}) => {
    const nextSections: CommunityDefinitionSectionInput[] = []
    const newProfileLists: NewProfileList[] = []

    for (const section of sections) {
      const profileLists = [...section.profileLists]
      const badges = [...(section.badges || [])]

      nextSections.push({...section, profileLists, badges})
    }

    return {sections: nextSections, newProfileLists}
  }

  const validateForm = (): ValidatedSetup | undefined => {
    const nextErrors: FieldErrors = {}
    const community = fromCurrentSession()
    const trimmedName = name.trim()
    const normalizedPrimaryRelay = normalizeDefinitionRelay(primaryRelay)
    const normalizedExtraRelays = validateRelayLines(extraRelays, "extraRelays", nextErrors)
    const relays = normalizeDefinitionRelays([normalizedPrimaryRelay, ...normalizedExtraRelays])
    const normalizedWebsite = validateWebUrlField(website, "website", "Website", nextErrors)
    const normalizedPicture = validateWebUrlField(
      picture,
      "picture",
      "Picture URL",
      nextErrors,
      true,
    )
    const normalizedBlossomServers = splitLines(blossomServers)
      .map((server, index) => {
        const url = normalizeWebUrl(server, true)
        if (!url) nextErrors.blossomServers = `Line ${index + 1} must be a valid https:// URL.`
        return url
      })
      .filter(Boolean)
    const normalizedGraspServers = splitLines(graspServers)
      .map((server, index) => {
        const url = normalizeDefinitionRelay(server)
        if (!url) {
          nextErrors.graspServers = `Line ${index + 1} must be a valid wss:// URL.`
        }
        return url
      })
      .filter(Boolean)
    const normalizedEmailDigestService = validateEmailDigestServiceFields(nextErrors)
    const normalizedCommunityAlertService = validateCommunityAlertServiceFields(nextErrors)
    const normalizedMints = validateMints(nextErrors)
    const trimmedTosRef = tosRef.trim()
    const normalizedTosRelay = normalizeDefinitionRelay(tosRelay)
    const normalizedGeohash = normalizeGeohash(geohash)
    const normalizedSections = normalizeSectionDrafts(nextErrors)
    const exactDefinition = $activeExactCommunityDefinition

    if (!community) nextErrors.auth = "Log in with the community owner first."
    if (isEdit && !exactDefinition) {
      nextErrors.auth = "Load the exact community definition before publishing updates."
    } else if (
      isEdit &&
      community &&
      exactDefinition &&
      community.pubkey !== exactDefinition.ownerPubkey
    ) {
      nextErrors.auth = "Only the community owner can publish community definition updates."
    }
    if (!trimmedName) nextErrors.name = "Community name is required."
    else if (utf8Length(trimmedName) > 100) {
      nextErrors.name = "Community name must be 100 characters or fewer."
    }
    if (utf8Length(description.trim()) > 4096) {
      nextErrors.description = "Description must be 4,096 characters or fewer."
    }
    if (!normalizedPrimaryRelay) {
      nextErrors.primaryRelay = "Enter a secure relay URL, like wss://relay.example.com."
    }
    if (relays.length > 20) {
      nextErrors.extraRelays = "A community can use no more than 20 relays."
    }
    if (splitLines(blossomServers).length > 20) {
      nextErrors.blossomServers = "Add no more than 20 Blossom servers."
    }
    if (splitLines(graspServers).length > 20) {
      nextErrors.graspServers = "Add no more than 20 GRASP servers."
    }
    if (splitLines(mints).length > 20) {
      nextErrors.mints = "Add no more than 20 mint declarations."
    }
    if (tosRelay.trim() && !normalizedTosRelay) {
      nextErrors.tosRelay = "Terms relay must be a valid wss:// relay URL."
    }
    if (tosRelay.trim() && !trimmedTosRef) {
      nextErrors.tosRef = "Add a terms reference or clear the terms relay."
    } else if (trimmedTosRef && !isCommunityDefinitionReference(trimmedTosRef)) {
      nextErrors.tosRef =
        "Use a 64-character event ID or an address like 30023:<pubkey>:<identifier>."
    }
    if (utf8Length(location.trim()) > 256) {
      nextErrors.location = "Location must be 256 characters or fewer."
    }
    if (geohash.trim() && (!normalizedGeohash || normalizedGeohash.length > 12)) {
      nextErrors.geohash =
        "Geohash must contain 1 to 12 base32 characters; an optional geo: prefix is accepted."
    }

    errors = nextErrors

    if (Object.keys(nextErrors).length > 0 || !community || relays.length === 0) {
      pushToast({theme: "error", message: "Review the highlighted fields before publishing."})
      return undefined
    }

    const authority = ensureSectionAuthorities({
      sections: normalizedSections,
    })
    const bootstrapGrants = isEdit
      ? applyCommunityBootstrapGrants({
          sections: authority.sections,
          communityId: exactDefinition?.communityId || community.pubkey,
          ownerPubkey: community.pubkey,
          profileListPubkey: community.pubkey,
          relays,
          profileListEvents: $activeCommunityProfileListEvents,
          grants: bootstrapGrantDrafts,
        })
      : {sections: authority.sections, profileListUpdates: []}

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
      graspServers: normalizedGraspServers,
      emailDigestServices: [
        ...(normalizedEmailDigestService ? [normalizedEmailDigestService] : []),
        ...additionalEmailDigestServices,
      ],
      communityAlertServices: [
        ...(normalizedCommunityAlertService ? [normalizedCommunityAlertService] : []),
        ...additionalCommunityAlertServices,
      ],
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

  const dedupeProfileListRefs = (refs: CommunityDefinitionProfileListRef[]) =>
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

      const purpose = getCommunitySectionPurpose(definition.communityId, section)
      const identifier = purpose
        ? makeCommunityProfileListIdentifier(definition.communityId, purpose)
        : undefined
      if (!identifier) continue
      const setupProfileList: CommunityDefinitionProfileListRef = {
        address: `${PROFILE_LIST_KIND}:${owner}:${identifier}`,
        ...(validated.relays[0] ? {relay: validated.relays[0]} : {}),
      }
      const sourceProfileListAddresses = new Set(
        sourceNames.flatMap(sectionName =>
          (getOriginalSection(sectionName)?.profileLists || []).map(ref => ref.address),
        ),
      )
      const moderatorRefs = uniqueNormalizedPubkeys(
        sourceNames.flatMap(getActiveSectionModeratorPubkeys),
      ).map(moderatorPubkey =>
        makeManualModeratorProfileListRef({
          communityId: definition.communityId,
          moderatorPubkey,
          sectionName: section.name,
          relays: validated.relays,
        }),
      )
      const migratedPubkeys = uniqueNormalizedPubkeys(
        sourceNames.flatMap(getActiveSectionMemberPubkeys),
      ).filter(pubkey => pubkey !== owner)

      sections[sectionIndex] = {
        ...section,
        profileLists: dedupeProfileListRefs([
          ...section.profileLists.filter(ref => !sourceProfileListAddresses.has(ref.address)),
          ...(migratedPubkeys.length > 0 ? [setupProfileList] : []),
          ...moderatorRefs,
        ]),
      }
      if (migratedPubkeys.length > 0) {
        profileListUpdates.push({profileList: setupProfileList, pubkeys: migratedPubkeys})
      }
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
      if (!sourceForm || !$activeExactCommunityPointer) continue

      const draft = makeAdmissionFormDraftFromForm({
        form: sourceForm,
        community: $activeExactCommunityPointer,
        sectionName: section.name,
      })

      copiedFormDestinations.add(destinationKey)
      formTemplates.push(
        makeAdmissionFormTemplate({
          identifier: draft.identifier,
          community: $activeExactCommunityPointer,
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
      const review = parseCommunityReportReviewLabel(event)
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
          community: review.community,
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
        `${summary.moderatorPubkeys.length} existing moderator${summary.moderatorPubkeys.length === 1 ? "" : "s"} will need to accept migrated permissions`,
      )
    }
    if (summary.draftModeratorInvitePubkeys.length > 0) {
      items.push(
        `${summary.draftModeratorInvitePubkeys.length} draft moderator invite${summary.draftModeratorInvitePubkeys.length === 1 ? "" : "s"} will be published with this update`,
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

  const performCommunityCreate = async (
    validated: ValidatedSetup,
    reportStatus: CommunityPublishStatusUpdate,
  ) => {
    const rootRelays = getCommunityRootPublishRelays(validated.relays, validated.community.pubkey)
    let prerequisiteCount = 0

    const result = await createCommunity({
      operationId: communityCreateOperationId,
      ownerPubkey: validated.community.pubkey,
      sign: template => makeSignedEvent(validated.community, template),
      validateDefinition: event => Boolean(parseCommunityDefinition(event)),
      publishAndVerifyExact: event => {
        const activation = event.kind === COMMUNITY_DEFINITION_KIND
        const label = activation
          ? "community definition"
          : `community prerequisite ${++prerequisiteCount}`

        return publishAndVerifyCommunityEvent({
          event,
          relays: activation ? rootRelays : validated.relays,
          requiredRelay: validated.primaryRelay,
          label,
          setStatus: reportStatus,
        })
      },
      buildArtifacts: communityId => {
        const bootstrap = applyCommunityBootstrapGrants({
          sections: validated.sections,
          communityId,
          ownerPubkey: validated.community.pubkey,
          profileListPubkey: validated.community.pubkey,
          relays: validated.relays,
          grants: bootstrapGrantDrafts,
        })
        const createdAt = getNextReplacementCreatedAt([])
        const prerequisites = bootstrap.profileListUpdates.map(update => ({
          ...makeCommunityProfileList({profileList: update.profileList, pubkeys: update.pubkeys}),
          created_at: createdAt,
        }))
        const services = [
          ...validated.emailDigestServices.map(service => ({
            name: "email-digest",
            pubkey: service.servicePubkey,
            requestRelay: service.requestRelay,
            handlerAddress: service.handlerAddress,
            handlerRelay: service.handlerRelay,
          })),
          ...validated.communityAlertServices.map(service => ({
            name: "community-alerts",
            pubkey: service.servicePubkey,
            requestRelay: service.requestRelay,
            handlerAddress: service.handlerAddress,
            handlerRelay: service.handlerRelay,
          })),
        ]

        return {
          prerequisites,
          definition: {
            ...buildCommunityDefinition({
              communityId,
              name: validated.name,
              description: validated.description || undefined,
              website: validated.website || undefined,
              picture: validated.picture || undefined,
              relays: validated.relays,
              blossomServers: validated.blossomServers,
              graspServers: validated.graspServers,
              mints: validated.mints,
              terms: validated.tos
                ? {reference: validated.tos.ref, relay: validated.tos.relay}
                : undefined,
              location: validated.location || undefined,
              geohash: validated.geohash || undefined,
              services,
              sections: bootstrap.sections.map(section => ({
                name: section.name,
                kinds: section.kinds,
                profileLists: section.profileLists.map(ref => ({
                  address: ref.address,
                  relay: ref.relay,
                })),
                badges: (section.badges || []).map(ref => ({...ref})),
                retention: section.retention,
              })),
            }),
            created_at: createdAt,
          },
        }
      },
    })

    for (const event of result.verifiedEvents) repository.publish(event)
    const parsedDefinition = parseCommunityDefinition(result.definition)
    if (!parsedDefinition) throw new Error("Verified community definition was invalid.")

    clearCommunityBootstrapCache(parsedDefinition.pointer.address)
    setActiveExactCommunityDefinition(parsedDefinition)
    bootstrapGrantDrafts = []
    reportStatus("Community creation verified on relay.")
    pushToast({theme: "success", message: "Community created."})
    goto(makeExactCommunityPath(parsedDefinition.pointer))
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
      if (!isEdit) {
        await performCommunityCreate(validated, reportStatus)
        return
      }

      const migration = migrate
        ? applySectionMigration(validated, summary)
        : {
            sections: validated.sections,
            profileListUpdates: validated.profileListUpdates,
            formTemplates: [],
            reportReviewLabels: [],
          }
      const exactDefinition = $activeExactCommunityDefinition
      if (!exactDefinition) throw new Error("The exact community definition is not loaded.")
      if (validated.community.pubkey !== exactDefinition.ownerPubkey) {
        throw new Error("The active signer is not this community.s owner.")
      }
      const createdAt = getNextReplacementCreatedAt([])
      const services = [
        ...exactDefinition.services.filter(
          service => service.name !== "email-digest" && service.name !== "community-alerts",
        ),
        ...validated.emailDigestServices.map(service => ({
          name: "email-digest",
          pubkey: service.servicePubkey,
          requestRelay: service.requestRelay,
          handlerAddress: service.handlerAddress,
          handlerRelay: service.handlerRelay,
        })),
        ...validated.communityAlertServices.map(service => ({
          name: "community-alerts",
          pubkey: service.servicePubkey,
          requestRelay: service.requestRelay,
          handlerAddress: service.handlerAddress,
          handlerRelay: service.handlerRelay,
        })),
      ]
      const rebuiltDefinition = buildCommunityDefinition({
        communityId: exactDefinition.communityId,
        name: validated.name,
        description: validated.description || undefined,
        website: validated.website || undefined,
        picture: validated.picture || undefined,
        banner: exactDefinition.metadata.banner,
        relays: validated.relays,
        blossomServers: validated.blossomServers,
        graspServers: validated.graspServers,
        mints: validated.mints,
        terms: validated.tos
          ? {reference: validated.tos.ref, relay: validated.tos.relay}
          : undefined,
        location: validated.location || undefined,
        geohash: validated.geohash || undefined,
        services,
        sections: migration.sections.map(section => ({
          name: section.name,
          kinds: section.kinds,
          profileLists: section.profileLists.map(ref => ({
            address: ref.address,
            relay: ref.relay,
          })),
          badges: (section.badges || []).map(ref => ({...ref})),
          retention: section.retention,
        })),
      })
      const originalSectionNames = Object.fromEntries(
        sectionDrafts.flatMap(section =>
          section.originalNameKey
            ? [[getSectionNameKey(section.name), section.originalNameKey] as const]
            : [],
        ),
      )
      const communityDefinition = {
        ...updateCommunityDefinition(
          exactDefinition,
          {
            name: validated.name,
            description: validated.description || undefined,
            website: validated.website || undefined,
            picture: validated.picture || undefined,
            location: validated.location || undefined,
            geohash: validated.geohash || undefined,
          },
          {replacement: rebuiltDefinition, originalSectionNames},
        ),
        created_at: getNextReplacementCreatedAt([exactDefinition.event], createdAt),
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
      const signedDefinition = await makeSignedEvent(validated.community, communityDefinition)
      const parsedSignedDefinition = parseCommunityDefinition(signedDefinition)
      if (
        !parsedSignedDefinition ||
        parsedSignedDefinition.pointer.address !== exactDefinition.pointer.address
      ) {
        throw new Error("Community definition failed protocol validation before publication.")
      }
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

      const verifiedDefinition = await publishAndVerifyCommunityEvent({
        event: signedDefinition,
        relays: rootRelays,
        requiredRelay: validated.primaryRelay,
        label: "community definition",
        setStatus: reportStatus,
      })
      verifiedEvents.push(verifiedDefinition)

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

      const parsedDefinition = parseCommunityDefinition(verifiedDefinition)
      if (
        !parsedDefinition ||
        parsedDefinition.pointer.address !== exactDefinition.pointer.address
      ) {
        throw new Error("Verified community definition did not preserve the exact address.")
      }
      clearCommunityBootstrapCache(exactDefinition.pointer.address)
      setActiveExactCommunityDefinition(parsedDefinition)
      bootstrapGrantDrafts = []
      keptImmediateWarningKeys = []
      reportStatus("Community update verified on relay.")
      pushToast({theme: "success", message: "Community settings updated."})
      goto(makeExactCommunityPath(parsedDefinition.pointer))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error("Community settings publication failed", error)
      const friendlyMessage = /signer|sign\b/i.test(message)
        ? "The community owner could not sign the update. Check the active signer and try again."
        : /accepted but|verified relay|readback|replacement event/i.test(message)
          ? "The update was sent but could not be confirmed on the primary relay. Try again or check that relay."
          : !publishStatus
            ? "The community settings could not be prepared for publication. Review the settings and try again."
            : /invalid|valid normalized|format/i.test(message)
              ? "One or more settings have an incorrect format. Review the highlighted fields and try again."
              : "The primary relay did not accept or confirm the update. Check its availability and your access, then try again."
      publishStatus = friendlyMessage
      pushToast({
        theme: "error",
        message: `${isEdit ? "Community update" : "Community setup"} failed: ${friendlyMessage}`,
      })
      throw error
    } finally {
      loading = false
    }
  }

  const cancel = () =>
    goto(
      isEdit && $activeExactCommunityDefinition
        ? makeExactCommunityPath($activeExactCommunityDefinition.pointer)
        : "/explore",
    )

  const applyOriginalDraftState = () => {
    if (!originalDraftState) return

    name = originalDraftState.name
    description = originalDraftState.description
    website = originalDraftState.website
    picture = originalDraftState.picture
    primaryRelay = originalDraftState.primaryRelay
    extraRelays = originalDraftState.extraRelays
    blossomServers = originalDraftState.blossomServers
    graspServers = originalDraftState.graspServers
    emailDigestServicePubkey = originalDraftState.emailDigestServicePubkey
    emailDigestRequestRelay = originalDraftState.emailDigestRequestRelay
    emailDigestHandlerAddress = originalDraftState.emailDigestHandlerAddress
    emailDigestHandlerRelay = originalDraftState.emailDigestHandlerRelay
    additionalEmailDigestServices = originalDraftState.additionalEmailDigestServices.map(
      service => ({
        ...service,
      }),
    )
    communityAlertServicePubkey = originalDraftState.communityAlertServicePubkey
    communityAlertRequestRelay = originalDraftState.communityAlertRequestRelay
    communityAlertHandlerAddress = originalDraftState.communityAlertHandlerAddress
    communityAlertHandlerRelay = originalDraftState.communityAlertHandlerRelay
    additionalCommunityAlertServices = originalDraftState.additionalCommunityAlertServices.map(
      service => ({...service}),
    )
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

    const draft = sectionDrafts[sectionIndex]
    const originalSection = getOriginalSectionByKey(draft?.originalNameKey)
    if (!originalSection || !draft) return

    const draftKey = draft.draftKey
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
        sectionDrafts = sectionDrafts.map(section =>
          section.draftKey === draftKey ? {...section, name: originalName} : section,
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
    const sectionOriginalNameKey = section.originalNameKey || ""
    const applyUpdate = () => applySectionKindUpdate(sectionIndex, kindIndex, update)

    if (
      nextAssignment &&
      getSectionNameKey(nextAssignment.sectionName) !== sectionOriginalNameKey
    ) {
      applyUpdate()
      showImmediateWarning({
        key: `move:${nextKindKey}:${getSectionNameKey(nextAssignment.sectionName)}>${section.draftKey}`,
        title: "Move permission?",
        description: `${nextAssignment.label} was moved from ${nextAssignment.sectionName} to ${section.name}.`,
        details: [
          "People who could publish this content before may need migrated access to the new section.",
          "Existing moderators for the old section will need to accept migrated permissions after publish.",
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

  const focusError = async (field: string) => {
    if (!field) return

    const sectionMatch = field.match(/^section-(\d+)-/)
    if (sectionMatch) expandedSectionIndex = Number(sectionMatch[1])
    await tick()
    if (!browser) return

    const control = document.getElementById(controlId(field))
    const details = control?.closest("details")
    if (details instanceof HTMLDetailsElement) details.open = true
    await tick()

    const focusTarget = document.getElementById(controlId(field)) || errorSummaryElement
    focusTarget?.scrollIntoView({behavior: "smooth", block: "center"})
    focusTarget?.focus({preventScroll: true})
  }

  const focusFirstError = () => focusError(Object.keys(errors)[0] || "")

  const submitCommunitySettings = async () => {
    const validated = validateForm()
    if (!validated) {
      await focusFirstError()
      return
    }

    name = validated.name
    description = validated.description
    website = validated.website
    picture = validated.picture
    primaryRelay = validated.primaryRelay
    extraRelays = validated.extraRelays.join("\n")
    blossomServers = validated.blossomServers.join("\n")
    graspServers = validated.graspServers.join("\n")
    validateEmailDigestServiceFields({}, true)
    validateCommunityAlertServiceFields({}, true)
    mints = validated.mints.map(mint => [mint.url, mint.type].filter(Boolean).join(" ")).join("\n")
    tosRef = validated.tos?.ref || ""
    tosRelay = validated.tos?.relay || ""
    location = validated.location
    geohash = validated.geohash

    const summary = buildSectionMigrationSummary(makeSectionInputsFromDrafts(sectionDrafts))
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
      const nameKey = getSectionNameKey(name)
      const existing = sectionDrafts.find(
        section =>
          section.originalNameKey === nameKey || getSectionNameKey(section.name) === nameKey,
      )
      const originalSection = getOriginalSectionByKey(nameKey)
      const originalNameKey = existing?.originalNameKey || (originalSection ? nameKey : undefined)

      return {
        draftKey:
          existing?.draftKey ||
          (originalSection
            ? makeOriginalSectionDraftKey(originalSection.name)
            : makeDefaultSectionDraftKey(name)),
        originalNameKey,
        name,
        kinds: getDefaultCommunitySectionKinds(name).map(toKindDraft),
        profileLists: existing?.profileLists || originalSection?.profileLists || [],
        badges: existing?.badges || originalSection?.badges || [],
        retention: existing?.retention || originalSection?.retention || [],
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

    if (getOriginalSectionByKey(removedSection.originalNameKey)) {
      showDestructiveConfirm({
        title: "Remove section?",
        description: `Remove ${removedSection.name} from this community draft?`,
        details: [
          "People with permissions for this section will lose them when the update is published.",
          "Pending requests for this section will not be migrated.",
        ],
        confirmLabel: "Remove section",
        onConfirm: () => {
          const currentIndex = sectionDrafts.findIndex(
            section => section.draftKey === removedSection.draftKey,
          )
          if (currentIndex >= 0) removeSectionAtIndex(currentIndex)
        },
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
    const normalized = normalizeDefinitionRelay(url)
    if (!normalized) return

    const currentPrimary = normalizeDefinitionRelay(primaryRelay)
    const currentExtras = normalizeDefinitionRelays(splitLines(extraRelays))

    if (currentPrimary === normalized || currentExtras.includes(normalized)) return

    if (!currentPrimary) {
      primaryRelay = normalized
      setFieldError("primaryRelay")
      return
    }

    extraRelays = normalizeDefinitionRelays([...currentExtras, normalized]).join("\n")
    setFieldError("extraRelays")
  }

  const getPictureUploadTargetOptions = () => {
    const servers = splitLines(blossomServers)
    const normalizedServers: string[] = []

    if (servers.length > 20) {
      setFieldError("blossomServers", "Add no more than 20 Blossom servers.")
      return undefined
    }

    for (const [index, server] of servers.entries()) {
      const normalized = normalizeWebUrl(server, true)

      if (!normalized) {
        setFieldError("blossomServers", `Line ${index + 1} must be a valid https:// URL.`)
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
  let graspServers = $state("")
  let emailDigestServicePubkey = $state("")
  let emailDigestRequestRelay = $state("")
  let emailDigestHandlerAddress = $state("")
  let emailDigestHandlerRelay = $state("")
  let additionalEmailDigestServices = $state<CommunityEmailDigestService[]>([])
  let communityAlertServicePubkey = $state("")
  let communityAlertRequestRelay = $state("")
  let communityAlertHandlerAddress = $state("")
  let communityAlertHandlerRelay = $state("")
  let additionalCommunityAlertServices = $state<CommunityAlertService[]>([])
  let mints = $state("")
  let tosRef = $state("")
  let tosRelay = $state("")
  let location = $state("")
  let geohash = $state("")
  let pictureUploadStage = $state<BlossomUploadStage>("idle")
  let sectionDrafts = $state<SectionDraft[]>(makeDefaultSectionDrafts())
  let bootstrapGrantDrafts = $state<CommunityBootstrapGrantDraft[]>([])
  let expandedSectionIndex = $state(0)
  let initializedKey = $state("")
  let errors = $state<FieldErrors>({})
  let errorSummaryElement = $state<HTMLElement>()
  let originalDraftState = $state<OriginalDraftState | undefined>()
  let keptImmediateWarningKeys = $state<string[]>([])

  const isEdit = $derived(mode === "edit")
  const disabled = $derived(loading ? true : undefined)
  const actionLabel = $derived(isEdit ? "Update" : "Create")
  const title = $derived(isEdit ? "Edit community settings." : "Create a BudaBit community.")
  const eyebrow = $derived(isEdit ? "Community Admin" : "Community Setup")
  const activeCommunityPubkey = $derived(definition?.ownerPubkey || $pubkey || "")
  const login = () => pushModal(LogIn)
  const pictureUploading = $derived(!["idle", "ready", "failed"].includes(pictureUploadStage))
  const activeCommunityRelays = $derived.by(() =>
    normalizeDefinitionRelays([primaryRelay, ...splitLines(extraRelays)]),
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
  const recommendedCommunityRelays = $derived.by(() => {
    const active = new Set(activeCommunityRelays)

    return RECOMMENDED_COMMUNITY_RELAYS.filter(relay => !active.has(relay))
  })

  $effect(() => {
    const activePubkey = $pubkey || ""
    const nextKey = isEdit
      ? `edit:${$activeExactCommunityDefinition?.event.id || ""}`
      : `create:${activePubkey}`

    if (!nextKey || initializedKey === nextKey) return
    if (isEdit && (!definition || !$activeExactCommunityDefinition)) return

    initializedKey = nextKey
    errors = {}

    if (isEdit && definition) {
      originalDraftState = makeOriginalDraftState(definition)
      applyOriginalDraftState()
      return
    }

    name = ""
    description = ""
    website = ""
    picture = ""
    primaryRelay = ""
    extraRelays = ""
    blossomServers = ""
    graspServers = ""
    emailDigestServicePubkey = ""
    emailDigestRequestRelay = ""
    emailDigestHandlerAddress = ""
    emailDigestHandlerRelay = ""
    additionalEmailDigestServices = []
    communityAlertServicePubkey = ""
    communityAlertRequestRelay = ""
    communityAlertHandlerAddress = ""
    communityAlertHandlerRelay = ""
    additionalCommunityAlertServices = []
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
  novalidate
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
              Publish the community definition. Your logged-in account becomes its owner.
            {/if}
          </p>
          <div class="mt-6 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <a
              class="btn btn-outline btn-primary w-full sm:w-auto"
              href={COMMUNITY_EXPLAINER_PATH}
              target="_blank"
              rel="noopener noreferrer">
              How communities work
            </a>
            <span class="self-center text-xs opacity-60">Opens in a new tab</span>
          </div>
        </div>
        <div
          id={controlId("auth")}
          tabindex="-1"
          class="min-w-0 rounded-2xl border border-warning/35 bg-warning/15 p-4 text-sm leading-relaxed text-base-content shadow-sm shadow-warning/5">
          <strong class="block text-base font-semibold text-warning">Community signer</strong>
          <span class="mt-1 block text-base-content/80">
            {#if activeCommunityPubkey}
              <span class="mb-3 block">Publishing as</span>
              <Profile pubkey={activeCommunityPubkey} avatarSize={9} showPubkey />
              <span class="mt-3 block">
                The active signer shown here controls and publishes this definition. Keep the owner
                key in cold storage and sign with it
                <a
                  class="link font-medium"
                  href="https://nostrapps.com#signers"
                  target="_blank"
                  rel="noopener noreferrer">remotely</a
                >.
              </span>
            {:else}
              Log in with the npub that should control this community.
            {/if}
          </span>
        </div>
      </div>
    </section>

    <div class="mt-6 space-y-6">
      <div class="space-y-6">
        {#if Object.keys(errors).length > 0}
          <section
            bind:this={errorSummaryElement}
            class="rounded-[1.5rem] border border-error/40 bg-error/10 p-5 text-error shadow-sm"
            tabindex="-1"
            role="alert"
            aria-labelledby="community-error-summary-title">
            <strong id="community-error-summary-title" class="text-lg">
              Review {Object.keys(errors).length}
              {Object.keys(errors).length === 1 ? "field" : "fields"}
            </strong>
            <p class="mt-1 text-sm text-base-content/75">
              Your changes are still here. Correct the highlighted fields, then publish again.
            </p>
            <ul class="mt-3 list-inside list-disc space-y-1 text-sm">
              {#each Object.entries(errors) as [field, message]}
                <li>
                  <button type="button" class="link font-semibold" onclick={() => focusError(field)}
                    >{getErrorLabel(field)}</button
                  >: {message}
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if errors.auth}
          <p class="rounded-box bg-error/10 p-4 text-sm font-medium text-error">{errors.auth}</p>
        {/if}

        <section
          id={controlId("sections")}
          tabindex="-1"
          class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <div class="mb-5 flex items-start justify-between gap-4">
            <div>
              <strong class="text-lg">Community identity</strong>
              <p class="mt-1 text-sm opacity-65">
                The active signer controls the exact kind 32222 community definition.
              </p>
            </div>
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <Field for={controlId("name")} error={errors.name}>
              {#snippet label()}<p>Name <span class="text-primary">(required)</span></p>{/snippet}
              {#snippet input()}<input
                  id={controlId("name")}
                  bind:value={name}
                  class="input input-bordered w-full {errors.name ? 'input-error' : ''}"
                  onblur={() => validateField("name")}
                  aria-invalid={Boolean(errors.name)}
                  aria-describedby={describedBy("name", true)}
                  maxlength="100"
                  type="text" />{/snippet}
              {#snippet info()}Shown in community headers and discovery. Maximum 100 characters.{/snippet}
            </Field>
            <div class="rounded-xl border border-base-300 bg-base-200 p-3 text-sm">
              <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                  <strong>Owner pubkey</strong>
                  <code class="mt-2 block break-all text-xs opacity-75">
                    {activeCommunityPubkey || "Not logged in"}
                  </code>
                </div>
                {#if !activeCommunityPubkey}
                  <Button class="btn btn-primary btn-sm shrink-0" onclick={login}>Login</Button>
                {/if}
              </div>
            </div>
            <div class="md:col-span-2">
              <Field for={controlId("description")} error={errors.description}>
                {#snippet label()}<p>
                    Description <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<textarea
                    id={controlId("description")}
                    bind:value={description}
                    class="textarea textarea-bordered min-h-28 {errors.description
                      ? 'textarea-error'
                      : ''}"
                    onblur={() => validateField("description")}
                    aria-invalid={Boolean(errors.description)}
                    aria-describedby={describedBy("description", true)}
                    maxlength="4096"
                    rows="3"></textarea
                  >{/snippet}
                {#snippet info()}Explain the community's purpose in up to 4,096 characters.{/snippet}
              </Field>
            </div>
            <Field for={controlId("website")} error={errors.website}>
              {#snippet label()}<p>Website <span class="opacity-60">(optional)</span></p>{/snippet}
              {#snippet input()}<input
                  id={controlId("website")}
                  bind:value={website}
                  class="input input-bordered w-full {errors.website ? 'input-error' : ''}"
                  onblur={() => validateField("website")}
                  aria-invalid={Boolean(errors.website)}
                  aria-describedby={describedBy("website", true)}
                  placeholder="https://community.example.com"
                  type="url" />{/snippet}
              {#snippet info()}A complete http:// or https:// URL. Login details and # fragments are
                not allowed.{/snippet}
            </Field>
            <Field for={controlId("picture")} error={errors.picture}>
              {#snippet label()}<p>
                  Picture URL <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<div class="space-y-2">
                  <div class="space-y-2">
                    <input
                      id={controlId("picture")}
                      bind:value={picture}
                      class="input input-bordered w-full {errors.picture ? 'input-error' : ''}"
                      disabled={pictureUploading}
                      oninput={() => (pictureUploadStage = "idle")}
                      onblur={() => validateField("picture")}
                      aria-invalid={Boolean(errors.picture)}
                      aria-describedby={describedBy("picture", true)}
                      placeholder="https://media.example.com/community.png"
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
              {#snippet info()}Use a public https:// image URL, or upload an image below.{/snippet}
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
            {#each sectionDrafts as section, sectionIndex (section.draftKey)}
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
                  <span
                    class="btn btn-outline btn-sm shrink-0 bg-base-100 shadow-sm"
                    aria-hidden="true">
                    {isExpanded ? "Collapse" : "Expand"}
                  </span>
                </button>

                {#if isExpanded}
                  <div class="space-y-5 border-t border-base-300 p-4">
                    <div class="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                      <Field
                        class="flex-1"
                        for={controlId(sectionNameField(sectionIndex))}
                        error={errors[sectionNameField(sectionIndex)]}>
                        {#snippet label()}<p>Section name</p>{/snippet}
                        {#snippet input()}<input
                            id={controlId(sectionNameField(sectionIndex))}
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
                            aria-invalid={Boolean(errors[sectionNameField(sectionIndex)])}
                            aria-describedby={describedBy(sectionNameField(sectionIndex), true)}
                            type="text" />{/snippet}
                        {#snippet info()}Use letters and dashes only, up to 50 characters. Names
                          must be unique.{/snippet}
                      </Field>
                      <Button
                        class="btn btn-outline btn-error btn-sm w-full sm:mt-8 sm:w-auto"
                        disabled={disabled || sectionDrafts.length === 1}
                        onclick={() => removeSection(sectionIndex)}>
                        Remove section
                      </Button>
                    </div>

                    <div
                      id={controlId(sectionKindsField(sectionIndex))}
                      tabindex="-1"
                      class="space-y-3">
                      <div class="flex items-center justify-between gap-3 sm:justify-start">
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
                          class="grid gap-2 rounded-2xl border border-base-300 bg-base-100/75 p-3 text-sm shadow-sm sm:grid-cols-2 sm:gap-3 sm:p-4 sm:text-base lg:grid-cols-[minmax(220px,2fr)_minmax(100px,1fr)_minmax(170px,1fr)_auto] lg:items-start">
                          <Field
                            class="sm:col-span-2 lg:col-span-1"
                            for={`known-kind-${sectionIndex}-${kindIndex}`}>
                            {#snippet label()}<p>Known kind</p>{/snippet}
                            {#snippet input()}<div class="flex items-center gap-2">
                                <select
                                  id={`known-kind-${sectionIndex}-${kindIndex}`}
                                  class="select select-bordered select-sm min-w-0 flex-1 text-sm sm:select-md sm:text-base"
                                  value={kindDraftOptionValue(kindDraft)}
                                  onchange={event =>
                                    setKnownKind(
                                      sectionIndex,
                                      kindIndex,
                                      (event.currentTarget as HTMLSelectElement).value,
                                    )}>
                                  <option value={CUSTOM_KIND_VALUE}>Custom kind</option>
                                  {#each KNOWN_SECTION_KIND_OPTIONS as option}
                                    <option
                                      value={kindOptionValue(option.kind, option.subtype || "")}
                                      >{option.label} ({option.kind}{option.subtype
                                        ? ` / ${option.subtype}`
                                        : ""})</option>
                                  {/each}
                                </select>
                                {#if kindDraftOptionValue(kindDraft) === kindOptionValue(1111)}
                                  <Tooltip
                                    content={COMMENTS_KIND_HELP}
                                    trigger="click"
                                    class="inline-flex shrink-0">
                                    <button
                                      type="button"
                                      class="badge badge-ghost badge-sm"
                                      aria-label={COMMENTS_KIND_HELP}>
                                      ?
                                    </button>
                                  </Tooltip>
                                {/if}
                              </div>{/snippet}
                            {#snippet info()}Choose a known type or select Custom kind to enter one
                              manually.{/snippet}
                          </Field>
                          <Field
                            for={controlId(sectionKindField(sectionIndex, kindIndex))}
                            error={errors[sectionKindField(sectionIndex, kindIndex)]}>
                            {#snippet label()}<p>Kind</p>{/snippet}
                            {#snippet input()}<input
                                id={controlId(sectionKindField(sectionIndex, kindIndex))}
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
                                aria-invalid={Boolean(
                                  errors[sectionKindField(sectionIndex, kindIndex)],
                                )}
                                aria-describedby={describedBy(
                                  sectionKindField(sectionIndex, kindIndex),
                                  true,
                                )}
                                type="text" />{/snippet}
                            {#snippet info()}Nostr event kind number from 0 to 39,999.{/snippet}
                          </Field>
                          <Field
                            for={controlId(sectionSubtypeField(sectionIndex, kindIndex))}
                            error={errors[sectionSubtypeField(sectionIndex, kindIndex)]}>
                            {#snippet label()}
                              <p>Subtype</p>
                              <Tooltip content={SUBTYPE_HELP} trigger="click" class="inline-flex">
                                <button
                                  type="button"
                                  class="badge badge-ghost badge-sm"
                                  aria-label={SUBTYPE_HELP}>
                                  ?
                                </button>
                              </Tooltip>
                            {/snippet}
                            {#snippet input()}<input
                                id={controlId(sectionSubtypeField(sectionIndex, kindIndex))}
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
                                aria-invalid={Boolean(
                                  errors[sectionSubtypeField(sectionIndex, kindIndex)],
                                )}
                                aria-describedby={describedBy(
                                  sectionSubtypeField(sectionIndex, kindIndex),
                                  true,
                                )}
                                type="text" />{/snippet}
                            {#snippet info()}Optional lowercase qualifier using letters and dashes,
                              up to 20 characters.{/snippet}
                          </Field>
                          <div class="flex sm:col-span-2 lg:col-span-1 lg:mt-8">
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
            <Field for={controlId("primaryRelay")} error={errors.primaryRelay}>
              {#snippet label()}<p>
                  Primary community relay <span class="text-primary">(required)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  id={controlId("primaryRelay")}
                  bind:value={primaryRelay}
                  class="input input-bordered w-full {errors.primaryRelay ? 'input-error' : ''}"
                  onblur={() => validateField("primaryRelay")}
                  aria-invalid={Boolean(errors.primaryRelay)}
                  aria-describedby={describedBy("primaryRelay", true)}
                  type="url"
                  placeholder="wss://relay.example.com" />{/snippet}
              {#snippet info()}Secure wss:// URL. A trailing slash is optional; BudaBit formats it
                automatically.{/snippet}
            </Field>
            <Field for={controlId("extraRelays")} error={errors.extraRelays}>
              {#snippet label()}<p>
                  Extra relays <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<textarea
                  id={controlId("extraRelays")}
                  bind:value={extraRelays}
                  class="textarea textarea-bordered {errors.extraRelays ? 'textarea-error' : ''}"
                  onblur={() => validateField("extraRelays")}
                  aria-invalid={Boolean(errors.extraRelays)}
                  aria-describedby={describedBy("extraRelays", true)}
                  rows="2"
                  placeholder="wss://relay-two.example.com"></textarea>
                >{/snippet}
              {#snippet info()}One wss:// URL per line, with or without a trailing slash. Maximum 20
                relays total.{/snippet}
            </Field>
            <div class="space-y-3">
              <Field for={controlId("blossomServers")} error={errors.blossomServers}>
                {#snippet label()}<p>
                    Blossom servers <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<textarea
                    id={controlId("blossomServers")}
                    bind:value={blossomServers}
                    class="textarea textarea-bordered {errors.blossomServers
                      ? 'textarea-error'
                      : ''}"
                    onblur={() => validateField("blossomServers")}
                    aria-invalid={Boolean(errors.blossomServers)}
                    aria-describedby={describedBy("blossomServers", true)}
                    rows="2"
                    placeholder="https://blossom.example.com"></textarea>
                  >{/snippet}
                {#snippet info()}One public https:// media server URL per line. Maximum 20 servers.{/snippet}
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
            <Field for={controlId("mints")} error={errors.mints}>
              {#snippet label()}<p>Mints <span class="opacity-60">(optional)</span></p>{/snippet}
              {#snippet input()}<textarea
                  id={controlId("mints")}
                  bind:value={mints}
                  class="textarea textarea-bordered {errors.mints ? 'textarea-error' : ''}"
                  onblur={() => validateField("mints")}
                  aria-invalid={Boolean(errors.mints)}
                  aria-describedby={describedBy("mints", true)}
                  rows="2"
                  placeholder="https://mint.example.com cashu"></textarea>
                >{/snippet}
              {#snippet info()}One https:// mint URL per line, optionally followed by a short type
                such as cashu. Maximum 20.{/snippet}
            </Field>
            <Field for={controlId("graspServers")} error={errors.graspServers}>
              {#snippet label()}<p>
                  GRASP servers <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<textarea
                  id={controlId("graspServers")}
                  bind:value={graspServers}
                  class="textarea textarea-bordered {errors.graspServers ? 'textarea-error' : ''}"
                  onblur={() => validateField("graspServers")}
                  aria-invalid={Boolean(errors.graspServers)}
                  aria-describedby={describedBy("graspServers", true)}
                  rows="2"
                  placeholder="wss://grasp.example.com"></textarea>
                >{/snippet}
              {#snippet info()}One secure wss:// GRASP endpoint per line. A trailing slash is
                optional; maximum 20.{/snippet}
            </Field>
          </div>
          <details class="mt-5 rounded-2xl border border-base-300 bg-base-200/40 p-4 sm:p-5">
            <summary class="cursor-pointer select-none font-semibold">
              Email digest providers <span class="opacity-60">(optional)</span>
            </summary>
            <div class="mt-4 border-t border-base-300 pt-4">
              <p class="text-sm leading-relaxed text-base-content/70">
                Declaring a provider is a community endorsement only. Users opt in separately and
                share their email address directly with that provider.
              </p>
              <p class="mt-2 text-sm leading-relaxed text-base-content/70">
                See open source email digest provider implementation
                <a
                  class="link font-medium"
                  href={EMAIL_DIGEST_PROVIDER_IMPLEMENTATION_URL}
                  target="_blank"
                  rel="noopener noreferrer">here</a
                >.
              </p>

              <div class="mt-5 rounded-2xl border border-base-300 bg-base-100/60 p-4">
                <div class="mb-4">
                  <p class="font-semibold">Repository digest provider</p>
                  <p class="mt-1 text-sm leading-relaxed text-base-content/70">
                    Users receive email digests about watched repositories. Each user selects one
                    global provider.
                  </p>
                  {#if additionalEmailDigestServices.length > 0}
                    <p class="mt-2 text-xs font-medium text-info">
                      {additionalEmailDigestServices.length} additional provider declaration{additionalEmailDigestServices.length ===
                      1
                        ? " is"
                        : "s are"} preserved unchanged.
                    </p>
                  {/if}
                </div>
                <div class="grid gap-4 md:grid-cols-2">
                  <Field
                    for={controlId("emailDigestServicePubkey")}
                    error={errors.emailDigestServicePubkey}>
                    {#snippet label()}<p>Service pubkey</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("emailDigestServicePubkey")}
                        bind:value={emailDigestServicePubkey}
                        class="input input-bordered w-full {errors.emailDigestServicePubkey
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("emailDigestServicePubkey")}
                        aria-invalid={Boolean(errors.emailDigestServicePubkey)}
                        aria-describedby={describedBy("emailDigestServicePubkey", true)}
                        type="text"
                        spellcheck="false"
                        placeholder="64-character hex pubkey" />{/snippet}
                    {#snippet info()}The provider's 64-character hexadecimal Nostr public key.{/snippet}
                  </Field>
                  <Field
                    for={controlId("emailDigestRequestRelay")}
                    error={errors.emailDigestRequestRelay}>
                    {#snippet label()}<p>Request/status relay</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("emailDigestRequestRelay")}
                        bind:value={emailDigestRequestRelay}
                        class="input input-bordered w-full {errors.emailDigestRequestRelay
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("emailDigestRequestRelay")}
                        aria-invalid={Boolean(errors.emailDigestRequestRelay)}
                        aria-describedby={describedBy("emailDigestRequestRelay", true)}
                        type="url"
                        placeholder="wss://digest.example.com" />{/snippet}
                    {#snippet info()}Secure relay used for provider requests and delivery status.{/snippet}
                  </Field>
                  <Field
                    for={controlId("emailDigestHandlerAddress")}
                    error={errors.emailDigestHandlerAddress}>
                    {#snippet label()}<p>Handler address</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("emailDigestHandlerAddress")}
                        bind:value={emailDigestHandlerAddress}
                        class="input input-bordered w-full {errors.emailDigestHandlerAddress
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("emailDigestHandlerAddress")}
                        aria-invalid={Boolean(errors.emailDigestHandlerAddress)}
                        aria-describedby={describedBy("emailDigestHandlerAddress", true)}
                        type="text"
                        spellcheck="false"
                        placeholder="31990:<handler pubkey>:<id>" />{/snippet}
                    {#snippet info()}Address format: 31990, provider pubkey, and non-empty
                      identifier separated by colons.{/snippet}
                  </Field>
                  <Field
                    for={controlId("emailDigestHandlerRelay")}
                    error={errors.emailDigestHandlerRelay}>
                    {#snippet label()}<p>Handler relay</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("emailDigestHandlerRelay")}
                        bind:value={emailDigestHandlerRelay}
                        class="input input-bordered w-full {errors.emailDigestHandlerRelay
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("emailDigestHandlerRelay")}
                        aria-invalid={Boolean(errors.emailDigestHandlerRelay)}
                        aria-describedby={describedBy("emailDigestHandlerRelay", true)}
                        type="url"
                        placeholder="wss://handlers.example.com" />{/snippet}
                    {#snippet info()}Secure relay where the provider's handler announcement is
                      published.{/snippet}
                  </Field>
                </div>
              </div>

              <div class="mt-5 rounded-2xl border border-base-300 bg-base-100/60 p-4">
                <div class="mb-4">
                  <p class="font-semibold">Community digest provider</p>
                  <p class="mt-1 text-sm leading-relaxed text-base-content/70">
                    This provider sends activity digests only about the community that advertises
                    it. Users opt in per community.
                  </p>
                  {#if additionalCommunityAlertServices.length > 0}
                    <p class="mt-2 text-xs font-medium text-info">
                      {additionalCommunityAlertServices.length} additional provider declaration{additionalCommunityAlertServices.length ===
                      1
                        ? " is"
                        : "s are"} preserved unchanged.
                    </p>
                  {/if}
                </div>
                <div class="grid gap-4 md:grid-cols-2">
                  <Field
                    for={controlId("communityAlertServicePubkey")}
                    error={errors.communityAlertServicePubkey}>
                    {#snippet label()}<p>Service pubkey</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("communityAlertServicePubkey")}
                        bind:value={communityAlertServicePubkey}
                        class="input input-bordered w-full {errors.communityAlertServicePubkey
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("communityAlertServicePubkey")}
                        aria-invalid={Boolean(errors.communityAlertServicePubkey)}
                        aria-describedby={describedBy("communityAlertServicePubkey", true)}
                        type="text"
                        spellcheck="false"
                        placeholder="64-character hex pubkey" />{/snippet}
                    {#snippet info()}The provider's 64-character hexadecimal Nostr public key.{/snippet}
                  </Field>
                  <Field
                    for={controlId("communityAlertRequestRelay")}
                    error={errors.communityAlertRequestRelay}>
                    {#snippet label()}<p>Request/status relay</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("communityAlertRequestRelay")}
                        bind:value={communityAlertRequestRelay}
                        class="input input-bordered w-full {errors.communityAlertRequestRelay
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("communityAlertRequestRelay")}
                        aria-invalid={Boolean(errors.communityAlertRequestRelay)}
                        aria-describedby={describedBy("communityAlertRequestRelay", true)}
                        type="url"
                        placeholder="wss://alerts.example.com" />{/snippet}
                    {#snippet info()}Secure relay used for provider requests and delivery status.{/snippet}
                  </Field>
                  <Field
                    for={controlId("communityAlertHandlerAddress")}
                    error={errors.communityAlertHandlerAddress}>
                    {#snippet label()}<p>Handler address</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("communityAlertHandlerAddress")}
                        bind:value={communityAlertHandlerAddress}
                        class="input input-bordered w-full {errors.communityAlertHandlerAddress
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("communityAlertHandlerAddress")}
                        aria-invalid={Boolean(errors.communityAlertHandlerAddress)}
                        aria-describedby={describedBy("communityAlertHandlerAddress", true)}
                        type="text"
                        spellcheck="false"
                        placeholder="31990:<handler pubkey>:<id>" />{/snippet}
                    {#snippet info()}Address format: 31990, provider pubkey, and non-empty
                      identifier separated by colons.{/snippet}
                  </Field>
                  <Field
                    for={controlId("communityAlertHandlerRelay")}
                    error={errors.communityAlertHandlerRelay}>
                    {#snippet label()}<p>Handler relay</p>{/snippet}
                    {#snippet input()}<input
                        id={controlId("communityAlertHandlerRelay")}
                        bind:value={communityAlertHandlerRelay}
                        class="input input-bordered w-full {errors.communityAlertHandlerRelay
                          ? 'input-error'
                          : ''}"
                        onblur={() => validateField("communityAlertHandlerRelay")}
                        aria-invalid={Boolean(errors.communityAlertHandlerRelay)}
                        aria-describedby={describedBy("communityAlertHandlerRelay", true)}
                        type="url"
                        placeholder="wss://handlers.example.com" />{/snippet}
                    {#snippet info()}Secure relay where the provider's handler announcement is
                      published.{/snippet}
                  </Field>
                </div>
              </div>
            </div>
          </details>
        </section>
      </div>

      <div class="space-y-6">
        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <strong class="text-lg">Policy and location</strong>
          <p class="mt-2 text-sm opacity-65">Optional metadata for rules or regional context.</p>
          <div class="mt-5 space-y-4">
            <Field for={controlId("tosRef")} error={errors.tosRef}>
              {#snippet label()}<p>
                  Terms reference <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  id={controlId("tosRef")}
                  bind:value={tosRef}
                  class="input input-bordered w-full {errors.tosRef ? 'input-error' : ''}"
                  onblur={() => validateField("tosRef")}
                  aria-invalid={Boolean(errors.tosRef)}
                  aria-describedby={describedBy("tosRef", true)}
                  type="text"
                  placeholder="64-character event ID or 30023:<pubkey>:<id>" />{/snippet}
              {#snippet info()}Reference a Nostr policy using a 64-character event ID or
                kind:pubkey:identifier address.{/snippet}
            </Field>
            <Field for={controlId("tosRelay")} error={errors.tosRelay}>
              {#snippet label()}<p>
                  Terms relay <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  id={controlId("tosRelay")}
                  bind:value={tosRelay}
                  class="input input-bordered w-full {errors.tosRelay ? 'input-error' : ''}"
                  onblur={() => validateField("tosRelay")}
                  aria-invalid={Boolean(errors.tosRelay)}
                  aria-describedby={describedBy("tosRelay", true)}
                  type="url"
                  placeholder="wss://relay.example.com" />{/snippet}
              {#snippet info()}Optional wss:// relay hint for finding the referenced policy. A
                trailing slash is accepted.{/snippet}
            </Field>
            <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-1">
              <Field for={controlId("location")} error={errors.location}>
                {#snippet label()}<p>
                    Location <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<input
                    id={controlId("location")}
                    bind:value={location}
                    class="input input-bordered w-full {errors.location ? 'input-error' : ''}"
                    onblur={() => validateField("location")}
                    aria-invalid={Boolean(errors.location)}
                    aria-describedby={describedBy("location", true)}
                    maxlength="256"
                    placeholder="Berlin, Germany"
                    type="text" />{/snippet}
                {#snippet info()}Human-readable region or place, up to 256 characters.{/snippet}
              </Field>
              <Field for={controlId("geohash")} error={errors.geohash}>
                {#snippet label()}<p>
                    Geohash <span class="opacity-60">(optional)</span>
                  </p>{/snippet}
                {#snippet input()}<input
                    id={controlId("geohash")}
                    bind:value={geohash}
                    class="input input-bordered w-full {errors.geohash ? 'input-error' : ''}"
                    onblur={() => validateField("geohash")}
                    aria-invalid={Boolean(errors.geohash)}
                    aria-describedby={describedBy("geohash", true)}
                    placeholder="u33dc1"
                    type="text" />{/snippet}
                {#snippet info()}Optional 1-12 character base32 geohash. A geo: prefix and uppercase
                  input are accepted.{/snippet}
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

        {#if publishStatus}
          <div
            class="rounded-box border border-base-300 bg-base-200 p-3 text-sm"
            aria-live="polite">
            <Spinner {loading}>{publishStatus}</Spinner>
          </div>
        {/if}

        <div class="flex gap-2">
          <Button class="btn btn-ghost flex-1" onclick={cancel} {disabled}>Cancel</Button>
          {#if isEdit && originalDraftState}
            <Button class="btn btn-outline flex-1" onclick={applyOriginalDraftState} {disabled}>
              Reset changes
            </Button>
          {/if}
          <Button
            class="btn btn-primary flex-1"
            type="submit"
            disabled={disabled || pictureUploading}>
            {#if loading}<span class="loading loading-spinner mr-2"></span>{/if}
            {actionLabel}
          </Button>
        </div>
      </div>
    </div>
  </div>
</form>
