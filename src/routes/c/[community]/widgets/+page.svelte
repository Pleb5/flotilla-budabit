<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {profilesByPubkey, pubkey, repository} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE, makeEvent, getTagValue, type Filter, type TrustedEvent} from "@welshman/util"
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
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
    activeUserCommunityRefs,
  } from "@app/core/community-state"
  import {normalizePubkey, normalizeRelays, parseTargetedPublication} from "@app/core/community"
  import {
    SMART_WIDGET_KIND,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilters,
  } from "@app/core/community-feeds"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    communityWritableSectionsSupportTarget,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {SMART_WIDGET_RELAYS} from "@app/core/state"
  import {parseCommunityRouteParam} from "@app/util/routes"
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
  const targetingFilters = $derived(
    communityBootstrapReady && communityPubkey
      ? [makeCommunityTargetingFilter(communityPubkey, [SMART_WIDGET_KIND])]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const targetDeleteFilters = $derived.by(() => makeTargetDeleteFilters($targetingEvents))
  const targetDeleteEvents = $derived(
    targetDeleteFilters.length
      ? deriveEventsAsc(deriveEventsById({repository, filters: targetDeleteFilters}))
      : undefined,
  )
  const deletedTargetIds = $derived.by(() =>
    getDeletedTargetEventIds(
      $targetingEvents,
      $targetDeleteEvents ? ($targetDeleteEvents as TrustedEvent[]) : [],
    ),
  )
  const widgetTargetAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.widget,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const eligibleTargetingEvents = $derived.by(() => {
    const writerPubkeys = new Set(widgetTargetAuthorPubkeys.map(normalizePubkey))

    return $targetingEvents.filter(
      event => writerPubkeys.has(normalizePubkey(event.pubkey)) && !deletedTargetIds.has(event.id),
    )
  })
  const widgetFilters = $derived(
    communityBootstrapReady && eligibleTargetingEvents.length
      ? makeTargetedPublicationOriginalFilters(eligibleTargetingEvents)
      : [],
  )
  const widgets = $derived(deriveEventsAsc(deriveEventsById({repository, filters: widgetFilters})))
  const canCreateWidget = $derived(
    Boolean(
      $pubkey &&
      communityBootstrapReady &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.widget,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const getCommunityOptionLabel = (pubkey: string) => {
    const profile = $profilesByPubkey.get(pubkey)
    return profile?.display_name || profile?.name || `${pubkey.slice(0, 8)}...${pubkey.slice(-6)}`
  }

  const widgetCommunityOptions = $derived.by((): WidgetCommunityOption[] => {
    const options = $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.widget,
        }),
      )
      .map(ref => ({
        pubkey: ref.communityPubkey,
        label: getCommunityOptionLabel(ref.communityPubkey),
        relays: ref.relayHints.length ? ref.relayHints : ref.definition.relays,
      }))

    if (
      canCreateWidget &&
      communityPubkey &&
      $activeCommunityDefinition &&
      !options.some(option => option.pubkey === communityPubkey)
    ) {
      options.push({
        pubkey: communityPubkey,
        label: getCommunityOptionLabel(communityPubkey),
        relays: $activeCommunityDefinition.relays,
      })
    }

    return options
  })

  const getUserOutboxRelays = () => {
    try {
      return Router.get().FromUser().getUrls() || []
    } catch {
      return []
    }
  }

  function makeTargetDeleteFilters(events: TrustedEvent[]): Filter[] {
    const ids = events.map(event => event.id).filter(Boolean)

    return ids.length ? [{kinds: [DELETE], "#e": ids, limit: ids.length * 2}] : []
  }

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
    if (slotType === "chat-message-actions") return "Chat message actions"
    if (slotType === "global-menu") return "Global menu"

    return ""
  }

  const toggleTargetCommunity = (pubkey: string, checked: boolean) => {
    selectedTargetCommunityPubkeys = checked
      ? Array.from(new Set([...selectedTargetCommunityPubkeys, pubkey]))
      : selectedTargetCommunityPubkeys.filter(value => value !== pubkey)
  }

  const getWidgetAppUrls = () =>
    Array.from(
      new Set([
        appUrl.trim(),
        ...fallbackAppUrls
          .split(/\n|,/)
          .map(url => url.trim())
          .filter(Boolean),
      ].filter(Boolean)),
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
      selectedTargetCommunityPubkeys,
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
    const baseRelays = normalizeRelays([...SMART_WIDGET_RELAYS, ...getUserOutboxRelays()])
    const relays = getWidgetTargetPublishRelays({
      baseRelays,
      communityOptions: selectedOptions,
      communityPubkeys: selectedOptions.map(option => option.pubkey),
    })
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
      communityPubkeys: selectedOptions.map(option => option.pubkey),
    })
    publishWidgetTargetingEvent({
      widget: {pubkey: $pubkey, identifier: widgetId},
      baseRelays,
      communityOptions: selectedOptions,
      communityPubkeys: selectedOptions.map(option => option.pubkey),
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
  let selectedTargetCommunityPubkeys = $state<string[]>([])
  let targetSelectionKey = ""
  let loadingTargets = $state(false)
  let targetRequestDone = $state(false)
  let loadingWidgets = $state(false)
  let widgetRequestDone = $state(false)
  const widgetsLoading = $derived(
    communityBootstrapLoading ||
      loadingTargets ||
      loadingWidgets ||
      !targetRequestDone ||
      (widgetFilters.length > 0 && !widgetRequestDone && $widgets.length === 0),
  )
  const widgetUploading = $derived(!["idle", "ready", "failed"].includes(widgetUploadStage))
  const canSubmitWidget = $derived(
    canCreateWidget &&
      !widgetUploading &&
      Boolean(name.trim()) &&
      getWidgetAppUrls().length > 0 &&
      filterSelectedWidgetCommunityOptions(widgetCommunityOptions, selectedTargetCommunityPubkeys).length > 0,
  )

  $effect(() => {
    if (
      !communityBootstrapReady ||
      !communityPubkey ||
      $activeCommunityRelays.length === 0 ||
      targetingFilters.length === 0
    ) {
      loadingTargets = false
      targetRequestDone = false
      return
    }

    const controller = new AbortController()
    loadingTargets = true
    targetRequestDone = false
    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      filters: targetingFilters,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => {
        if (controller.signal.aborted) return
        loadingTargets = false
        targetRequestDone = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    if (
      !communityBootstrapReady ||
      $activeCommunityRelays.length === 0 ||
      targetDeleteFilters.length === 0
    ) {
      return
    }

    const controller = new AbortController()
    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      filters: targetDeleteFilters,
      signal: controller.signal,
    }).catch(() => undefined)

    return () => controller.abort()
  })

  $effect(() => {
    const widgetRelayHints = normalizeRelays([
      ...$activeCommunityRelays,
      ...eligibleTargetingEvents.flatMap(event => {
        const ref = parseTargetedPublication(event)?.ref

        return ref?.relay ? [ref.relay] : []
      }),
    ])

    if (!communityBootstrapReady || widgetRelayHints.length === 0 || widgetFilters.length === 0) {
      loadingWidgets = false
      widgetRequestDone = false
      return
    }

    const controller = new AbortController()
    loadingWidgets = true
    widgetRequestDone = false
    request({
      relays: widgetRelayHints,
      autoClose: true,
      filters: widgetFilters,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => {
        if (controller.signal.aborted) return
        loadingWidgets = false
        widgetRequestDone = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    const optionsKey = widgetCommunityOptions.map(option => option.pubkey).join(",")
    const key = `${communityPubkey}:${optionsKey}`
    if (key === targetSelectionKey) return

    targetSelectionKey = key
    selectedTargetCommunityPubkeys = widgetCommunityOptions.some(
      option => option.pubkey === communityPubkey,
    )
      ? [communityPubkey]
      : []
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={Widget} /></div>
  {/snippet}
  {#snippet title()}<strong>Widgets</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createWidget)}>
    <strong>Create targeted widget</strong>
    {#if !canCreateWidget}
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
            Immediate mirrors: {widgetUploadMirrors.filter(mirror => mirror.ok && mirror.url).length}
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
          {#each widgetCommunityOptions as option (option.pubkey)}
            <label class="flex items-center gap-3 rounded-md border border-base-300 p-2 text-sm">
              <input
                type="checkbox"
                checked={selectedTargetCommunityPubkeys.includes(option.pubkey)}
                onchange={event =>
                  toggleTargetCommunity(option.pubkey, event.currentTarget.checked)} />
              <span class="min-w-0 flex-1 truncate">{option.label || option.pubkey}</span>
            </label>
          {/each}
        </div>
      {:else}
        <p class="text-sm opacity-70">
          No widget-capable community grants are available for this account.
        </p>
      {/if}
    </div>
    <div class="flex justify-end">
      <Button
        type="submit"
        class="btn btn-primary"
        disabled={!canSubmitWidget}>
        {widgetUploading ? "Uploading..." : "Publish widget"}
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
        {:else}
          No targeted widgets found.
        {/if}
      </p>
    {/each}
  </div>
</PageContent>
