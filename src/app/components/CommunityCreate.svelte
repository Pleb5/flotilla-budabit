<script lang="ts">
  import {tick} from "svelte"
  import {browser} from "$app/environment"
  import {goto} from "$app/navigation"
  import {publish, PublishStatus} from "@welshman/net"
  import {pubkey, signer as sessionSigner} from "@welshman/app"
  import {createProfile, prep, type EventTemplate, type SignedEvent} from "@welshman/util"
  import type {ISigner} from "@welshman/signer"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import Tooltip from "@lib/components/Tooltip.svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import Profile from "@app/components/Profile.svelte"
  import CommunityBootstrapPeopleEditor from "@app/components/community/CommunityBootstrapPeopleEditor.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityProfileListEvents,
    setActiveCommunityDefinition,
    setActiveCommunityInput,
    type CommunityProfile,
  } from "@app/core/community-state"
  import {makeCommunityPath} from "@app/util/routes"
  import {
    DEFAULT_COMMUNITY_SECTION_NAMES,
    buildCommunityDefinition,
    getDefaultCommunitySectionKinds,
    getCommunitySectionKindKey,
    getCommunitySectionKindLabel,
    makeCommunityNcommunity,
    makeCommunitySetupSection,
    normalizeGeohash,
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
    makeCommunityProfileList,
    type CommunityBootstrapGrantDraft,
    type CommunityProfileListDraftUpdate,
  } from "@app/core/community-admin"
  import {getCommunityRootPublishRelays} from "@app/core/community-relays"
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
    {label: "Repositories", kind: 30617},
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

  const publishRequiredEvent = async (
    event: SignedEvent,
    relays: string[],
    requiredRelay?: string,
  ) => {
    const results = await publish({event, relays, timeout: 12_000})
    const normalizedRequiredRelay = normalizeRelay(requiredRelay)
    const requiredResult = normalizedRequiredRelay
      ? Object.entries(results).find(
          ([relay]) => normalizeRelay(relay) === normalizedRequiredRelay,
        )?.[1]
      : undefined
    const accepted = normalizedRequiredRelay
      ? requiredResult?.status === PublishStatus.Success
      : Object.values(results).some(result => result.status === PublishStatus.Success)

    if (!accepted) {
      const detail =
        requiredResult?.detail ||
        Object.values(results)[0]?.detail ||
        "No relay accepted the event."
      throw new Error(detail)
    }
  }

  const cancel = () =>
    goto(isEdit && definition ? makeCommunityPath(definition.pubkey) : "/explore")

  const submitCommunitySettings = async () => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in with the community signer first."})
      return
    }

    const validated = validateForm()
    if (!validated) return

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

    loading = true

    try {
      const communityProfile = createProfile({
        name: validated.name,
        display_name: validated.name,
        about: validated.description,
        website: validated.website,
        picture: validated.picture,
      })
      const communityDefinition = buildCommunityDefinition({
        relays: validated.relays,
        sections: validated.sections,
        description: validated.description,
        blossomServers: validated.blossomServers,
        mints: validated.mints,
        tos: validated.tos,
        location: validated.location,
        geohash: validated.geohash,
      })
      const updatedProfileListAddresses = new Set(
        validated.profileListUpdates.map(update => update.profileList.address),
      )
      const profileLists = [
        ...validated.profileListUpdates.map(update =>
          makeCommunityProfileList({profileList: update.profileList, pubkeys: update.pubkeys}),
        ),
        ...validated.newProfileLists
          .filter(({profileList}) => !updatedProfileListAddresses.has(profileList.address))
          .map(({profileList}) =>
            makeCommunityProfileList({profileList, pubkeys: [validated.community.pubkey]}),
          ),
      ]
      const signedCommunityProfile = await makeSignedEvent(validated.community, communityProfile)
      const signedDefinition = await makeSignedEvent(validated.community, communityDefinition)
      const signedProfileLists = await Promise.all(
        profileLists.map(template => makeSignedEvent(validated.community, template)),
      )
      const rootRelays = getCommunityRootPublishRelays(validated.relays, validated.community.pubkey)
      const communityScopedEvents = signedProfileLists

      await publishRequiredEvent(signedCommunityProfile, rootRelays, validated.primaryRelay)
      await publishRequiredEvent(signedDefinition, rootRelays, validated.primaryRelay)

      for (const event of communityScopedEvents) {
        await publishRequiredEvent(event, validated.relays, validated.primaryRelay)
      }

      const communityInput = makeCommunityNcommunity({
        pubkey: validated.community.pubkey,
        relayHints: validated.relays,
      })
      setActiveCommunityInput(communityInput)
      const parsedDefinition = parseCommunityDefinition(signedDefinition)
      if (parsedDefinition) setActiveCommunityDefinition(parsedDefinition)
      bootstrapGrantDrafts = []

      pushToast({message: isEdit ? "Community settings updated." : "Community created."})
      if (!isEdit) goto(makeCommunityPath(validated.community.pubkey))
    } catch (error) {
      pushToast({theme: "error", message: `Community setup failed: ${String(error)}`})
    } finally {
      loading = false
    }
  }

  const updateSection = (sectionIndex: number, update: Partial<SectionDraft>) => {
    const nextDrafts = sectionDrafts.map((section, index) =>
      index === sectionIndex ? {...section, ...update} : section,
    )

    sectionDrafts = nextDrafts
    if (update.name !== undefined) validateSectionNames(nextDrafts)
  }

  const updateSectionKind = (
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

  const setKnownKind = (sectionIndex: number, kindIndex: number, value: string) => {
    if (value === CUSTOM_KIND_VALUE) return

    const option = KNOWN_SECTION_KIND_OPTIONS.find(
      candidate => kindOptionValue(candidate.kind, candidate.subtype || "") === value,
    )
    if (!option) return

    updateSectionKind(sectionIndex, kindIndex, {
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

  const restoreDefaultSections = () => {
    sectionDrafts = DEFAULT_COMMUNITY_SECTION_NAMES.map(name => {
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
    errors = Object.fromEntries(
      Object.entries(errors).filter(([key]) => !key.startsWith("section-") && key !== "sections"),
    )
    expandedSectionIndex = 0
  }

  const removeSection = (sectionIndex: number) => {
    const nextDrafts = sectionDrafts.filter((_, index) => index !== sectionIndex)

    sectionDrafts = nextDrafts
    expandedSectionIndex = Math.max(0, Math.min(expandedSectionIndex, nextDrafts.length - 1))
    validateSectionNames(nextDrafts)
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

  const removeKind = (sectionIndex: number, kindIndex: number) => {
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
      name = profile?.display_name || profile?.name || ""
      description = definition.description || profile?.about || ""
      website = profile?.website || ""
      picture = profile?.picture || ""
      primaryRelay = definition.relays[0] || ""
      extraRelays = definition.relays.slice(1).join("\n")
      blossomServers = definition.blossomServers.join("\n")
      mints = definition.mints
        .map(mint => [mint.url, mint.type].filter(Boolean).join(" "))
        .join("\n")
      tosRef = definition.tos?.ref || ""
      tosRelay = definition.tos?.relay || ""
      location = definition.location || ""
      geohash = definition.geohash || ""
      pictureUploadStage = "idle"
      sectionDrafts = makeSectionDraftsFromDefinition(definition)
      bootstrapGrantDrafts = []
      expandedSectionIndex = 0
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
    websitePrefilled = Boolean(activePubkey)
  })

  $effect(() => {
    if (isEdit || !$pubkey || websitePrefilled) return

    websitePrefilled = true

    if (!website.trim()) website = makeBudabitCommunityUrl($pubkey)
  })
</script>

<form
  class={embedded ? "col-4" : "min-h-full bg-base-200"}
  onsubmit={preventDefault(submitCommunitySettings)}>
  <div class={embedded ? "col-4" : "mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10"}>
    <section
      class="relative isolate overflow-hidden rounded-[2rem] border border-base-300 bg-base-100 p-6 shadow-sm sm:p-8 lg:p-10">
      <div class="-z-10 absolute -right-32 -top-40 h-80 w-80 rounded-full bg-primary/10 blur-3xl">
      </div>
      <div class="-z-10 absolute -bottom-40 left-20 h-72 w-72 rounded-full bg-warning/10 blur-3xl">
      </div>
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
              Publish a fresh kind:10222 definition with updated relays, metadata, and content
              sections.
            {:else}
              Your logged-in signer becomes the community. BudaBit publishes the profile, kind:10222
              definition, and initial publishing lists.
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
                            onblur={() => validateSectionNames()}
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
                          class="btn btn-ghost btn-xs"
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
                                oninput={event =>
                                  updateSectionKind(sectionIndex, kindIndex, {
                                    kind: (event.currentTarget as HTMLInputElement).value,
                                  })}
                                onblur={() => validateSectionKinds()}
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
                                oninput={event =>
                                  updateSectionKind(sectionIndex, kindIndex, {
                                    subtype: (event.currentTarget as HTMLInputElement).value,
                                  })}
                                onblur={() => validateSectionKinds()}
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
          <p class="mt-3 text-xs leading-relaxed opacity-60">
            Profile and definition go to community, indexer, and community-key outbox relays. New
            lists stay on community relays.
          </p>
          <div class="mt-5 flex gap-2">
            <Button class="btn btn-ghost flex-1" onclick={cancel} {disabled}>Cancel</Button>
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
