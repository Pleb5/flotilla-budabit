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
  import Profile from "@app/components/Profile.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    setActiveCommunityDefinition,
    setActiveCommunityInput,
    type CommunityProfile,
  } from "@app/core/community-state"
  import {makeCommunityPath} from "@app/util/routes"
  import {
    DEFAULT_COMMUNITY_SECTION_NAMES,
    buildCommunityDefinition,
    getDefaultCommunitySectionKinds,
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
  import {makeCommunityProfileList} from "@app/core/community-admin"
  import {getCommunityRootPublishRelays} from "@app/core/community-relays"

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
  }

  const {mode = "create", definition, profile, embedded = false}: Props = $props()

  const SECTION_NAME_RE = /^[A-Za-z]{1,50}$/
  const CUSTOM_KIND_VALUE = "custom"
  const KIND_DIGITS_RE = /^\d+$/
  const SUBTYPE_RE = /^[a-z-]{0,20}$/
  const SUBTYPE_HELP =
    "Optional third value in a k tag. Use it when one event kind supports multiple sections, like 11/room, 11/threads, or 9/room-message."

  const KNOWN_SECTION_KIND_OPTIONS = [
    {label: "Room Messages", kind: 9, subtype: "room-message"},
    {label: "Rooms", kind: 11, subtype: "room"},
    {label: "Threads", kind: 11, subtype: "threads"},
    {label: "Comments", kind: 1111},
    {label: "Reactions", kind: 7},
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
        nextErrors[field] = "Use only A-Z letters, with a maximum of 50 characters."
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
      Object.entries(errors).filter(([key]) => !key.match(/^section-\d+-(kind|subtype)-\d+$/)),
    )

    for (const [sectionIndex, section] of drafts.entries()) {
      for (const [kindIndex, draft] of section.kinds.entries()) {
        const kindValue = draft.kind.trim()
        const kind = Number.parseInt(kindValue, 10)
        const subtype = draft.subtype.trim()

        if (
          !KIND_DIGITS_RE.test(kindValue) ||
          !Number.isInteger(kind) ||
          kind < 0 ||
          kind > 39999
        ) {
          nextErrors[sectionKindField(sectionIndex, kindIndex)] =
            "Kind must be an integer between 0 and 39999."
        }
        if (!SUBTYPE_RE.test(subtype)) {
          nextErrors[sectionSubtypeField(sectionIndex, kindIndex)] =
            "Subtype must be lowercase letters or dashes, up to 20 characters."
        }
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

    if (sectionDrafts.length === 0) nextErrors.sections = "Add at least one content section."

    for (const [sectionIndex, section] of sectionDrafts.entries()) {
      const name = section.name.trim()
      const nameKey = name.toLowerCase()
      const kinds: CommunitySectionKind[] = []

      if (!SECTION_NAME_RE.test(name)) {
        nextErrors[sectionNameField(sectionIndex)] =
          "Use only A-Z letters, with a maximum of 50 characters."
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
      sections: authority.sections,
      newProfileLists: authority.newProfileLists,
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
      const profileLists = validated.newProfileLists.map(({profileList}) =>
        makeCommunityProfileList({profileList, pubkeys: [validated.community.pubkey]}),
      )
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

  const addKind = (sectionIndex: number) => {
    sectionDrafts = sectionDrafts.map((section, index) =>
      index === sectionIndex
        ? {...section, kinds: [...section.kinds, {kind: "", subtype: ""}]}
        : section,
    )
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
  let sectionDrafts = $state<SectionDraft[]>(makeDefaultSectionDrafts())
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
      sectionDrafts = makeSectionDraftsFromDefinition(definition)
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
    sectionDrafts = makeDefaultSectionDrafts()
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
          class="rounded-2xl border border-warning/35 bg-warning/15 p-4 text-sm leading-relaxed text-base-content shadow-sm shadow-warning/5">
          <strong class="block text-base font-semibold text-warning">Community signer</strong>
          <span class="mt-1 block text-base-content/80">
            {#if activeCommunityPubkey}
              <span class="mb-3 block">Publishing as</span>
              <Profile pubkey={activeCommunityPubkey} avatarSize={9} showPubkey />
              <span class="mt-3 block">Bunker and extension signers are supported.</span>
            {:else}
              Log in with the npub that should own this community.
            {/if}
          </span>
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
              {#snippet input()}<input
                  bind:value={picture}
                  class="input input-bordered w-full {errors.picture ? 'input-error' : ''}"
                  onblur={() => validateField("picture")}
                  type="url" />{/snippet}
            </Field>
          </div>
        </section>

        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <div class="mb-5 flex items-start justify-between gap-4">
            <div>
              <strong class="text-lg">Content sections</strong>
              <p class="mt-1 text-sm opacity-65">
                Section names may use only A-Z letters and must be 50 characters or fewer.
              </p>
            </div>
            <div class="flex shrink-0 flex-wrap justify-end gap-2">
              <Button class="btn btn-ghost btn-sm" onclick={restoreDefaultSections} {disabled}>
                Restore defaults
              </Button>
              <Button class="btn btn-primary btn-sm" onclick={addSection} {disabled}>
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
                          class="grid gap-3 rounded-2xl border border-base-300 bg-base-100/75 p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-[minmax(220px,2fr)_minmax(100px,1fr)_minmax(170px,1fr)_auto] lg:items-end">
                          <Field class="sm:col-span-2 lg:col-span-1">
                            {#snippet label()}<p>Known kind</p>{/snippet}
                            {#snippet input()}<select
                                class="select select-bordered w-full"
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
                                class="input input-bordered w-full {errors[
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
                            {/snippet}
                            {#snippet input()}<input
                                value={kindDraft.subtype}
                                maxlength="20"
                                class="input input-bordered w-full {errors[
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
                            {#snippet info()}{SUBTYPE_HELP}{/snippet}
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
            <Field error={errors.blossomServers}>
              {#snippet label()}<p>
                  Blossom servers <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<textarea
                  bind:value={blossomServers}
                  class="textarea textarea-bordered {errors.blossomServers ? 'textarea-error' : ''}"
                  onblur={() => validateField("blossomServers")}
                  rows="2"
                  placeholder="One server per line"></textarea>
                >{/snippet}
            </Field>
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
