<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {browser} from "$app/environment"
  import {goto} from "$app/navigation"
  import {publish, PublishStatus} from "@welshman/net"
  import {pubkey, signer as sessionSigner} from "@welshman/app"
  import {Nip01Signer, type ISigner} from "@welshman/signer"
  import {Router} from "@welshman/router"
  import {
    createProfile,
    getPubkey,
    prep,
    type EventTemplate,
    type SignedEvent,
  } from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {INDEXER_RELAYS} from "@app/core/state"
  import {setActiveCommunityDefinition, setActiveCommunityInput} from "@app/core/community-state"
  import {makeCommunityPath} from "@app/util/routes"
  import {
    buildCommunityDefinition,
    makeCommunityBadgeDefinition,
    makeCommunitySetupRefs,
    normalizeGeohash,
    normalizeRelay,
    normalizeRelays,
    parseCommunityDefinition,
  } from "@app/core/community"
  import {makeCommunityBadgeAward, makeCommunityProfileList} from "@app/core/community-admin"

  type SetupSigner = {
    pubkey: string
    signer: ISigner
  }

  type FieldErrors = Record<string, string>

  type ValidatedField =
    | "name"
    | "communitySecret"
    | "website"
    | "picture"
    | "primaryRelay"
    | "extraRelays"
    | "blossomServers"
    | "mints"
    | "delegatedAdminSecret"
    | "tosRef"
    | "tosRelay"
    | "geohash"

  type ValidatedSetup = {
    name: string
    description: string
    website: string
    picture: string
    community: SetupSigner
    delegatedAdmin: SetupSigner
    relays: string[]
    primaryRelay: string
    extraRelays: string[]
    blossomServers: string[]
    mints: Array<{url: string; type?: string}>
    tos?: {ref: string; relay?: string}
    location: string
    geohash: string
  }

  const HEX_SECRET_RE = /^[0-9a-f]{64}$/i

  const toHex = (bytes: Uint8Array) =>
    Array.from(bytes)
      .map(byte => byte.toString(16).padStart(2, "0"))
      .join("")

  const normalizeSecret = (value: string) => {
    const trimmed = value.trim()
    if (HEX_SECRET_RE.test(trimmed)) return trimmed.toLowerCase()

    if (trimmed.startsWith("nsec")) {
      try {
        const decoded = nip19.decode(trimmed)
        if (decoded.type === "nsec") return toHex(decoded.data)
      } catch {
        return ""
      }
    }

    return ""
  }

  const fromSecret = (secretValue: string): SetupSigner | undefined => {
    const secret = normalizeSecret(secretValue)
    if (!secret) return undefined

    try {
      return {
        pubkey: getPubkey(secret),
        signer: Nip01Signer.fromSecret(secret),
      }
    } catch {
      return undefined
    }
  }

  const getPubkeyFromSecret = (secretValue: string) => {
    const secret = normalizeSecret(secretValue)
    if (!secret) return ""

    try {
      return getPubkey(secret)
    } catch {
      return ""
    }
  }

  const makeBudabitCommunityUrl = (pubkey: string) => {
    const path = makeCommunityPath(pubkey)

    return browser ? new URL(path, window.location.origin).toString() : path
  }

  const fromCurrentSession = (): SetupSigner | undefined => {
    const activePubkey = $pubkey
    const activeSigner = $sessionSigner
    if (!activePubkey || !activeSigner) return undefined

    return {pubkey: activePubkey, signer: activeSigner}
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
        nextErrors[field] = `Line ${index + 1} must be a valid relay URL, like wss://relay.example.com.`
        continue
      }

      relays.push(relay)
    }

    return relays
  }

  const validateWebUrlField = (value: string, field: string, label: string, nextErrors: FieldErrors) => {
    const trimmed = value.trim()
    if (!trimmed) return ""

    const url = normalizeWebUrl(trimmed)
    if (!url) nextErrors[field] = `${label} must be a valid http:// or https:// URL.`

    return url
  }

  const validateMints = (nextErrors: FieldErrors) => {
    const normalizedMints: Array<{url: string; type?: string}> = []

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

  const setFieldError = (field: ValidatedField, message = "") => {
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
    setFieldError("tosRef", tosRelay.trim() && !trimmedTosRef ? "Add a terms reference or clear the terms relay." : "")
  }

  const validateField = (field: ValidatedField) => {
    switch (field) {
      case "name":
        setFieldError(field, name.trim() ? "" : "Community name is required.")
        break
      case "communitySecret":
        setFieldError(
          field,
          fromSecret(communitySecret) ? "" : "Enter a valid nsec or 64-character hex secret.",
        )
        break
      case "website": {
        const normalized = validateWebUrlField(website, field, "Website", {})
        if (normalized) website = normalized
        setFieldError(field, website.trim() && !normalized ? "Website must be a valid http:// or https:// URL." : "")
        break
      }
      case "picture": {
        const normalized = validateWebUrlField(picture, field, "Picture URL", {})
        if (normalized) picture = normalized
        setFieldError(field, picture.trim() && !normalized ? "Picture URL must be a valid http:// or https:// URL." : "")
        break
      }
      case "primaryRelay": {
        const normalized = normalizeRelay(primaryRelay)
        if (normalized) primaryRelay = normalized
        setFieldError(field, normalized ? "" : "Primary relay is required and must be a valid wss:// relay URL.")
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
            if (!url) setFieldError(field, `Line ${index + 1} must be a valid http:// or https:// URL.`)
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
      case "delegatedAdminSecret":
        setFieldError(
          field,
          delegatedAdminSecret.trim() && !fromSecret(delegatedAdminSecret)
            ? "Enter a valid nsec or 64-character hex secret, or leave this blank."
            : "",
        )
        break
      case "tosRef":
      case "tosRelay":
        validateTosFields()
        break
      case "geohash": {
        const normalized = normalizeGeohash(geohash)
        if (normalized) geohash = normalized
        setFieldError(
          field,
          geohash.trim() && !normalized ? "Geohash must be lowercase base32, with optional geo: prefix." : "",
        )
        break
      }
    }
  }

  const validateForm = (): ValidatedSetup | undefined => {
    const nextErrors: FieldErrors = {}
    const trimmedName = name.trim()
    const community = fromSecret(communitySecret)
    const delegatedAdmin = delegatedAdminSecret.trim()
      ? fromSecret(delegatedAdminSecret)
      : fromCurrentSession()
    const normalizedPrimaryRelay = normalizeRelay(primaryRelay)
    const normalizedExtraRelays = validateRelayLines(extraRelays, "extraRelays", nextErrors)
    const relays = normalizeRelays([normalizedPrimaryRelay, ...normalizedExtraRelays])
    const normalizedWebsite = validateWebUrlField(website, "website", "Website", nextErrors)
    const normalizedPicture = validateWebUrlField(picture, "picture", "Picture URL", nextErrors)
    const normalizedBlossomServers = splitLines(blossomServers)
      .map((server, index) => {
        const url = normalizeWebUrl(server)
        if (!url) nextErrors.blossomServers = `Line ${index + 1} must be a valid http:// or https:// URL.`
        return url
      })
      .filter(Boolean)
    const normalizedMints = validateMints(nextErrors)
    const trimmedTosRef = tosRef.trim()
    const normalizedTosRelay = normalizeRelay(tosRelay)
    const normalizedGeohash = normalizeGeohash(geohash)

    if (!trimmedName) nextErrors.name = "Community name is required."
    if (!community) nextErrors.communitySecret = "Enter a valid nsec or 64-character hex secret."
    if (delegatedAdminSecret.trim() && !delegatedAdmin) {
      nextErrors.delegatedAdminSecret = "Enter a valid nsec or 64-character hex secret, or leave this blank."
    }
    if (!delegatedAdmin) nextErrors.delegatedAdminSecret = "Log in or provide a delegated admin secret."
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

    if (Object.keys(nextErrors).length > 0 || !community || !delegatedAdmin || relays.length === 0) {
      pushToast({theme: "error", message: "Fix the highlighted fields before creating the community."})
      return undefined
    }

    return {
      name: trimmedName,
      description: description.trim(),
      website: normalizedWebsite,
      picture: normalizedPicture,
      community,
      delegatedAdmin,
      relays,
      primaryRelay: normalizedPrimaryRelay,
      extraRelays: normalizedExtraRelays,
      blossomServers: normalizedBlossomServers,
      mints: normalizedMints,
      tos: trimmedTosRef ? {ref: trimmedTosRef, relay: normalizedTosRelay || undefined} : undefined,
      location: location.trim(),
      geohash: normalizedGeohash,
    }
  }

  const makeSignedEvent = async (
    role: SetupSigner,
    template: EventTemplate,
  ): Promise<SignedEvent> => role.signer.sign(prep(template, role.pubkey))

  const publishRequiredEvent = async (event: SignedEvent, relays: string[], requiredRelay?: string) => {
    const results = await publish({event, relays, timeout: 12_000})
    const normalizedRequiredRelay = normalizeRelay(requiredRelay)
    const requiredResult = normalizedRequiredRelay
      ? Object.entries(results).find(([relay]) => normalizeRelay(relay) === normalizedRequiredRelay)?.[1]
      : undefined
    const accepted = normalizedRequiredRelay
      ? requiredResult?.status === PublishStatus.Success
      : Object.values(results).some(result => result.status === PublishStatus.Success)

    if (!accepted) {
      const detail = requiredResult?.detail || Object.values(results)[0]?.detail || "No relay accepted the event."
      throw new Error(detail)
    }
  }

  const getUserOutboxRelays = () => {
    try {
      return Router.get().FromUser().getUrls()
    } catch {
      return []
    }
  }

  const getRootPublishRelays = (communityRelays: string[]) =>
    normalizeRelays([...communityRelays, ...INDEXER_RELAYS, ...getUserOutboxRelays()])

  const cancel = () => goto("/explore")

  const createCommunity = async () => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in with your admin account first."})
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
      const setup = makeCommunitySetupRefs({
        communityPubkey: validated.community.pubkey,
        profileListPubkey: validated.delegatedAdmin.pubkey,
        badgeIssuerPubkey: validated.delegatedAdmin.pubkey,
        relays: validated.relays,
      })
      const communityProfile = createProfile({
        name: validated.name,
        display_name: validated.name,
        about: validated.description,
        website: validated.website,
        picture: validated.picture,
      })
      const communityDefinition = buildCommunityDefinition({
        relays: validated.relays,
        sections: setup.sections,
        description: validated.description,
        blossomServers: validated.blossomServers,
        mints: validated.mints,
        tos: validated.tos,
        location: validated.location,
        geohash: validated.geohash,
      })
      const profileLists = setup.sections.map(section =>
        makeCommunityProfileList({profileList: section.profileList, pubkeys: [$pubkey!]}),
      )
      const badgeDefinitions = setup.sections.map(section =>
        makeCommunityBadgeDefinition({
          badge: section.badge,
          name: `${section.name} writer`,
          description: `Can publish to the ${section.name} section in ${validated.name}.`,
        }),
      )
      const badgeAwards = setup.sections.map(section =>
        makeCommunityBadgeAward({badge: section.badge, pubkeys: [$pubkey!]}),
      )
      const signedCommunityProfile = await makeSignedEvent(validated.community, communityProfile)
      const signedDefinition = await makeSignedEvent(validated.community, communityDefinition)
      const signedProfileLists = await Promise.all(
        profileLists.map(template => makeSignedEvent(validated.delegatedAdmin, template)),
      )
      const signedBadgeDefinitions = await Promise.all(
        badgeDefinitions.map(template => makeSignedEvent(validated.delegatedAdmin, template)),
      )
      const signedBadgeAwards = await Promise.all(
        badgeAwards.map(template => makeSignedEvent(validated.delegatedAdmin, template)),
      )
      const rootRelays = getRootPublishRelays(validated.relays)
      const communityScopedEvents = [
        ...signedProfileLists,
        ...signedBadgeDefinitions,
        ...signedBadgeAwards,
      ]

      await publishRequiredEvent(signedCommunityProfile, rootRelays, validated.primaryRelay)
      await publishRequiredEvent(signedDefinition, rootRelays, validated.primaryRelay)

      for (const event of communityScopedEvents) {
        await publishRequiredEvent(event, validated.relays, validated.primaryRelay)
      }

      const relayParams = validated.relays.map(relay => `relay=${encodeURIComponent(relay)}`).join("&")
      setActiveCommunityInput(
        `ncommunity://${validated.community.pubkey}${relayParams ? `?${relayParams}` : ""}`,
      )
      const parsedDefinition = parseCommunityDefinition(signedDefinition)
      if (parsedDefinition) setActiveCommunityDefinition(parsedDefinition)

      pushToast({message: "Community created."})
      goto(makeCommunityPath(validated.community.pubkey))
    } catch (error) {
      pushToast({theme: "error", message: `Community setup failed: ${String(error)}`})
    } finally {
      loading = false
    }
  }

  let loading = $state(false)
  let name = $state("")
  let description = $state("")
  let website = $state("")
  let picture = $state("")
  let communitySecret = $state("")
  let primaryRelay = $state("")
  let extraRelays = $state("")
  let blossomServers = $state("")
  let mints = $state("")
  let tosRef = $state("")
  let tosRelay = $state("")
  let location = $state("")
  let geohash = $state("")
  let delegatedAdminSecret = $state("")
  let websitePrefilled = $state(false)
  let errors = $state<FieldErrors>({})
  const disabled = $derived(loading ? true : undefined)

  $effect(() => {
    const communityPubkey = getPubkeyFromSecret(communitySecret)
    if (!communityPubkey || websitePrefilled) return

    websitePrefilled = true

    if (!website.trim()) website = makeBudabitCommunityUrl(communityPubkey)
  })
</script>

<form class="min-h-full bg-base-200" onsubmit={preventDefault(createCommunity)}>
  <div class="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 lg:py-10">
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
            One-time setup
          </div>
          <h1 class="max-w-4xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Create a BudaBit community.
          </h1>
          <p class="mt-5 max-w-2xl text-base leading-relaxed opacity-70 sm:text-lg">
            Bring your community key and prepared relay. BudaBit will publish the root definition,
            section publishing permissions, role badges, and your initial admin grant.
          </p>
        </div>
        <div
          class="rounded-2xl border border-warning/35 bg-warning/15 p-4 text-sm leading-relaxed text-base-content shadow-sm shadow-warning/5">
          <strong class="block text-base font-semibold text-warning">
            Secrets are not saved.
          </strong>
          <span class="mt-1 block text-base-content/80">
            They sign setup events in this tab only. Back up the community key; losing it means you
            cannot update the community definition.
          </span>
        </div>
      </div>
    </section>

    <div class="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div class="space-y-6">
        <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
          <div class="mb-5 flex items-start justify-between gap-4">
            <div>
              <strong class="text-lg">Community identity</strong>
              <p class="mt-1 text-sm opacity-65">
                The root key signs the public profile and kind:10222 rules.
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
            <Field error={errors.communitySecret}>
              {#snippet label()}<p>
                  Community secret key <span class="text-primary">(required)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  bind:value={communitySecret}
                  class="input input-bordered w-full {errors.communitySecret ? 'input-error' : ''}"
                  onblur={() => validateField("communitySecret")}
                  type="password"
                  placeholder="nsec1... or hex" />{/snippet}
              {#snippet info()}Signs only the community profile and definition.{/snippet}
            </Field>
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
              {#snippet info()}Prefilled from the community key; edit it if you want a different
                public URL.{/snippet}
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
                  placeholder="One relay per line"></textarea
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
                  placeholder="One server per line"></textarea
                >{/snippet}
            </Field>
            <Field error={errors.mints}>
              {#snippet label()}<p>Mints <span class="opacity-60">(optional)</span></p>{/snippet}
              {#snippet input()}<textarea
                  bind:value={mints}
                  class="textarea textarea-bordered {errors.mints ? 'textarea-error' : ''}"
                  onblur={() => validateField("mints")}
                  rows="2"
                  placeholder="https://mint.example.com cashu"></textarea
                >{/snippet}
            </Field>
          </div>
        </section>
      </div>

      <aside class="space-y-6 lg:sticky lg:top-6 lg:self-start">
        <section
          class="rounded-[1.5rem] border border-primary/25 bg-primary/5 p-5 shadow-sm sm:p-6">
          <strong class="text-lg">Delegated admin signer</strong>
          <p class="mt-2 text-sm opacity-70">
            This signer manages who can publish in each community section and issues the matching
            role badges. Leave it blank to use your logged-in admin account.
          </p>
          <div class="mt-5 space-y-4">
            <Field error={errors.delegatedAdminSecret}>
              {#snippet label()}<p>
                  Delegated admin secret <span class="opacity-60">(optional)</span>
                </p>{/snippet}
              {#snippet input()}<input
                  bind:value={delegatedAdminSecret}
                  class="input input-bordered w-full {errors.delegatedAdminSecret ? 'input-error' : ''}"
                  onblur={() => validateField("delegatedAdminSecret")}
                  type="password"
                  placeholder="Optional nsec or hex" />{/snippet}
              {#snippet info()}Used once to create the default publishing lists and role badges.{/snippet}
            </Field>
          </div>
        </section>

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
            <div class="rounded-xl bg-base-200 p-3"><strong>8</strong><br />publish lists</div>
            <div class="rounded-xl bg-base-200 p-3"><strong>8</strong><br />role badges</div>
            <div class="rounded-xl bg-base-200 p-3"><strong>8</strong><br />admin grants</div>
          </div>
          <p class="mt-3 text-xs leading-relaxed opacity-60">
            Profile and definition go to community, bootstrap, and user outbox relays. Lists,
            badges, and grants stay on community relays.
          </p>
          <div class="mt-5 flex gap-2">
            <Button class="btn btn-ghost flex-1" onclick={cancel} {disabled}>Cancel</Button>
            <Button
              class="btn btn-primary flex-1"
              type="submit"
              disabled={disabled ||
                !name.trim() ||
                !communitySecret.trim() ||
                !primaryRelay.trim()}>
              {#if loading}<span class="loading loading-spinner mr-2"></span>{/if}
              Create
            </Button>
          </div>
        </section>
      </aside>
    </div>
  </div>
</form>
