<script lang="ts">
  import {formatDateTime} from "@welshman/lib"
  import {pubkey, signer} from "@welshman/app"
  import Clock from "@assets/icons/clock-circle.svg?dataurl"
  import Mailbox from "@assets/icons/mailbox.svg?dataurl"
  import Server from "@assets/icons/server.svg?dataurl"
  import Shield from "@assets/icons/shield-check.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Profile from "@app/components/Profile.svelte"
  import {hydratePubkeyProfiles} from "@app/core/community-state"
  import {
    communityAlertProviderGroups,
    communityAlertSettingsHydration,
    disableCommunityAlerts,
    hydrateCommunityAlertSettings,
    queryCommunityAlertProviderState,
    retryCommunityAlertCleanup,
    saveAndEnableCommunityAlerts,
    saveCommunityAlertDeliveryProfile,
    userCommunityAlertDeliveryProfile,
    userCommunityAlertRegistrations,
    userCommunityAlertSettings,
    type CommunityAlertProviderState,
  } from "@app/core/community-alerts-state"
  import {
    defaultCommunityAlertDeliveryProfile,
    isCommunityAlertProviderAdvertised,
    normalizeCommunityAlertPreferences,
    type CommunityAlertPreferences,
    type CommunityAlertProviderGroup,
    type CommunityAlertRegistration,
  } from "@app/core/community-alerts"
  import {
    getCommunityAlertServiceDescriptorKey,
    type CommunityAlertService,
  } from "@app/core/community"
  import {normalizeEmailDigestEmail} from "@app/core/email-digest"
  import {pushToast} from "@app/util/toast"

  type Draft = {
    providerKey: string
    preferences: CommunityAlertPreferences
  }

  type ProviderChoice = CommunityAlertService & {unavailable?: boolean}

  type RequestGuard = {
    identity: string
    generation: number
    token: number
    key: string
  }

  let drafts = $state<Record<string, Draft>>({})
  let providerStates = $state<Record<string, CommunityAlertProviderState | undefined>>({})
  let loading = $state<Record<string, string>>({})
  let errors = $state<Record<string, string>>({})
  let queried = $state<Record<string, boolean>>({})
  let requestTokens = $state<Record<string, number>>({})
  let identityKey = $state("")
  let identitySigner = $state<ReturnType<typeof signer.get>>()
  let requestGeneration = $state(0)
  let requestCounter = 0
  let profileSource = $state("")
  let profileDirty = $state(false)
  let profileError = $state("")
  let email = $state(defaultCommunityAlertDeliveryProfile.email)
  let intervalDays = $state(defaultCommunityAlertDeliveryProfile.intervalDays)
  let localTime = $state(defaultCommunityAlertDeliveryProfile.localTime)
  let timezone = $state(defaultCommunityAlertDeliveryProfile.timezone)

  const settingsReady = $derived(
    Boolean(
      $pubkey &&
      $communityAlertSettingsHydration.pubkey === $pubkey &&
      $communityAlertSettingsHydration.signer === $signer &&
      $communityAlertSettingsHydration.status === "ready",
    ),
  )
  const savedDeliveryReady = $derived(
    Boolean(normalizeEmailDigestEmail($userCommunityAlertDeliveryProfile.email)),
  )
  const offeredCommunities = $derived(
    new Set($communityAlertProviderGroups.map(group => group.communityAddress)),
  )
  const unavailableRegistrations = $derived(
    Object.entries($userCommunityAlertRegistrations).filter(
      ([communityAddress, registration]) =>
        !offeredCommunities.has(communityAddress) &&
        Boolean(
          registration.enabled ||
          registration.pendingProvider ||
          registration.pendingCleanup?.length,
        ),
    ),
  )

  const providerKey = (provider: CommunityAlertService) =>
    getCommunityAlertServiceDescriptorKey(provider)

  const providerHost = (provider: CommunityAlertService) => {
    try {
      return new URL(provider.requestRelay).host
    } catch {
      return "Community alert service"
    }
  }

  const uniqueProviders = (providers: Array<CommunityAlertService | undefined>) => {
    const result: CommunityAlertService[] = []
    const seen = new Set<string>()
    for (const provider of providers) {
      const key = provider ? providerKey(provider) : ""
      if (!provider || !key || seen.has(key)) continue
      seen.add(key)
      result.push(provider)
    }

    return result
  }

  const providerChoices = (group: CommunityAlertProviderGroup): ProviderChoice[] => {
    const choices: ProviderChoice[] = group.providers.map(provider => ({...provider}))
    const registration = $userCommunityAlertRegistrations[group.communityAddress]
    for (const savedProvider of [registration?.provider, registration?.pendingProvider]) {
      const key = savedProvider ? providerKey(savedProvider) : ""
      if (savedProvider && key && !choices.some(choice => providerKey(choice) === key)) {
        choices.push({...savedProvider, unavailable: true})
      }
    }

    return choices
  }

  const selectedProvider = (group: CommunityAlertProviderGroup) => {
    const choices = providerChoices(group)
    const selectedKey = drafts[group.communityAddress]?.providerKey

    return choices.find(provider => providerKey(provider) === selectedKey) || choices[0]
  }

  const isProviderAvailable = (
    group: CommunityAlertProviderGroup,
    provider: CommunityAlertService | undefined,
  ) =>
    isCommunityAlertProviderAdvertised({
      communityAddress: group.communityAddress,
      provider,
      providerGroups: $communityAlertProviderGroups,
    })

  const currentStatus = (communityAddress: string) => providerStates[communityAddress]?.status

  const statusLabel = (communityAddress: string, registration?: CommunityAlertRegistration) => {
    const status = currentStatus(communityAddress)
    if (errors[communityAddress] || registration?.lastError) return "Error"
    if (status?.state === "ineligible") return "Ineligible"
    if (status?.state === "suppressed") return "Suppressed"
    if (status?.state === "error") return "Error"
    if (status?.state === "active" && status.status === "ok") return "Active"
    if (!registration?.enabled) return "Inactive"
    if (status?.state === "unsubscribed" || status?.state === "deleted") return "Inactive"

    return "Pending confirmation"
  }

  const formatStatusTime = (timestamp?: number | null) =>
    typeof timestamp === "number"
      ? formatDateTime(timestamp * 1000, {showTimeZone: true})
      : "Not reported"

  const beginRequest = (key: string): RequestGuard => {
    const token = ++requestCounter
    requestTokens = {...requestTokens, [key]: token}

    return {identity: $pubkey || "", generation: requestGeneration, token, key}
  }

  const isCurrentRequest = (guard: RequestGuard) =>
    Boolean(
      guard.identity &&
      guard.identity === $pubkey &&
      guard.generation === requestGeneration &&
      requestTokens[guard.key] === guard.token,
    )

  const markProfileDirty = () => {
    profileDirty = true
    profileError = ""
  }

  const setCadence = (days: number) => {
    intervalDays = days
    markProfileDirty()
  }

  const setDensity = (communityAddress: string, density: CommunityAlertPreferences["density"]) => {
    const draft = drafts[communityAddress]
    if (draft) draft.preferences.density = density
  }

  const setProvider = (group: CommunityAlertProviderGroup, event: Event) => {
    const draft = drafts[group.communityAddress]
    if (!draft) return
    draft.providerKey = (event.currentTarget as HTMLSelectElement).value
    providerStates[group.communityAddress] = undefined
    errors[group.communityAddress] = ""
    requestTokens = {...requestTokens, [group.communityAddress]: ++requestCounter}
  }

  const saveDeliveryProfile = async (event: SubmitEvent) => {
    event.preventDefault()
    const guard = beginRequest("delivery-profile")
    loading[guard.key] = "save"
    profileError = ""
    try {
      const result = await saveCommunityAlertDeliveryProfile({
        email,
        intervalDays,
        localTime,
        timezone,
      })
      if (!isCurrentRequest(guard)) return
      profileDirty = false
      profileError = result.errors.length
        ? `Delivery settings were saved, but ${result.errors.length} active community registration${result.errors.length === 1 ? "" : "s"} could not be updated.`
        : ""
      pushToast({message: "Community alert delivery settings saved"})
    } catch (error) {
      if (!isCurrentRequest(guard)) return
      profileError =
        error instanceof Error ? error.message : "Failed to save community alert delivery"
      pushToast({theme: "error", message: profileError})
    } finally {
      if (isCurrentRequest(guard)) loading[guard.key] = ""
    }
  }

  const refresh = async (group: CommunityAlertProviderGroup) => {
    const communityAddress = group.communityAddress
    const registration = $userCommunityAlertRegistrations[communityAddress]
    const provider =
      registration?.pendingProvider || registration?.provider || selectedProvider(group)
    if (!provider || !settingsReady) return
    const guard = beginRequest(communityAddress)
    loading[communityAddress] = "refresh"
    errors[communityAddress] = ""
    try {
      const result = await queryCommunityAlertProviderState({communityAddress, provider})
      if (!isCurrentRequest(guard)) return
      providerStates[communityAddress] = result
      if (result.statusError) errors[communityAddress] = result.statusError
    } catch (error) {
      if (!isCurrentRequest(guard)) return
      errors[communityAddress] =
        error instanceof Error ? error.message : "Failed to load community alert status"
    } finally {
      if (isCurrentRequest(guard)) loading[communityAddress] = ""
    }
  }

  const save = async (event: SubmitEvent, group: CommunityAlertProviderGroup) => {
    event.preventDefault()
    const communityAddress = group.communityAddress
    const draft = drafts[communityAddress]
    const provider = draft ? selectedProvider(group) : undefined
    if (!draft || !provider || !isProviderAvailable(group, provider)) return
    const guard = beginRequest(communityAddress)
    loading[communityAddress] = "save"
    errors[communityAddress] = ""
    try {
      const result = await saveAndEnableCommunityAlerts({
        communityAddress,
        provider,
        preferences: draft.preferences,
      })
      if (!isCurrentRequest(guard)) return
      providerStates[communityAddress] = result
      if (result.statusError) {
        errors[communityAddress] = result.statusError
        pushToast({theme: "error", message: `Alerts saved, but ${result.statusError}`})
      } else {
        pushToast({message: "Community alerts saved"})
      }
    } catch (error) {
      if (!isCurrentRequest(guard)) return
      errors[communityAddress] =
        error instanceof Error ? error.message : "Failed to save community alerts"
      pushToast({theme: "error", message: errors[communityAddress]})
    } finally {
      if (isCurrentRequest(guard)) loading[communityAddress] = ""
    }
  }

  const disable = async (communityAddress: string) => {
    const guard = beginRequest(communityAddress)
    loading[communityAddress] = "disable"
    errors[communityAddress] = ""
    try {
      await disableCommunityAlerts(communityAddress)
      if (!isCurrentRequest(guard)) return
      providerStates[communityAddress] = undefined
      pushToast({message: "Community alerts disabled"})
    } catch (error) {
      if (!isCurrentRequest(guard)) return
      errors[communityAddress] =
        error instanceof Error ? error.message : "Provider cleanup is still pending"
      pushToast({theme: "error", message: errors[communityAddress]})
    } finally {
      if (isCurrentRequest(guard)) loading[communityAddress] = ""
    }
  }

  const retryCleanup = async (communityAddress: string) => {
    const guard = beginRequest(communityAddress)
    loading[communityAddress] = "cleanup"
    errors[communityAddress] = ""
    try {
      await retryCommunityAlertCleanup(communityAddress)
      if (!isCurrentRequest(guard)) return
      pushToast({message: "Provider cleanup completed"})
    } catch (error) {
      if (!isCurrentRequest(guard)) return
      errors[communityAddress] = error instanceof Error ? error.message : "Provider cleanup failed"
    } finally {
      if (isCurrentRequest(guard)) loading[communityAddress] = ""
    }
  }

  const enableDisabledReason = (
    group: CommunityAlertProviderGroup,
    provider: CommunityAlertService | undefined,
  ) => {
    if (!settingsReady) return "Encrypted community alert settings are still loading."
    if (profileDirty) return "Save the community alert delivery profile first."
    if (!savedDeliveryReady) return "Save a valid community alert delivery email first."
    if (!provider) return "Select a community-endorsed provider."
    if (!isProviderAvailable(group, provider)) {
      return "Select a provider that is still advertised by this community."
    }

    return ""
  }

  $effect(() => {
    const identity = $pubkey || ""
    const activeSigner = $signer
    if (identity === identityKey && activeSigner === identitySigner) return

    identityKey = identity
    identitySigner = activeSigner
    requestGeneration += 1
    drafts = {}
    providerStates = {}
    loading = {}
    errors = {}
    queried = {}
    requestTokens = {}
    profileSource = ""
    profileDirty = false
    profileError = ""
    email = defaultCommunityAlertDeliveryProfile.email
    intervalDays = defaultCommunityAlertDeliveryProfile.intervalDays
    localTime = defaultCommunityAlertDeliveryProfile.localTime
    timezone = defaultCommunityAlertDeliveryProfile.timezone

    if (!identity || !activeSigner) return
    const guard = beginRequest("hydration")
    void hydrateCommunityAlertSettings(identity).catch(error => {
      if (!isCurrentRequest(guard)) return
      profileError =
        error instanceof Error ? error.message : "Failed to load community alert settings"
    })
  })

  $effect(() => {
    const source = $userCommunityAlertSettings?.event.id || ($pubkey ? `empty:${$pubkey}` : "")
    if (!source || source === profileSource || profileDirty) return
    const profile = $userCommunityAlertDeliveryProfile
    email = profile.email
    intervalDays = profile.intervalDays
    localTime = profile.localTime
    timezone = profile.timezone
    profileSource = source
  })

  $effect(() => {
    const next = {...drafts}
    let changed = false
    for (const group of $communityAlertProviderGroups) {
      if (next[group.communityAddress]) continue
      const registration = $userCommunityAlertRegistrations[group.communityAddress]
      const provider = registration?.pendingProvider || registration?.provider || group.providers[0]
      next[group.communityAddress] = {
        providerKey: provider ? providerKey(provider) : "",
        preferences: normalizeCommunityAlertPreferences(registration?.preferences),
      }
      changed = true
    }
    if (changed) drafts = next
  })

  $effect(() => {
    if (!settingsReady) return
    for (const group of $communityAlertProviderGroups) {
      const registration = $userCommunityAlertRegistrations[group.communityAddress]
      if (
        (!registration?.enabled && !registration?.pendingProvider) ||
        queried[group.communityAddress]
      ) {
        continue
      }
      queried[group.communityAddress] = true
      void refresh(group)
    }
  })

  $effect(() => {
    const groups = $communityAlertProviderGroups
    if (!$pubkey || groups.length === 0) return
    const controller = new AbortController()
    for (const group of groups) {
      void hydratePubkeyProfiles({
        pubkeys: group.providers.map(provider => provider.servicePubkey),
        relayHints: group.definition.relays,
        signal: controller.signal,
      }).catch(() => {})
    }

    return () => controller.abort()
  })
</script>

<section
  class="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
  <div class="border-b border-base-300 px-5 py-5 sm:px-6">
    <div class="flex items-start gap-3">
      <div class="rounded-xl bg-primary/10 p-2.5 text-primary">
        <Icon icon={Mailbox} size={5} />
      </div>
      <div>
        <h2 class="text-lg font-semibold">Community email digest</h2>
        <p class="text-sm text-muted-foreground">
          Independent delivery and activity choices for each community where you have an active
          member, moderator, or administrator role.
        </p>
      </div>
    </div>
  </div>

  <form class="border-b border-base-300 p-5 sm:p-6" onsubmit={saveDeliveryProfile}>
    <div class="mb-5">
      <h3 class="font-semibold">Community alert delivery</h3>
      <p class="mt-1 text-sm text-muted-foreground">
        This profile is encrypted separately from repo digest settings and applies only to community
        alerts.
      </p>
    </div>

    {#if !settingsReady}
      <div class="mb-5 rounded-xl border border-base-300 bg-base-200/40 p-3 text-sm">
        {#if $communityAlertSettingsHydration.status === "error"}
          Encrypted community alert settings could not be loaded. Reload before making changes.
        {:else}
          <Spinner loading={true}>Loading encrypted community alert settings</Spinner>
        {/if}
      </div>
    {/if}

    <fieldset
      class="grid gap-5"
      disabled={!settingsReady || loading["delivery-profile"] === "save"}>
      <Field
        error={email && !normalizeEmailDigestEmail(email) ? "Enter a valid email address." : ""}>
        {#snippet label()}<span>Community alert email</span>{/snippet}
        {#snippet input()}
          <input
            class="input input-bordered w-full"
            type="email"
            autocomplete="email"
            placeholder="you@example.com"
            bind:value={email}
            oninput={markProfileDirty}
            required />
        {/snippet}
        {#snippet info()}
          Sent only to community providers you enable. Repo providers keep their own delivery email.
        {/snippet}
      </Field>

      <div class="grid gap-5 sm:grid-cols-2">
        <Field>
          {#snippet label()}<span>Community alert cadence</span>{/snippet}
          {#snippet input()}
            <div class="grid grid-cols-4 gap-2">
              {#each [1, 3, 7, 14] as days}
                <Button
                  class="btn btn-sm {intervalDays === days ? 'btn-primary' : 'btn-outline'}"
                  onclick={() => setCadence(days)}>{days}d</Button>
              {/each}
            </div>
            <label class="mt-2 flex items-center gap-2 text-sm">
              <span class="text-muted-foreground">Custom</span>
              <input
                class="input input-sm input-bordered min-w-0 flex-1"
                type="number"
                min="1"
                max="30"
                step="1"
                bind:value={intervalDays}
                oninput={markProfileDirty} />
              <span>days</span>
            </label>
          {/snippet}
        </Field>
        <Field>
          {#snippet label()}<span>Community alert time</span>{/snippet}
          {#snippet input()}
            <label class="input input-bordered flex items-center gap-2">
              <Icon icon={Clock} size={4} />
              <input type="time" bind:value={localTime} oninput={markProfileDirty} required />
            </label>
          {/snippet}
        </Field>
      </div>

      <Field>
        {#snippet label()}<span>Community alert timezone</span>{/snippet}
        {#snippet input()}
          <input
            class="input input-bordered w-full"
            bind:value={timezone}
            oninput={markProfileDirty}
            placeholder="Europe/London"
            required />
        {/snippet}
        {#snippet info()}Use an IANA timezone. Delivery follows it across devices.{/snippet}
      </Field>
    </fieldset>

    {#if profileError}
      <p class="mt-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
        {profileError}
      </p>
    {/if}
    <div class="mt-5 flex justify-end">
      <Button
        type="submit"
        class="btn btn-neutral btn-sm inline-flex items-center justify-center text-center [&>span]:min-h-0 [&>span]:w-full [&>span]:justify-center"
        disabled={!settingsReady || loading["delivery-profile"] === "save"}>
        <Spinner loading={loading["delivery-profile"] === "save"}>Save community delivery</Spinner>
      </Button>
    </div>
  </form>

  <div class="grid min-w-0 gap-4 p-5 sm:p-6">
    {#if $communityAlertProviderGroups.length === 0}
      <div class="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
        <strong>No eligible community alert service is advertised.</strong>
        <p class="mt-1 text-muted-foreground">
          Services appear only from the latest verified definition of communities where your current
          role is member, moderator, or administrator.
        </p>
      </div>
    {/if}

    {#each $communityAlertProviderGroups as group (group.communityAddress)}
      {@const draft = drafts[group.communityAddress]}
      {@const registration = $userCommunityAlertRegistrations[group.communityAddress]}
      {@const choices = providerChoices(group)}
      {@const provider = selectedProvider(group)}
      {@const providerAvailable = isProviderAvailable(group, provider)}
      {@const status = currentStatus(group.communityAddress)}
      {@const label = statusLabel(group.communityAddress, registration)}
      {@const disabledReason = enableDisabledReason(group, provider)}
      {#if draft && provider}
        <form
          class="w-full min-w-0 max-w-full rounded-2xl border border-base-300 bg-base-200/30 p-4 sm:p-5"
          onsubmit={event => save(event, group)}>
          <div class="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div class="min-w-0">
              <div class="truncate font-semibold">{group.definition.metadata.name}</div>
              <div class="truncate text-xs text-muted-foreground" title={group.communityAddress}>
                {group.communityAddress}
              </div>
            </div>
            <span
              class="badge h-auto min-h-6 max-w-full shrink-0 whitespace-normal break-words px-3 py-1 text-center leading-4"
              class:badge-success={label === "Active"}
              class:badge-warning={label === "Pending confirmation"}
              class:badge-error={["Error", "Suppressed", "Ineligible"].includes(label)}
              class:badge-ghost={label === "Inactive"}>
              {label}
            </span>
          </div>

          {#if label === "Pending confirmation"}
            <div class="mt-4 rounded-xl border border-warning/40 bg-warning/10 p-4" role="status">
              <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div class="flex min-w-0 items-start gap-3">
                  <div class="shrink-0 rounded-xl bg-warning/15 p-2.5 text-warning-content">
                    <Icon icon={Mailbox} size={5} />
                  </div>
                  <div class="min-w-0">
                    <h3 class="font-semibold">Verify your community delivery email</h3>
                    <p class="mt-1 text-sm leading-6 text-muted-foreground">
                      We sent a verification email{$userCommunityAlertDeliveryProfile.email
                        ? ` to ${$userCommunityAlertDeliveryProfile.email}`
                        : ""}. Open that inbox, follow the verification link, and confirm to
                      activate alerts for this community.
                    </p>
                  </div>
                </div>
                <Button
                  class="btn btn-warning btn-sm inline-flex max-w-full shrink-0 items-center justify-center whitespace-normal text-center [&>span]:min-h-0 [&>span]:w-full [&>span]:justify-center"
                  disabled={Boolean(loading[group.communityAddress]) || !settingsReady}
                  onclick={() => refresh(group)}>
                  <Spinner loading={loading[group.communityAddress] === "refresh"}
                    >I've verified, refresh status</Spinner>
                </Button>
              </div>
            </div>
          {/if}

          <div class="mt-4 grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(16rem,0.65fr)]">
            <div class="grid min-w-0 gap-5">
              {#if choices.length > 1}
                <Field>
                  {#snippet label()}<span>Community alert provider</span>{/snippet}
                  {#snippet input()}
                    <select
                      class="select select-bordered w-full"
                      value={providerKey(provider)}
                      onchange={event => setProvider(group, event)}>
                      {#each choices as choice (providerKey(choice))}
                        <option value={providerKey(choice)}>
                          {choice.unavailable ? "No longer advertised - " : ""}{providerHost(
                            choice,
                          )}
                        </option>
                      {/each}
                    </select>
                  {/snippet}
                  {#snippet info()}
                    Each community registration is independent. Choose explicitly when the signed
                    definition advertises multiple providers.
                  {/snippet}
                </Field>
              {/if}

              <div class="rounded-xl border border-base-300 bg-base-100 p-3">
                <div class="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
                  Provider identity
                </div>
                <Profile
                  pubkey={provider.servicePubkey}
                  relays={group.definition.relays}
                  avatarSize={7}
                  fallbackName={providerHost(provider)}
                  showPubkey />
                <p class="mt-2 text-xs leading-5 text-muted-foreground">
                  Identity is the service pubkey profile loaded with this community's relay hints.
                </p>
              </div>

              {#if !providerAvailable}
                <div class="rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
                  This saved provider is no longer advertised. Its exact endpoint snapshot remains
                  available for disabling or cleanup, but it cannot receive a new registration.
                </div>
              {/if}

              <div class="min-w-0">
                <div class="mb-2 text-sm font-medium">Digest density</div>
                <div class="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2">
                  <Button
                    class="btn btn-sm min-w-0 max-w-full justify-center [&>span]:min-w-0 {draft
                      .preferences.density === 'compact'
                      ? 'btn-primary'
                      : 'btn-outline'}"
                    onclick={() => setDensity(group.communityAddress, "compact")}>Compact</Button>
                  <Button
                    class="btn btn-sm min-w-0 max-w-full justify-center [&>span]:min-w-0 {draft
                      .preferences.density === 'expanded'
                      ? 'btn-primary'
                      : 'btn-outline'}"
                    onclick={() => setDensity(group.communityAddress, "expanded")}>Expanded</Button>
                </div>
                <p class="mt-2 text-xs text-muted-foreground">
                  Compact summarizes activity; expanded includes more per-item detail.
                </p>
              </div>

              <details
                class="min-w-0 max-w-full rounded-xl border border-base-300 bg-base-100 p-3"
                open>
                <summary class="cursor-pointer text-sm font-semibold">Activity categories</summary>
                <div class="mt-4 grid gap-5 sm:grid-cols-2">
                  <div class="grid content-start gap-2">
                    <div class="text-xs font-semibold uppercase tracking-wide opacity-60">
                      Engagement
                    </div>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.engagement.replies} />
                      Replies
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.engagement.mentions} />
                      Mentions
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.engagement.reactions} />
                      Reactions
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.engagement.zaps} />
                      Zaps
                    </label>
                  </div>
                  <div class="grid content-start gap-2">
                    <div class="text-xs font-semibold uppercase tracking-wide opacity-60">
                      Access
                    </div>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.access.membership} />
                      Membership changes
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.access.publishing} />
                      Publishing requests
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.access.moderatorRequests} />
                      Moderator requests
                    </label>
                  </div>
                  <div class="grid content-start gap-2">
                    <div class="text-xs font-semibold uppercase tracking-wide opacity-60">
                      Moderation
                    </div>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.moderation.reports} />
                      Reports
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.moderation.actions} />
                      Actions
                    </label>
                  </div>
                  <div class="grid content-start gap-2">
                    <div class="text-xs font-semibold uppercase tracking-wide opacity-60">
                      Highlights
                    </div>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.highlights.rooms} />
                      Active rooms
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.highlights.threads} />
                      New threads
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.highlights.calendar} />
                      Calendar
                    </label>
                    <label class="flex items-center gap-2 text-sm">
                      <input
                        class="checkbox checkbox-sm"
                        type="checkbox"
                        bind:checked={draft.preferences.highlights.goals} />
                      Goals
                    </label>
                  </div>
                </div>
              </details>
            </div>

            <aside class="grid min-w-0 content-start gap-3">
              <div class="rounded-xl border border-base-300 bg-base-100 p-3 text-sm">
                <div class="flex min-w-0 items-start gap-2 font-semibold">
                  <span class="shrink-0"><Icon icon={Server} size={4} /></span>
                  <span class="min-w-0 break-words">{providerHost(provider)}</span>
                </div>
                <p class="mt-2 text-xs leading-5 text-muted-foreground">
                  Receives only this community, the 13 category choices, density, and the community
                  delivery profile. It receives no Git repositories or Git delivery fields.
                </p>
              </div>
              <div class="rounded-xl border border-base-300 bg-base-100 p-3 text-sm">
                <div class="mb-2 font-semibold">Delivery state</div>
                <dl class="grid gap-2 text-xs">
                  <div class="flex min-w-0 justify-between gap-3">
                    <dt class="shrink-0 text-muted-foreground">Next run</dt>
                    <dd class="min-w-0 break-words text-right">
                      {formatStatusTime(status?.nextRunAt)}
                    </dd>
                  </div>
                  <div class="flex min-w-0 justify-between gap-3">
                    <dt class="shrink-0 text-muted-foreground">Last completed</dt>
                    <dd class="min-w-0 break-words text-right">
                      {formatStatusTime(status?.lastCompletedAt)}
                    </dd>
                  </div>
                </dl>
                {#if status?.message}
                  <p class="mt-3 rounded-lg bg-base-200 p-2 text-xs leading-5">{status.message}</p>
                {/if}
              </div>
            </aside>
          </div>

          {#if registration?.pendingCleanup?.length}
            <div
              class="mt-4 flex min-w-0 items-start gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-sm">
              <span class="shrink-0"><Icon icon={Shield} size={4} /></span>
              <span class="min-w-0 break-words">
                Cleanup is pending on {registration.pendingCleanup.length} saved provider endpoint{registration
                  .pendingCleanup.length === 1
                  ? ""
                  : "s"}. A new provider is never registered until this cleanup succeeds.
              </span>
            </div>
          {/if}
          {#if errors[group.communityAddress] || registration?.lastError}
            <p class="mt-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error">
              {errors[group.communityAddress] || registration?.lastError}
            </p>
          {/if}

          <div
            class="mt-4 flex min-w-0 flex-col gap-3 border-t border-base-300 pt-4 sm:flex-row sm:items-end sm:justify-between">
            {#if disabledReason && !loading[group.communityAddress]}
              <p class="min-w-0 text-xs leading-5 text-muted-foreground">{disabledReason}</p>
            {:else}
              <span class="hidden sm:block"></span>
            {/if}
            <div class="flex min-w-0 flex-wrap justify-end gap-2">
              <Button
                class="btn btn-outline btn-sm inline-flex items-center justify-center text-center [&>span]:min-h-0 [&>span]:w-full [&>span]:justify-center"
                disabled={Boolean(loading[group.communityAddress]) || !settingsReady}
                onclick={() => refresh(group)}>
                <Spinner loading={loading[group.communityAddress] === "refresh"}
                  >Refresh status</Spinner>
              </Button>
              {#if registration?.pendingCleanup?.length}
                <Button
                  class="btn btn-outline btn-warning btn-sm inline-flex items-center justify-center text-center [&>span]:min-h-0 [&>span]:w-full [&>span]:justify-center"
                  disabled={Boolean(loading[group.communityAddress])}
                  onclick={() => retryCleanup(group.communityAddress)}>
                  <Spinner loading={loading[group.communityAddress] === "cleanup"}
                    >Retry cleanup</Spinner>
                </Button>
              {/if}
              {#if registration?.enabled || registration?.pendingProvider || registration?.pendingCleanup?.length}
                <Button
                  class="btn btn-outline btn-error btn-sm inline-flex items-center justify-center text-center [&>span]:min-h-0 [&>span]:w-full [&>span]:justify-center"
                  disabled={Boolean(loading[group.communityAddress])}
                  onclick={() => disable(group.communityAddress)}>
                  <Spinner loading={loading[group.communityAddress] === "disable"}>Disable</Spinner>
                </Button>
              {/if}
              <Button
                type="submit"
                class="btn btn-primary btn-sm inline-flex items-center justify-center whitespace-normal text-center [&>span]:min-h-0 [&>span]:w-full [&>span]:justify-center"
                disabled={Boolean(disabledReason) || Boolean(loading[group.communityAddress])}>
                <Spinner loading={loading[group.communityAddress] === "save"}>
                  {registration?.enabled ? "Save alerts" : "Enable alerts"}
                </Spinner>
              </Button>
            </div>
          </div>
        </form>
      {/if}
    {/each}

    {#if unavailableRegistrations.length > 0}
      <div class="rounded-2xl border border-warning/40 bg-warning/10 p-4">
        <h3 class="font-semibold">Unavailable registrations</h3>
        <p class="mt-1 text-sm text-muted-foreground">
          These snapshots are not offered as active services. They remain visible so old endpoints
          can be disabled or cleanup can be retried after eligibility or declarations change.
        </p>
        <div class="mt-3 grid gap-3">
          {#each unavailableRegistrations as [communityAddress, registration] (communityAddress)}
            {@const savedProviders = uniqueProviders([
              registration.provider,
              registration.pendingProvider,
              ...(registration.pendingCleanup || []),
            ])}
            {@const orphanLabel = registration.lastError
              ? "Error"
              : registration.enabled
                ? "Pending confirmation"
                : "Inactive"}
            <div class="rounded-xl border border-warning/30 bg-base-100 p-3">
              <div
                class="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div class="min-w-0">
                  <div class="font-semibold">Unavailable community</div>
                  <div class="truncate text-xs text-muted-foreground" title={communityAddress}>
                    {communityAddress}
                  </div>
                </div>
                <span
                  class="badge h-auto min-h-6 max-w-full shrink-0 whitespace-normal break-words px-3 py-1 text-center leading-4"
                  class:badge-warning={orphanLabel === "Pending confirmation"}
                  class:badge-error={orphanLabel === "Error"}
                  class:badge-ghost={orphanLabel === "Inactive"}>{orphanLabel}</span>
              </div>
              {#if savedProviders.length > 0}
                <div class="mt-3 grid gap-2 sm:grid-cols-2">
                  {#each savedProviders as savedProvider (providerKey(savedProvider))}
                    <div class="rounded-lg border border-base-300 bg-base-200/30 p-2">
                      <Profile
                        pubkey={savedProvider.servicePubkey}
                        avatarSize={6}
                        fallbackName={providerHost(savedProvider)} />
                    </div>
                  {/each}
                </div>
              {/if}
              {#if errors[communityAddress] || registration.lastError}
                <p class="mt-3 text-sm text-error">
                  {errors[communityAddress] || registration.lastError}
                </p>
              {/if}
              <div class="mt-3 flex flex-wrap justify-end gap-2">
                {#if registration.pendingCleanup?.length}
                  <Button
                    class="btn btn-outline btn-warning btn-sm"
                    disabled={Boolean(loading[communityAddress])}
                    onclick={() => retryCleanup(communityAddress)}>Retry cleanup</Button>
                {/if}
                <Button
                  class="btn btn-outline btn-error btn-sm"
                  disabled={Boolean(loading[communityAddress])}
                  onclick={() => disable(communityAddress)}>Disable registration</Button>
              </div>
            </div>
          {/each}
        </div>
      </div>
    {/if}
  </div>
</section>
