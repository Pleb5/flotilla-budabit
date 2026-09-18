<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE, makeEvent, getTagValue, type TrustedEvent} from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import Widget from "@assets/icons/widget.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Field from "@lib/components/Field.svelte"
  import Button from "@lib/components/Button.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {uploadFile, type BlossomMirrorUploadResult} from "@app/core/commands"
  import type {BlossomUploadStage} from "@app/core/blossom"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeExactCommunityPointer,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeExactCommunityRelays,
    activeUserCommunityRefs,
  } from "@app/core/community-state"
  import {
    makeCommunityPointer,
    normalizePubkey,
    parseCommunityDefinition,
    parseCommunityNaddr,
  } from "@app/core/community"
  import {
    SMART_WIDGET_KIND,
    makeCommunityContentFilterPlan,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilterPlan,
    makeTargetedPublicationOriginalRelayHintPlans,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    communityWritableSectionsSupportTarget,
    filterAuthorizedCommunityTargetingEvents,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {loadBoundedCommunityHistory, makeSameAuthorDeleteFilters} from "@app/core/requests"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {isSecureEmbeddableUrl, SECURE_EMBED_URL_REQUIREMENT} from "@app/extensions/url-policy"
  import type {WidgetCommunitySlotType} from "@app/extensions/types"
  import {
    buildCommunityWidgetEventTags,
    filterSelectedWidgetCommunityOptions,
    getWidgetAppUrlsFromUpload,
  } from "@app/extensions/widget-publisher"
  import {
    getWidgetTargetPublishRelays,
    publishWidgetEventToTargets,
    publishWidgetTargetingEvent,
    type WidgetCommunityOption,
  } from "@app/extensions/widget-targeting"

  const parsedCommunity = $derived.by(() => {
    try {
      return parseCommunityNaddr(decodeURIComponent($page.params.community || ""))
    } catch {
      return undefined
    }
  })
  const communityPubkey = $derived(parsedCommunity?.ownerPubkey || "")
  const communityAddress = $derived(parsedCommunity?.address || "")
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      $activeExactCommunityDefinition?.ownerPubkey === communityPubkey &&
      $activeCommunityBootstrapStatus.loaded &&
      !$activeCommunityBootstrapStatus.loading,
    ),
  )
  const communityBootstrapLoading = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && !$activeCommunityBootstrapStatus.error),
  )
  const communityBootstrapFailed = $derived(
    Boolean(communityPubkey && !communityBootstrapReady && $activeCommunityBootstrapStatus.error),
  )
  const communityAuthorityReadiness = $derived(
    $activeCommunityDescriptor?.community.address === communityAddress
      ? $activeCommunityDescriptor.authorityReadiness.state
      : "loading",
  )
  const communityAuthorityLoading = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "loading",
  )
  const communityAuthorityReady = $derived(
    communityBootstrapReady && communityAuthorityReadiness === "ready",
  )
  const communityAuthorityUnavailable = $derived(communityAuthorityReadiness === "unavailable")
  const targetingFilters = $derived(
    communityAuthorityReady && $activeExactCommunityPointer
      ? [
          makeCommunityTargetingFilter($activeExactCommunityPointer.communityId, [
            SMART_WIDGET_KIND,
          ]),
        ]
      : [],
  )
  const targetingFilterPlan = $derived.by(() =>
    communityAuthorityReady && $activeExactCommunityDefinition
      ? makeCommunityContentFilterPlan(
          targetingFilters,
          getCommunityTargetWriterPubkeys({
            definition: $activeExactCommunityDefinition,
            profileListEvents: $activeCommunityProfileListEvents,
            target: COMMUNITY_WRITE_TARGETS.widget,
            reportState: $activeCommunityReportState,
          }),
        )
      : {relayFilters: [], localFilters: []},
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilterPlan.localFilters})),
  )
  const authorizedTargetingEvents = $derived.by(() =>
    communityAuthorityReady && $activeExactCommunityDefinition && $activeExactCommunityPointer
      ? filterAuthorizedCommunityTargetingEvents({
          community: $activeExactCommunityPointer,
          definition: $activeExactCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          events: $targetingEvents,
          reportState: $activeCommunityReportState,
          kinds: [SMART_WIDGET_KIND],
        })
      : [],
  )
  const targetDeleteFilterPlan = $derived.by(() => {
    const filters = makeSameAuthorDeleteFilters(authorizedTargetingEvents)

    return {relayFilters: filters, localFilters: filters}
  })
  const targetDeleteEvents = $derived(
    targetDeleteFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: targetDeleteFilterPlan.localFilters}),
        )
      : undefined,
  )
  const deletedTargetIds = $derived.by(() =>
    getDeletedTargetEventIds(
      authorizedTargetingEvents,
      $targetDeleteEvents ? ($targetDeleteEvents as TrustedEvent[]) : [],
    ),
  )
  const eligibleTargetingEvents = $derived(
    authorizedTargetingEvents.filter(event => !deletedTargetIds.has(event.id)),
  )
  const widgetFilterPlan = $derived(
    communityAuthorityReady && eligibleTargetingEvents.length
      ? makeTargetedPublicationOriginalFilterPlan(eligibleTargetingEvents)
      : {relayFilters: [], localFilters: []},
  )
  const widgetRelayHintPlans = $derived(
    makeTargetedPublicationOriginalRelayHintPlans(eligibleTargetingEvents),
  )
  const widgetFilters = $derived(widgetFilterPlan.localFilters)
  const widgets = $derived(deriveEventsAsc(deriveEventsById({repository, filters: widgetFilters})))
  const canCreateWidget = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      $activeExactCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeExactCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.widget,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const widgetAccessLoading = $derived(
    Boolean($pubkey && communityAuthorityLoading && !canCreateWidget),
  )

  const widgetCommunityOptions = $derived.by((): WidgetCommunityOption[] => {
    const options = $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.widget,
        }),
      )
      .flatMap(ref => {
        const definition = parseCommunityDefinition(ref.definition.event)
        if (!definition) return []
        const community = makeCommunityPointer({
          ownerPubkey: definition.pointer.ownerPubkey,
          communityId: definition.pointer.communityId,
          relayHints: [...definition.relays, ...ref.relayHints],
        })

        return community
          ? [
              {
                community,
                label: definition.metadata.name,
                relays: definition.relays,
                relayHints: ref.relayHints,
              },
            ]
          : []
      })

    if (
      canCreateWidget &&
      parsedCommunity &&
      $activeExactCommunityDefinition &&
      !options.some(option => option.community.address === parsedCommunity.address)
    ) {
      const definition = parseCommunityDefinition($activeExactCommunityDefinition.event)
      const community = definition
        ? makeCommunityPointer({
            ownerPubkey: parsedCommunity.ownerPubkey,
            communityId: parsedCommunity.communityId,
            relayHints: [...definition.relays, ...parsedCommunity.relayHints],
          })
        : undefined
      if (community) {
        options.push({
          community,
          label: definition!.metadata.name,
          relays: definition!.relays,
          relayHints: parsedCommunity.relayHints,
        })
      }
    }

    return options
  })

  function getDeletedTargetEventIds(targetEvents: TrustedEvent[], deleteEvents: TrustedEvent[]) {
    const targetAuthors = new Map(
      targetEvents.map(event => [event.id, normalizePubkey(event.pubkey)]),
    )
    const deleted = new Set<string>()

    for (const event of deleteEvents) {
      if (event.kind !== DELETE) continue
      const author = normalizePubkey(event.pubkey)

      for (const tag of event.tags || []) {
        if (tag[0] !== "e" || !tag[1]) continue
        if (targetAuthors.get(tag[1]) === author) deleted.add(tag[1])
      }
    }

    return deleted
  }

  type WidgetSlotOption = "" | WidgetCommunitySlotType

  const getWidgetSlotLabel = (slotType?: string) => {
    if (slotType === "community-home-before-quicklinks") return "Home: above quicklinks"
    if (slotType === "community-home-after-quicklinks") return "Home: below quicklinks"
    if (slotType === "community-home-quicklinks") return "Home: quicklink"
    if (slotType === "chat-message-actions") return "Chat message actions"
    if (slotType === "global-menu") return "Global menu"

    return ""
  }

  const toggleTargetCommunity = (address: string, checked: boolean) => {
    selectedTargetCommunityAddresses = checked
      ? Array.from(new Set([...selectedTargetCommunityAddresses, address]))
      : selectedTargetCommunityAddresses.filter(value => value !== address)
  }

  const getWidgetAppUrls = () =>
    Array.from(
      new Set(
        [
          appUrl.trim(),
          ...fallbackAppUrls
            .split(/\n|,/)
            .map(url => url.trim())
            .filter(Boolean),
        ].filter(Boolean),
      ),
    )

  const uploadWidgetArtifact = async (input: HTMLInputElement) => {
    const file = input.files?.[0]
    if (!file) return

    widgetUploadStage = "preparing"
    widgetUploadError = ""
    widgetUploadMirrors = []

    try {
      const {error, result, mirrors} = await uploadFile(file, {
        blossomContext: {
          type: "generic",
          label: `Widget: ${name.trim() || file.name}`,
        },
        onStage: stage => (widgetUploadStage = stage),
      })

      if (error || !result?.url) throw new Error(error || "Widget artifact upload failed.")

      const urls = getWidgetAppUrlsFromUpload({result, mirrors})
      if (urls.length === 0) throw new Error("Upload did not return a secure widget app URL.")

      appUrl = urls[0]
      fallbackAppUrls = urls.slice(1).join("\n")
      widgetUploadMirrors = mirrors || []
      pushToast({theme: "success", message: "Widget artifact uploaded."})
    } catch (error) {
      widgetUploadStage = "failed"
      widgetUploadError = error instanceof Error ? error.message : String(error)
      pushToast({theme: "error", message: widgetUploadError})
    } finally {
      input.value = ""
    }
  }

  const createWidget = () => {
    if (!$pubkey || !name.trim()) return
    const selectedOptions = filterSelectedWidgetCommunityOptions(
      widgetCommunityOptions,
      selectedTargetCommunityAddresses,
    )

    if (!canCreateWidget) {
      pushToast({theme: "error", message: "You do not have permission to publish widgets here."})
      return
    }
    if (selectedOptions.length === 0) {
      pushToast({theme: "error", message: "Select at least one community target."})
      return
    }
    const appUrls = getWidgetAppUrls()
    if (appUrls.length === 0 || !appUrls.every(isSecureEmbeddableUrl)) {
      pushToast({
        theme: "error",
        message: `Widget app URLs must be secure. ${SECURE_EMBED_URL_REQUIREMENT}`,
      })
      return
    }
    const baseRelays: string[] = []
    let relays: string[]

    try {
      relays = getWidgetTargetPublishRelays({
        baseRelays,
        communityOptions: selectedOptions,
        communityAddresses: selectedOptions.map(option => option.community.address),
      })
    } catch (error) {
      pushToast({theme: "error", message: error instanceof Error ? error.message : String(error)})
      return
    }

    if (relays.length === 0) {
      pushToast({theme: "error", message: "No publish relays are available for selected targets."})
      return
    }

    const widgetId = slug.trim() || randomId()
    const widgetEvent = makeEvent(SMART_WIDGET_KIND, {
      content: name.trim(),
      tags: buildCommunityWidgetEventTags({
        identifier: widgetId,
        name,
        appUrls,
        iconUrl,
        description,
        slot: widgetSlot,
        version,
        changelog,
      }),
    })
    publishWidgetEventToTargets({
      event: widgetEvent,
      baseRelays,
      communityOptions: selectedOptions,
      communityAddresses: selectedOptions.map(option => option.community.address),
    })
    publishWidgetTargetingEvent({
      widget: {pubkey: $pubkey, identifier: widgetId},
      baseRelays,
      communityOptions: selectedOptions,
      communityAddresses: selectedOptions.map(option => option.community.address),
      originalRelay: relays[0],
    })

    name = ""
    slug = ""
    appUrl = ""
    fallbackAppUrls = ""
    iconUrl = ""
    description = ""
    version = ""
    changelog = ""
    widgetSlot = ""
    widgetUploadMirrors = []
    pushToast({message: "Widget published."})
  }

  let name = $state("")
  let slug = $state("")
  let appUrl = $state("")
  let fallbackAppUrls = $state("")
  let iconUrl = $state("")
  let description = $state("")
  let version = $state("")
  let changelog = $state("")
  let widgetSlot = $state<WidgetSlotOption>("")
  let widgetUploadStage = $state<BlossomUploadStage>("idle")
  let widgetUploadError = $state("")
  let widgetUploadMirrors = $state<BlossomMirrorUploadResult[]>([])
  let selectedTargetCommunityAddresses = $state<string[]>([])
  let targetSelectionKey = ""
  let loadingTargets = $state(false)
  let targetRequestSettled = $state(false)
  let loadingTargetDeletes = $state(false)
  let targetDeleteRequestSettled = $state(false)
  let loadingOriginalWidgets = $state(false)
  let originalWidgetRequestSettled = $state(false)
  const widgetHistoryRetryVersion = $state(0)
  const widgetsLoading = $derived(
    !communityBootstrapFailed &&
      !communityAuthorityUnavailable &&
      (communityBootstrapLoading ||
        communityAuthorityLoading ||
        loadingTargets ||
        loadingTargetDeletes ||
        loadingOriginalWidgets ||
        !targetRequestSettled ||
        !targetDeleteRequestSettled ||
        (widgetFilters.length > 0 && !originalWidgetRequestSettled && $widgets.length === 0)),
  )
  const widgetUploading = $derived(!["idle", "ready", "failed"].includes(widgetUploadStage))
  const canSubmitWidget = $derived(
    canCreateWidget &&
      !widgetUploading &&
      Boolean(name.trim()) &&
      getWidgetAppUrls().length > 0 &&
      filterSelectedWidgetCommunityOptions(widgetCommunityOptions, selectedTargetCommunityAddresses)
        .length > 0,
  )
  $effect(() => {
    void widgetHistoryRetryVersion
    if (
      !communityBootstrapReady ||
      !communityPubkey ||
      targetingFilterPlan.relayFilters.length === 0
    ) {
      loadingTargets = false
      targetRequestSettled =
        communityBootstrapReady && targetingFilterPlan.relayFilters.length === 0
      return
    }
    if ($activeExactCommunityRelays.length === 0) {
      loadingTargets = false
      targetRequestSettled = true
      return
    }

    const controller = new AbortController()
    loadingTargets = true
    targetRequestSettled = false
    void loadBoundedCommunityHistory({
      relays: $activeExactCommunityRelays,
      relayFilters: targetingFilterPlan.relayFilters,
      localFilters: targetingFilterPlan.localFilters,
      signal: controller.signal,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-widgets:${communityPubkey}:targets`,
    })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-widgets] Failed to load targeting history", error)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        loadingTargets = false
        targetRequestSettled = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    void widgetHistoryRetryVersion
    const relays = $activeExactCommunityRelays
    const relayFilters = targetDeleteFilterPlan.relayFilters
    const localFilters = targetDeleteFilterPlan.localFilters

    if (!communityBootstrapReady) {
      loadingTargetDeletes = false
      targetDeleteRequestSettled = false
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      loadingTargetDeletes = false
      targetDeleteRequestSettled = true
      return
    }
    if (relays.length === 0) {
      loadingTargetDeletes = false
      targetDeleteRequestSettled = true
      return
    }

    const controller = new AbortController()
    loadingTargetDeletes = true
    targetDeleteRequestSettled = false
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      signal: controller.signal,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-widgets:${communityPubkey}:target-deletes`,
    })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-widgets] Failed to load targeting delete history", error)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        loadingTargetDeletes = false
        targetDeleteRequestSettled = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    void widgetHistoryRetryVersion
    const relayFilters = widgetFilterPlan.relayFilters
    const localFilters = widgetFilterPlan.localFilters

    if (!communityBootstrapReady) {
      loadingOriginalWidgets = false
      originalWidgetRequestSettled = false
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      loadingOriginalWidgets = false
      originalWidgetRequestSettled = true
      return
    }

    const plans = [
      ...($activeExactCommunityRelays.length
        ? [{relays: $activeExactCommunityRelays, relayFilters, localFilters}]
        : []),
      ...widgetRelayHintPlans,
    ]
    if (plans.length === 0) {
      loadingOriginalWidgets = false
      originalWidgetRequestSettled = true
      return
    }

    const controller = new AbortController()
    loadingOriginalWidgets = true
    originalWidgetRequestSettled = false
    void Promise.all(
      plans.map(plan =>
        loadBoundedCommunityHistory({
          ...plan,
          signal: controller.signal,
          priority: RELAY_REQUEST_PRIORITY.interactive,
          owner: `community-widgets:${communityPubkey}:originals`,
        }),
      ),
    )
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-widgets] Failed to load original widget history", error)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        loadingOriginalWidgets = false
        originalWidgetRequestSettled = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    const optionsKey = widgetCommunityOptions.map(option => option.community.address).join(",")
    const key = `${parsedCommunity?.address || ""}:${optionsKey}`
    if (key === targetSelectionKey) return

    targetSelectionKey = key
    selectedTargetCommunityAddresses = widgetCommunityOptions.some(
      option => option.community.address === parsedCommunity?.address,
    )
      ? [parsedCommunity!.address]
      : []
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Widget} /></div>
  {/snippet}
  {#snippet title()}<strong>Widgets</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={parsedCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createWidget)}>
    <strong>Create targeted widget</strong>
    {#if widgetAccessLoading}
      <div class="alert alert-info text-sm">Loading widget access...</div>
    {:else if !canCreateWidget}
      <div class="alert alert-warning text-sm">
        You need widget-write permission in this community to publish or target widgets.
      </div>
    {/if}
    <Field
      >{#snippet label()}<p>Name</p>{/snippet}{#snippet input()}<input
          bind:value={name}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Identifier</p>{/snippet}{#snippet input()}<input
          bind:value={slug}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>App URL</p>{/snippet}{#snippet input()}<input
          bind:value={appUrl}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field>
      {#snippet label()}<p>Upload widget HTML</p>{/snippet}
      {#snippet input()}
        <input
          type="file"
          accept=".html,text/html"
          class="file-input file-input-bordered w-full"
          disabled={!canCreateWidget || widgetUploading}
          onchange={event => uploadWidgetArtifact(event.currentTarget)} />
        <p class="mt-1 text-xs opacity-70">
          Upload a built widget artifact to Blossom, or paste a manual app URL above.
        </p>
        {#if widgetUploading}
          <p class="mt-1 text-xs opacity-70">Uploading: {widgetUploadStage}</p>
        {:else if widgetUploadError}
          <p class="mt-1 text-xs text-error">{widgetUploadError}</p>
        {/if}
        {#if widgetUploadMirrors.length > 0}
          <p class="mt-1 text-xs opacity-70">
            Immediate mirrors: {widgetUploadMirrors.filter(mirror => mirror.ok && mirror.url)
              .length}
          </p>
        {/if}
      {/snippet}
    </Field>
    <Field
      >{#snippet label()}<p>Fallback app URLs</p>{/snippet}{#snippet input()}<textarea
          bind:value={fallbackAppUrls}
          class="textarea textarea-bordered"
          rows="3"
          placeholder="One URL per line"></textarea>
        >{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Icon URL</p>{/snippet}{#snippet input()}<input
          bind:value={iconUrl}
          class="input input-bordered w-full" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Version</p>{/snippet}{#snippet input()}<input
          bind:value={version}
          class="input input-bordered w-full"
          placeholder="1.0.0" />{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Changelog</p>{/snippet}{#snippet input()}<textarea
          bind:value={changelog}
          class="textarea textarea-bordered"
          rows="3"></textarea
        >{/snippet}</Field>
    <Field
      >{#snippet label()}<p>Description</p>{/snippet}{#snippet input()}<textarea
          bind:value={description}
          class="textarea textarea-bordered"
          rows="3"></textarea
        >{/snippet}</Field>
    <Field>
      {#snippet label()}<p>Widget slot</p>{/snippet}
      {#snippet input()}
        <select bind:value={widgetSlot} class="select select-bordered w-full">
          <option value="">No slot launcher</option>
          <option value="community-home-before-quicklinks">Above home quicklinks</option>
          <option value="community-home-after-quicklinks">Below home quicklinks</option>
          <option value="community-home-quicklinks">Home quicklink</option>
          <option value="chat-message-actions">Chat message actions</option>
          <option value="global-menu">Global menu</option>
        </select>
      {/snippet}
    </Field>
    <div class="flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3">
      <div>
        <strong class="text-sm">Target communities</strong>
        <p class="text-xs opacity-70">
          The widget event is published to every selected community relay and curated with a
          targeted publication.
        </p>
      </div>
      {#if widgetCommunityOptions.length > 0}
        <div class="flex flex-col gap-2">
          {#each widgetCommunityOptions as option (option.community.address)}
            <label class="flex items-center gap-3 rounded-md border border-base-300 p-2 text-sm">
              <input
                type="checkbox"
                checked={selectedTargetCommunityAddresses.includes(option.community.address)}
                onchange={event =>
                  toggleTargetCommunity(option.community.address, event.currentTarget.checked)} />
              <span class="min-w-0 flex-1 truncate"
                >{option.label || option.community.address}</span>
            </label>
          {/each}
        </div>
      {:else if communityAuthorityLoading}
        <p class="text-sm opacity-70">Loading widget access...</p>
      {:else}
        <p class="text-sm opacity-70">
          No widget-capable community grants are available for this account.
        </p>
      {/if}
    </div>
    <div class="flex justify-end">
      <Button type="submit" class="btn btn-primary" disabled={!canSubmitWidget}>
        {widgetUploading
          ? "Uploading..."
          : widgetAccessLoading
            ? "Loading access..."
            : "Publish widget"}
      </Button>
    </div>
  </form>

  <div class="col-2">
    {#each $widgets as widget (widget.id)}
      {@const slotLabel = getWidgetSlotLabel(widget.tags.find(tag => tag[0] === "slot")?.[1])}
      <div class="card2 bg-alt p-4 shadow-md" data-event={widget.id}>
        <strong
          >{getTagValue("title", widget.tags) || getTagValue("d", widget.tags) || "Widget"}</strong>
        {#if slotLabel}
          <div class="mt-1"><span class="badge badge-primary badge-sm">{slotLabel}</span></div>
        {/if}
        <p class="break-all text-xs opacity-60">{getTagValue("button", widget.tags) || ""}</p>
        {#if widget.content}<p class="whitespace-pre-wrap">{widget.content}</p>{/if}
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">
        {#if widgetsLoading}
          <Spinner loading>Looking for widgets...</Spinner>
        {:else if communityBootstrapFailed || communityAuthorityUnavailable}
          Widgets unavailable.
        {:else}
          No targeted widgets found.
        {/if}
      </p>
    {/each}
  </div>
</PageContent>
