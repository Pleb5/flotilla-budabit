<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository, waitForThunkCompletion} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, type TrustedEvent} from "@welshman/util"
  import MedalStar from "@assets/icons/medal-star.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import Field from "@lib/components/Field.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import CommunityBadgeAwardForm from "@app/components/CommunityBadgeAwardForm.svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import ProfileLink from "@app/components/ProfileLink.svelte"
  import {preventDefault} from "@lib/html"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {promptBlossomMirrorUpload} from "@app/util/blossom-mirror-prompt"
  import {uploadFile} from "@app/core/commands"
  import type {BlossomUploadStage} from "@app/core/blossom"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
    activeCommunityReportState,
    getCommunityBadgeRelays,
  } from "@app/core/community-state"
  import {normalizePubkey, normalizeRelays} from "@app/core/community"
  import {getPubkeyOutboxRelays, getUserDataPublishRelays} from "@app/core/community-relays"
  import {
    canCreateCommunityBadge,
    getAcceptedCommunityBadges,
    getCommunityBadgeImageUrl,
    getPendingCommunityBadgeAwards,
    isCommunityBadgeAwardDeleted,
    makeCommunityBadgeAwardDelete,
    makeCommunityBadgeAwardDeleteFilters,
    makeCommunityBadgeDefinitionEvent,
    makeCommunityBadgeDefinitionFilters,
    makeCommunityBadgeAwardFilters,
    makeProfileBadgeAcceptanceEvent,
    makeProfileBadgeFilters,
    makeProfileBadgeRemovalEvent,
    parseCommunityBadgeAward,
    selectCommunityBadgeDefinitions,
    selectProfileBadgesEvent,
    type AcceptedCommunityBadge,
    type CommunityBadgeAward,
    type CommunityBadgeDefinition,
    type PendingCommunityBadgeAward,
  } from "@app/core/community-badges"
  import {parseCommunityRouteParam} from "@app/util/routes"

  type BadgePageTab = "awarded" | "mine"
  type MyBadgePanel = "awarded" | "studio" | "retired"
  type AwardItem = {
    award: CommunityBadgeAward
    revoked: boolean
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
  const badgeRelays = $derived(
    normalizeRelays(getCommunityBadgeRelays(communityBootstrapReady ? $activeCommunityRelays : [])),
  )
  const communityProfileRelays = $derived(communityBootstrapReady ? $activeCommunityRelays : [])

  let pageTab = $state<BadgePageTab>("awarded")
  let myBadgePanel = $state<MyBadgePanel>("awarded")
  let badgeName = $state("")
  let badgeDescription = $state("")
  let badgeImage = $state("")
  let badgeImageDimensions = $state("")
  let editingDefinitionAddress = $state("")
  let publishing = $state(false)
  let uploadingImage = $state(false)
  let imageUploadStage = $state<BlossomUploadStage>("idle")
  let imageUploadNote = $state("")

  const canManageBadges = $derived(
    Boolean(
      communityBootstrapReady &&
      $activeCommunityDefinition &&
      $pubkey &&
      canCreateCommunityBadge({
        definition: $activeCommunityDefinition,
        pubkey: $pubkey,
        profileListEvents: $activeCommunityProfileListEvents,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const badgeDefinitionFilters = $derived(
    communityBootstrapReady && $activeCommunityDefinition
      ? makeCommunityBadgeDefinitionFilters({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const badgeDefinitionEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeDefinitionFilters})),
  )
  const badgeDefinitions = $derived.by((): CommunityBadgeDefinition[] =>
    $activeCommunityDefinition
      ? selectCommunityBadgeDefinitions({
          definition: $activeCommunityDefinition,
          badgeDefinitionEvents: $badgeDefinitionEvents,
          profileListEvents: $activeCommunityProfileListEvents,
          reportState: $activeCommunityReportState,
          includeDeprecated: true,
        })
      : [],
  )
  const activeBadgeDefinitions = $derived(
    badgeDefinitions.filter(definition => !definition.deprecated),
  )
  const retiredBadgeDefinitions = $derived(
    badgeDefinitions.filter(definition => definition.deprecated),
  )
  const ownActiveBadgeDefinitions = $derived(
    activeBadgeDefinitions.filter(
      definition => definition.pubkey === normalizePubkey($pubkey || ""),
    ),
  )
  const ownRetiredBadgeDefinitions = $derived(
    retiredBadgeDefinitions.filter(
      definition => definition.pubkey === normalizePubkey($pubkey || ""),
    ),
  )
  const editingDefinition = $derived(
    ownActiveBadgeDefinitions.find(definition => definition.address === editingDefinitionAddress),
  )
  const badgeAwardFilters = $derived(
    makeCommunityBadgeAwardFilters({definitions: badgeDefinitions}),
  )
  const badgeAwardEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeAwardFilters})),
  )
  const badgeAwardDeleteFilters = $derived(makeCommunityBadgeAwardDeleteFilters($badgeAwardEvents))
  const badgeAwardDeleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: badgeAwardDeleteFilters})),
  )
  const profileBadgeFilters = $derived($pubkey ? makeProfileBadgeFilters($pubkey) : [])
  const profileBadgeEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: profileBadgeFilters})),
  )
  const acceptedBadges = $derived.by(() =>
    $activeCommunityDefinition && $pubkey
      ? getAcceptedCommunityBadges({
          definition: $activeCommunityDefinition,
          badgeDefinitionEvents: $badgeDefinitionEvents,
          profileListEvents: $activeCommunityProfileListEvents,
          badgeAwardEvents: $badgeAwardEvents,
          badgeAwardDeleteEvents: $badgeAwardDeleteEvents,
          profileBadgeEvents: $profileBadgeEvents,
          profilePubkey: $pubkey,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const pendingAwards = $derived.by((): PendingCommunityBadgeAward[] =>
    $activeCommunityDefinition && $pubkey
      ? getPendingCommunityBadgeAwards({
          definition: $activeCommunityDefinition,
          badgeDefinitionEvents: $badgeDefinitionEvents,
          profileListEvents: $activeCommunityProfileListEvents,
          badgeAwardEvents: $badgeAwardEvents,
          badgeAwardDeleteEvents: $badgeAwardDeleteEvents,
          profileBadgeEvents: $profileBadgeEvents,
          profilePubkey: $pubkey,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const hasSuccessfulRelay = (thunk: ReturnType<typeof publishThunk>) =>
    Object.values(thunk.results).some(result => result.status === "success")

  const getPublishError = (thunk: ReturnType<typeof publishThunk>) => {
    const result = Object.values(thunk.results).find(result => result.status !== "success")

    return result ? `${result.relay}: ${result.detail || result.status}` : "No relay confirmed."
  }

  const publishTemplate = async (template: {kind: number; content: string; tags: string[][]}) => {
    if (badgeRelays.length === 0) throw new Error("No badge relays are available.")

    const thunk = publishThunk({relays: badgeRelays, event: makeEvent(template.kind, template)})
    await waitForThunkCompletion(thunk)
    if (!hasSuccessfulRelay(thunk)) throw new Error(getPublishError(thunk))
    repository.publish(thunk.event as TrustedEvent)
  }

  const publishProfileBadgeTemplate = async (template: {
    kind: number
    content: string
    tags: string[][]
  }) => {
    const relays = getUserDataPublishRelays([...getPubkeyOutboxRelays($pubkey), ...badgeRelays])
    if (relays.length === 0) throw new Error("No profile badge relays are available.")

    const thunk = publishThunk({relays, event: makeEvent(template.kind, template)})
    await waitForThunkCompletion(thunk)
    if (!hasSuccessfulRelay(thunk)) throw new Error(getPublishError(thunk))
    repository.publish(thunk.event as TrustedEvent)
  }

  const runPublish = async (action: () => Promise<void>, successMessage: string) => {
    publishing = true
    try {
      await action()
      pushToast({theme: "success", message: successMessage})
      return true
    } catch (error) {
      pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
      return false
    } finally {
      publishing = false
    }
  }

  const confirmAction = ({
    title,
    message,
    confirm,
  }: {
    title: string
    message: string
    confirm: () => Promise<boolean>
  }) => {
    pushModal(Confirm, {
      title,
      message,
      confirm: async () => {
        if (await confirm()) history.back()
      },
    })
  }

  const resetBadgeForm = () => {
    editingDefinitionAddress = ""
    badgeName = ""
    badgeDescription = ""
    badgeImage = ""
    badgeImageDimensions = ""
    imageUploadStage = "idle"
    imageUploadNote = ""
  }

  const editBadge = (definition: CommunityBadgeDefinition) => {
    editingDefinitionAddress = definition.address
    badgeName = definition.name
    badgeDescription = definition.description || ""
    badgeImage = definition.image || ""
    badgeImageDimensions = definition.imageDimensions || ""
    imageUploadStage = "idle"
    imageUploadNote = ""
    myBadgePanel = "studio"
  }

  const buildBadgeDefinitionTemplate = (deprecated = false) => {
    if (!$activeCommunityDefinition) throw new Error("Community definition is not loaded.")

    const identifier = editingDefinition?.identifier || `badge-${crypto.randomUUID()}`
    if (!badgeName.trim()) throw new Error("Add a badge name first.")

    return makeCommunityBadgeDefinitionEvent({
      communityPubkey: $activeCommunityDefinition.pubkey,
      identifier,
      name: badgeName,
      description: badgeDescription,
      image: badgeImage,
      imageDimensions: badgeImage.trim() ? badgeImageDimensions || undefined : undefined,
      thumbs:
        editingDefinition && badgeImage === editingDefinition.image ? editingDefinition.thumbs : [],
      deprecated,
    })
  }

  const publishBadgeDefinition = async (deprecated = false) => {
    if (!canManageBadges) throw new Error("Log in as the admin or an active moderator first.")

    await publishTemplate(buildBadgeDefinitionTemplate(deprecated))
    resetBadgeForm()
  }

  const submitBadgeDefinition = () => {
    if (editingDefinition) {
      confirmAction({
        title: "Publish badge changes",
        message: `Publish edits to ${editingDefinition.name}? Existing awards will point to the updated definition.`,
        confirm: () => runPublish(() => publishBadgeDefinition(false), "Badge definition updated."),
      })
      return
    }

    void runPublish(() => publishBadgeDefinition(false), "Badge definition published.")
  }

  const retireBadge = (definition: CommunityBadgeDefinition) => {
    confirmAction({
      title: "Retire badge",
      message: `Retire ${definition.name}? It will be hidden from profiles but remain visible here.`,
      confirm: () =>
        runPublish(
          () =>
            publishTemplate(
              makeCommunityBadgeDefinitionEvent({
                communityPubkey: $activeCommunityDefinition!.pubkey,
                identifier: definition.identifier,
                name: definition.name,
                description: definition.description,
                image: definition.image,
                imageDimensions: definition.imageDimensions,
                thumbs: definition.thumbs,
                deprecated: true,
              }),
            ),
          "Badge retired.",
        ),
    })
  }

  const resurrectBadge = (definition: CommunityBadgeDefinition) => {
    confirmAction({
      title: "Resurrect badge",
      message: `Make ${definition.name} active again? Existing valid awards can become visible again when accepted.`,
      confirm: () =>
        runPublish(
          () =>
            publishTemplate(
              makeCommunityBadgeDefinitionEvent({
                communityPubkey: $activeCommunityDefinition!.pubkey,
                identifier: definition.identifier,
                name: definition.name,
                description: definition.description,
                image: definition.image,
                imageDimensions: definition.imageDimensions,
                thumbs: definition.thumbs,
                deprecated: false,
              }),
            ),
          "Badge resurrected.",
        ),
    })
  }

  const acceptAward = async (award: PendingCommunityBadgeAward) => {
    if (!$pubkey) {
      pushToast({theme: "error", message: "Log in with the awarded pubkey first."})
      return
    }

    const currentEvent = selectProfileBadgesEvent($profileBadgeEvents, $pubkey)
    const relayHint = $activeCommunityRelays[0] || badgeRelays[0]

    await runPublish(
      () =>
        publishProfileBadgeTemplate(
          makeProfileBadgeAcceptanceEvent({
            currentEvent,
            pair: {
              definitionAddress: award.definition.address,
              definitionRelay: relayHint,
              awardId: award.award.event.id,
              awardRelay: relayHint,
            },
          }),
        ),
      "Badge accepted on your profile.",
    )
  }

  const optOutBadge = async (badge: AcceptedCommunityBadge) => {
    if (!$pubkey) return

    const currentEvent = selectProfileBadgesEvent($profileBadgeEvents, $pubkey)

    await runPublish(
      () =>
        publishProfileBadgeTemplate(
          makeProfileBadgeRemovalEvent({
            currentEvent,
            pair: badge.profilePair,
          }),
        ),
      "Badge removed from your profile.",
    )
  }

  const revokeAward = (definition: CommunityBadgeDefinition, award: CommunityBadgeAward) => {
    confirmAction({
      title: "Revoke badge award",
      message: `Revoke ${definition.name} from this recipient?`,
      confirm: () =>
        runPublish(
          () => publishTemplate(makeCommunityBadgeAwardDelete({awardId: award.event.id})),
          "Badge award revoked.",
        ),
    })
  }

  const getImageDimensions = (file: File) =>
    new Promise<{width: number; height: number}>((resolve, reject) => {
      const url = URL.createObjectURL(file)
      const image = new Image()

      image.onload = () => {
        URL.revokeObjectURL(url)
        resolve({width: image.naturalWidth, height: image.naturalHeight})
      }
      image.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error("Could not read image dimensions."))
      }
      image.src = url
    })

  const uploadBadgeImage = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement
    const file = input.files?.[0]
    if (!file) return

    uploadingImage = true
    imageUploadStage = "preparing"
    imageUploadNote = ""

    try {
      if (!file.type.startsWith("image/")) throw new Error("Choose an image file.")

      const {width, height} = await getImageDimensions(file)
      const largest = Math.max(width, height)
      const smallest = Math.min(width, height)

      if (smallest === 0 || largest / smallest > 1.1) {
        throw new Error("Badge images must be square or very close to square.")
      }
      if (smallest < 512) {
        imageUploadNote = "Uploaded, but 1024x1024 is recommended for high quality badges."
      } else if (smallest < 1024) {
        imageUploadNote = "Uploaded. 1024x1024 is recommended by NIP-58."
      }

      const {error, result, uploadId} = await uploadFile(file, {
        blossomContext: {type: "badge", communityPubkey},
        maxWidth: 1024,
        maxHeight: 1024,
        onStage: stage => (imageUploadStage = stage),
      })

      if (error || !result?.url) throw new Error(error || "Image upload failed.")

      badgeImage = result.url
      promptBlossomMirrorUpload(uploadId)
      badgeImageDimensions =
        width === height ? `${Math.min(width, 1024)}x${Math.min(height, 1024)}` : ""

      pushToast({
        theme: "success",
        message: "Badge image uploaded.",
      })
    } catch (error) {
      imageUploadStage = "failed"
      pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
    } finally {
      uploadingImage = false
      input.value = ""
    }
  }

  const getDefinitionAwardItems = (
    definition: CommunityBadgeDefinition,
    options: {includeRevoked?: boolean} = {},
  ): AwardItem[] =>
    $badgeAwardEvents
      .map(parseCommunityBadgeAward)
      .filter((award): award is CommunityBadgeAward => Boolean(award))
      .filter(award => award.definitionAddress === definition.address)
      .filter(award => award.event.pubkey === definition.pubkey)
      .map(award => ({
        award,
        revoked: isCommunityBadgeAwardDeleted(award.event, $badgeAwardDeleteEvents),
      }))
      .filter(item => options.includeRevoked || !item.revoked)
      .toSorted(
        (a, b) =>
          b.award.event.created_at - a.award.event.created_at ||
          a.award.event.id.localeCompare(b.award.event.id),
      )

  const getDefinitionAwardCount = (definition: CommunityBadgeDefinition) =>
    getDefinitionAwardItems(definition).length

  const getDefinitionRecipientCount = (definition: CommunityBadgeDefinition) =>
    new Set(getDefinitionAwardItems(definition).map(item => item.award.recipientPubkey)).size

  $effect(() => {
    if (canManageBadges || pageTab !== "mine") return

    pageTab = "awarded"
  })

  $effect(() => {
    if (!communityBootstrapReady || badgeRelays.length === 0) return

    const filters = [
      ...badgeDefinitionFilters,
      ...badgeAwardFilters,
      ...badgeAwardDeleteFilters,
      ...profileBadgeFilters,
    ]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: badgeRelays, autoClose: true, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={MedalStar} /></div>
  {/snippet}
  {#snippet title()}<strong>Community Badges</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  {#if communityBootstrapLoading}
    <p class="flex h-10 items-center justify-center py-20 text-center">
      <Spinner loading>Loading community badge state...</Spinner>
    </p>
  {:else if !communityBootstrapReady || !$activeCommunityDefinition}
    <p class="py-8 text-center opacity-70">Community definition is not loaded.</p>
  {:else if !$pubkey}
    <section class="card2 bg-alt p-4 text-center shadow-md">
      <strong>Log in to manage awarded badges</strong>
      <p class="mt-2 text-sm opacity-70">
        Badge awards are public, but accepting or opting out updates your profile badge list.
      </p>
    </section>
  {:else}
    <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
      <div class="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 class="text-xl font-semibold">Badges</h2>
          <p class="mt-1 text-sm opacity-70">
            Badge awards only show on profiles after recipients accept them. Retired badges are
            hidden everywhere except this page.
          </p>
        </div>
        <div class="flex flex-wrap gap-2">
          <span class="badge badge-success">{activeBadgeDefinitions.length} active</span>
          <span class="badge badge-neutral">{retiredBadgeDefinitions.length} retired</span>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <Button
          class={`btn ${pageTab === "awarded" ? "btn-primary" : "btn-ghost"}`}
          onclick={() => (pageTab = "awarded")}>
          Awarded badges
          <span class="badge ml-2">{acceptedBadges.length + pendingAwards.length}</span>
        </Button>
        {#if canManageBadges}
          <Button
            class={`btn ${pageTab === "mine" ? "btn-primary" : "btn-ghost"}`}
            onclick={() => (pageTab = "mine")}>
            My Badges
          </Button>
        {/if}
      </div>
    </section>

    {#if pageTab === "awarded"}
      <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 class="text-xl font-semibold">Awarded badges</h2>
            <p class="text-sm opacity-70">
              Accepted badges are in your kind 10008 profile badge list. Pending badges are visible
              only to you and the issuer until accepted.
            </p>
          </div>
          <div class="flex flex-wrap gap-2">
            <span class="badge badge-success">{acceptedBadges.length} accepted</span>
            <span class="badge badge-warning">{pendingAwards.length} pending</span>
          </div>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <div class="flex flex-col gap-3">
            <h3 class="font-semibold">Accepted</h3>
            {#each acceptedBadges as badge (badge.award.event.id)}
              {@const badgeImage = getCommunityBadgeImageUrl(badge.definition, 96)}
              <article class="rounded-box border border-success bg-success/10 p-4">
                <div class="flex items-start gap-3">
                  {#if badgeImage}
                    <img alt="" src={badgeImage} class="h-12 w-12 rounded-full object-cover" />
                  {:else}
                    <div class="center h-12 w-12 rounded-full bg-base-300">
                      <Icon icon={MedalStar} />
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <strong>{badge.definition.name}</strong>
                    <p class="mt-1 text-sm opacity-70">
                      Awarded by
                      <ProfileLink
                        pubkey={badge.definition.pubkey}
                        relays={communityProfileRelays} />
                    </p>
                    {#if badge.definition.description}
                      <p class="mt-2 text-sm opacity-80">{badge.definition.description}</p>
                    {/if}
                  </div>
                </div>
                <div class="mt-3 flex justify-end">
                  <Button
                    class="btn btn-ghost btn-sm"
                    disabled={publishing}
                    onclick={() => optOutBadge(badge)}>
                    Opt out
                  </Button>
                </div>
              </article>
            {:else}
              <p class="rounded-box bg-base-200 p-4 text-sm opacity-70">
                No accepted badges for this pubkey.
              </p>
            {/each}
          </div>

          <div class="flex flex-col gap-3">
            <h3 class="font-semibold">Pending</h3>
            {#each pendingAwards as item (item.award.event.id)}
              {@const badgeImage = getCommunityBadgeImageUrl(item.definition, 96)}
              <article class="rounded-box border border-warning bg-warning/10 p-4">
                <div class="flex items-start gap-3">
                  {#if badgeImage}
                    <img alt="" src={badgeImage} class="h-12 w-12 rounded-full object-cover" />
                  {:else}
                    <div class="center h-12 w-12 rounded-full bg-base-300">
                      <Icon icon={MedalStar} />
                    </div>
                  {/if}
                  <div class="min-w-0 flex-1">
                    <strong>{item.definition.name}</strong>
                    <p class="mt-1 text-sm opacity-70">
                      Awarded by
                      <ProfileLink
                        pubkey={item.definition.pubkey}
                        relays={communityProfileRelays} />
                    </p>
                    {#if item.definition.description}
                      <p class="mt-2 text-sm opacity-80">{item.definition.description}</p>
                    {/if}
                  </div>
                </div>
                <div class="mt-3 flex justify-end">
                  <Button
                    class="btn btn-primary btn-sm"
                    disabled={publishing}
                    onclick={() => acceptAward(item)}>
                    Accept badge
                  </Button>
                </div>
              </article>
            {:else}
              <p class="rounded-box bg-base-200 p-4 text-sm opacity-70">
                No pending badge awards for this pubkey.
              </p>
            {/each}
          </div>
        </div>
      </section>
    {:else if canManageBadges}
      <section class="card2 bg-alt flex flex-col gap-4 p-4 shadow-md">
        <div class="flex flex-wrap gap-2">
          <Button
            class={`btn btn-sm ${myBadgePanel === "awarded" ? "btn-primary" : "btn-ghost"}`}
            onclick={() => (myBadgePanel = "awarded")}>
            Awarded
          </Button>
          <Button
            class={`btn btn-sm ${myBadgePanel === "studio" ? "btn-primary" : "btn-ghost"}`}
            onclick={() => (myBadgePanel = "studio")}>
            Badge Studio
          </Button>
          <Button
            class={`btn btn-sm ${myBadgePanel === "retired" ? "btn-primary" : "btn-ghost"}`}
            onclick={() => (myBadgePanel = "retired")}>
            Retired Badges
            <span class="badge ml-2">{ownRetiredBadgeDefinitions.length}</span>
          </Button>
        </div>

        {#if myBadgePanel === "awarded"}
          <div class="flex flex-col gap-4">
            <div>
              <h2 class="text-xl font-semibold">Awarded</h2>
              <p class="text-sm opacity-70">
                Active badge awards grouped by badge. Revocation publishes a delete for the award
                event.
              </p>
            </div>

            {#each ownActiveBadgeDefinitions as definition (definition.address)}
              {@const awards = getDefinitionAwardItems(definition)}
              {@const badgeImage = getCommunityBadgeImageUrl(definition, 96)}
              <article class="rounded-box border border-base-300 bg-base-100 p-4">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex min-w-0 items-start gap-3">
                    {#if badgeImage}
                      <img alt="" src={badgeImage} class="h-12 w-12 rounded-full object-cover" />
                    {:else}
                      <div class="center h-12 w-12 rounded-full bg-base-300">
                        <Icon icon={MedalStar} />
                      </div>
                    {/if}
                    <div class="min-w-0">
                      <strong>{definition.name}</strong>
                      <p class="mt-1 text-sm opacity-70">
                        {getDefinitionRecipientCount(definition)} recipients across {awards.length}
                        awards
                      </p>
                    </div>
                  </div>
                  <Button class="btn btn-ghost btn-sm" onclick={() => editBadge(definition)}
                    >Edit</Button>
                </div>

                {#if awards.length > 0}
                  <div class="mt-4 flex flex-col gap-2">
                    {#each awards as item (item.award.event.id)}
                      <div class="rounded-box bg-base-200 p-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div class="flex flex-wrap gap-2">
                            <span class="badge badge-neutral h-auto py-1">
                              <ProfileLink
                                pubkey={item.award.recipientPubkey}
                                relays={communityProfileRelays} />
                            </span>
                          </div>
                          <Button
                            class="btn btn-error btn-xs"
                            disabled={publishing || item.award.event.pubkey !== $pubkey}
                            onclick={() => revokeAward(definition, item.award)}>
                            Revoke
                          </Button>
                        </div>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="mt-3 rounded-box bg-base-200 p-3 text-sm opacity-70">
                    No active awards for this badge.
                  </p>
                {/if}
              </article>
            {:else}
              <p class="rounded-box bg-base-200 p-4 text-sm opacity-70">
                You have not created any active badges yet.
              </p>
            {/each}
          </div>
        {:else if myBadgePanel === "studio"}
          <div class="grid gap-4 lg:grid-cols-2">
            <form class="flex flex-col gap-3" onsubmit={preventDefault(submitBadgeDefinition)}>
              <div>
                <h2 class="text-xl font-semibold">
                  {editingDefinition ? "Edit badge" : "Create badge"}
                </h2>
                <p class="text-sm opacity-70">
                  Create a badge your community can award to individual profiles.
                </p>
              </div>
              <Field>
                {#snippet label()}<p>Name</p>{/snippet}
                {#snippet input()}
                  <input
                    class="input input-bordered w-full"
                    placeholder="Community helper"
                    bind:value={badgeName} />
                {/snippet}
              </Field>
              <Field>
                {#snippet label()}<p>Description</p>{/snippet}
                {#snippet input()}
                  <textarea
                    class="textarea textarea-bordered min-h-24 w-full"
                    placeholder="Why this badge is awarded"
                    bind:value={badgeDescription}></textarea>
                {/snippet}
              </Field>
              <Field>
                {#snippet label()}<p>Badge image</p>{/snippet}
                {#snippet input()}
                  <div class="flex flex-col gap-2">
                    <input
                      type="file"
                      accept="image/*"
                      class="file-input file-input-bordered w-full"
                      disabled={uploadingImage}
                      onchange={uploadBadgeImage} />
                    <BlossomUploadStatus stage={imageUploadStage} />
                    <input
                      class="input input-bordered w-full"
                      placeholder="https://example.com/badge.png"
                      disabled={uploadingImage}
                      value={badgeImage}
                      oninput={event => {
                        badgeImage = event.currentTarget.value
                        badgeImageDimensions = ""
                      }} />
                  </div>
                {/snippet}
                {#snippet info()}
                  Square images are required. NIP-58 recommends 1024x1024 pixels.
                  {#if imageUploadNote}{imageUploadNote}{/if}
                {/snippet}
              </Field>
              {#if badgeImage}
                <div class="flex items-center gap-3 rounded-box bg-base-200 p-3">
                  <img alt="" src={badgeImage} class="h-16 w-16 rounded-full object-cover" />
                  <p class="break-all text-xs opacity-70">{badgeImage}</p>
                </div>
              {/if}
              <div class="flex flex-wrap justify-end gap-2">
                {#if editingDefinition}
                  <Button class="btn btn-ghost" onclick={resetBadgeForm}>Cancel edit</Button>
                {/if}
                <Button
                  type="submit"
                  class="btn btn-primary"
                  disabled={publishing || uploadingImage}>
                  {editingDefinition ? "Publish changes" : "Publish badge"}
                </Button>
              </div>
            </form>

            <div class="flex flex-col gap-4">
              <CommunityBadgeAwardForm />

              <div class="flex flex-col gap-3 rounded-box border border-base-300 bg-base-100 p-4">
                <h3 class="font-semibold">Your active badges</h3>
                {#each ownActiveBadgeDefinitions as definition (definition.address)}
                  <div
                    class="flex flex-wrap items-center justify-between gap-2 rounded-box bg-base-200 p-3">
                    <div>
                      <strong>{definition.name}</strong>
                      <p class="text-xs opacity-60">{getDefinitionAwardCount(definition)} awards</p>
                    </div>
                    <div class="flex flex-wrap gap-2">
                      <Button class="btn btn-ghost btn-xs" onclick={() => editBadge(definition)}>
                        Edit
                      </Button>
                      <Button
                        class="btn btn-warning btn-xs"
                        onclick={() => retireBadge(definition)}>
                        Retire
                      </Button>
                    </div>
                  </div>
                {:else}
                  <p class="rounded-box bg-base-200 p-3 text-sm opacity-70">
                    No active badge definitions yet.
                  </p>
                {/each}
              </div>
            </div>
          </div>
        {:else}
          <div class="flex flex-col gap-4">
            <div>
              <h2 class="text-xl font-semibold">Retired Badges</h2>
              <p class="text-sm opacity-70">
                Retired badges carry a deprecated tag and are hidden from profile surfaces. You can
                inspect their award history or resurrect them.
              </p>
            </div>

            {#each ownRetiredBadgeDefinitions as definition (definition.address)}
              {@const awards = getDefinitionAwardItems(definition, {includeRevoked: true})}
              {@const badgeImage = getCommunityBadgeImageUrl(definition, 96)}
              <article class="rounded-box border border-base-300 bg-base-100 p-4 opacity-90">
                <div class="flex flex-wrap items-start justify-between gap-3">
                  <div class="flex min-w-0 items-start gap-3">
                    {#if badgeImage}
                      <img
                        alt=""
                        src={badgeImage}
                        class="h-12 w-12 rounded-full object-cover grayscale" />
                    {:else}
                      <div class="center h-12 w-12 rounded-full bg-base-300">
                        <Icon icon={MedalStar} />
                      </div>
                    {/if}
                    <div class="min-w-0">
                      <div class="flex flex-wrap items-center gap-2">
                        <strong>{definition.name}</strong>
                        <span class="badge badge-neutral">retired</span>
                      </div>
                      <p class="mt-1 text-sm opacity-70">
                        {awards.length} historical award events
                      </p>
                    </div>
                  </div>
                  <Button class="btn btn-success btn-sm" onclick={() => resurrectBadge(definition)}>
                    Resurrect
                  </Button>
                </div>

                {#if awards.length > 0}
                  <div class="mt-4 flex flex-col gap-2">
                    {#each awards as item (item.award.event.id)}
                      <div class="rounded-box bg-base-200 p-3">
                        <div class="flex flex-wrap items-center justify-between gap-2">
                          <div class="flex flex-wrap gap-2">
                            <span class="badge h-auto py-1" class:badge-error={item.revoked}>
                              <ProfileLink
                                pubkey={item.award.recipientPubkey}
                                relays={communityProfileRelays} />
                            </span>
                            {#if item.revoked}<span class="badge badge-error">revoked</span>{/if}
                          </div>
                          {#if !item.revoked}
                            <Button
                              class="btn btn-error btn-xs"
                              disabled={publishing || item.award.event.pubkey !== $pubkey}
                              onclick={() => revokeAward(definition, item.award)}>
                              Revoke
                            </Button>
                          {/if}
                        </div>
                      </div>
                    {/each}
                  </div>
                {:else}
                  <p class="mt-3 rounded-box bg-base-200 p-3 text-sm opacity-70">
                    No awards were found for this retired badge.
                  </p>
                {/if}
              </article>
            {:else}
              <p class="rounded-box bg-base-200 p-4 text-sm opacity-70">
                You do not have any retired badges.
              </p>
            {/each}
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</PageContent>
