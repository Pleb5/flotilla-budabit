<script lang="ts">
  import {onMount} from "svelte"
  import {request} from "@welshman/net"
  import {Address, type TrustedEvent} from "@welshman/util"
  import {pubkey} from "@welshman/app"
  import Bell from "@assets/icons/bell.svg?dataurl"
  import Clock from "@assets/icons/clock-circle.svg?dataurl"
  import Git from "@assets/icons/git.svg?dataurl"
  import Mailbox from "@assets/icons/mailbox.svg?dataurl"
  import Server from "@assets/icons/server.svg?dataurl"
  import Shield from "@assets/icons/shield-check.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import Link from "@lib/components/Link.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Profile from "@app/components/Profile.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {publishSettings} from "@app/core/commands"
  import {
    activeCommunityDefinition,
    activeUserCommunityRefs,
    hydratePubkeyProfiles,
  } from "@app/core/community-state"
  import {GIT_RELAYS, repoAnnouncements} from "@app/core/git-state"
  import {userRepoWatchValues} from "@app/core/repo-watch"
  import {APP_LOGO, userSettingsValues} from "@app/core/state"
  import {
    disableEmailDigest,
    emailDigestSettingsHydration,
    emailDigestProviders,
    hydrateEmailDigestSettings,
    queryEmailDigestProviderState,
    saveAndEnableEmailDigest,
    userEmailDigestSettings,
    userEmailDigestSettingsValues,
    type EmailDigestProviderState,
  } from "@app/core/email-digest-state"
  import {
    buildEmailDigestRepositories,
    getDefaultEmailDigestTimezone,
    getEmailDigestHandlerFilter,
    isEmailDigestVerificationPending,
    isEmailDigestProviderAdvertised,
    normalizeEmailDigestEmail,
    selectEmailDigestProviderIdentity,
    type EmailDigestProvider,
    type EmailDigestProviderIdentity,
  } from "@app/core/email-digest"
  import {
    getCommunityEmailDigestServiceDescriptorKey,
    normalizeRelays,
    type CommunityEmailDigestService,
  } from "@app/core/community"
  import {clearBadges} from "@app/util/notifications"
  import {pushModal} from "@app/util/modal"
  import {makeGitPath} from "@app/util/routes"
  import {pushToast} from "@app/util/toast"

  type ProviderChoice = EmailDigestProvider & {unavailable?: boolean}

  let inAppSettings = $state({...$userSettingsValues})
  let savingInApp = $state(false)
  let email = $state("")
  let intervalDays = $state(7)
  let localTime = $state("09:00")
  let timezone = $state(getDefaultEmailDigestTimezone())
  let selectedProviderKey = $state("")
  let selectedCommunityPubkey = $state("")
  let digestFormSource = $state("")
  let digestFormDirty = $state(false)
  let providerSwitchConfirmed = $state(false)
  let providerState = $state<EmailDigestProviderState>({})
  let statusQueryKey = $state("")
  let statusRequestToken = $state(0)
  let statusRequestProviderKey = $state("")
  let loadingStatus = $state(false)
  let savingDigest = $state(false)
  let disablingDigest = $state(false)
  let digestError = $state("")
  let openProviderEvidenceKey = $state("")
  let verificationEmailNotice = $state("")
  let providerIdentities = $state<Record<string, EmailDigestProviderIdentity | undefined>>({})
  let providerProfileHydrationKey = $state("")

  const providerChoices = $derived.by(() => {
    const choices: ProviderChoice[] = $emailDigestProviders.map(provider => ({...provider}))
    const savedProvider = $userEmailDigestSettingsValues.provider
    const savedKey = savedProvider ? getCommunityEmailDigestServiceDescriptorKey(savedProvider) : ""

    if (savedProvider && !choices.some(choice => getProviderKey(choice) === savedKey)) {
      choices.push({
        ...savedProvider,
        endorsingCommunityPubkeys: [$userEmailDigestSettingsValues.selectedCommunityPubkey].filter(
          Boolean,
        ),
        isActiveCommunity: false,
        unavailable: true,
      })
    }

    return choices
  })
  const selectedProvider = $derived(
    providerChoices.find(provider => getProviderKey(provider) === selectedProviderKey),
  )
  const selectedProviderAvailable = $derived(
    isEmailDigestProviderAdvertised(selectedProvider, $emailDigestProviders),
  )
  const selectedProviderIdentity = $derived(providerIdentities[selectedProviderKey])
  const selectedProviderPicture = $derived(
    selectedProviderIdentity?.picture ||
      ($APP_LOGO.startsWith("static/") ? `/${$APP_LOGO.slice("static/".length)}` : $APP_LOGO) ||
      Mailbox,
  )
  const selectedProviderProfileRelays = $derived.by(() =>
    selectedProvider
      ? normalizeRelays([
          selectedProvider.handlerRelay,
          ...selectedProvider.endorsingCommunityPubkeys.flatMap(getCommunityProfileRelays),
        ])
      : [],
  )
  const watchedRepoCount = $derived(Object.keys($userRepoWatchValues.repos).length)
  const repositorySummary = $derived.by(() => {
    try {
      return {
        repositories: buildEmailDigestRepositories({
          watchState: $userRepoWatchValues,
          announcements: $repoAnnouncements as TrustedEvent[],
          fallbackRelays: GIT_RELAYS,
        }),
        error: "",
      }
    } catch (error) {
      return {
        repositories: [],
        error: error instanceof Error ? error.message : String(error),
      }
    }
  })
  const savedDigestEnabled = $derived($userEmailDigestSettingsValues.enabled)
  const digestSettingsHydrated = $derived(
    Boolean(
      $pubkey &&
      $emailDigestSettingsHydration.pubkey === $pubkey &&
      $emailDigestSettingsHydration.status === "ready",
    ),
  )
  const savedProviderAvailable = $derived(
    isEmailDigestProviderAdvertised($userEmailDigestSettingsValues.provider, $emailDigestProviders),
  )
  const statusState = $derived(
    !savedDigestEnabled ? "unsubscribed" : providerState.status?.state || "pending",
  )
  const statusLabel = $derived(
    statusState === "active"
      ? "Active"
      : statusState === "unsubscribed"
        ? "Inactive"
        : statusState === "suppressed"
          ? "Suppressed"
          : statusState === "deleted"
            ? "Deleted"
            : statusState === "error"
              ? "Error"
              : "Pending confirmation",
  )
  const verificationRequired = $derived(
    savedDigestEnabled &&
      (Boolean(verificationEmailNotice) || isEmailDigestVerificationPending(providerState.status)),
  )
  const verificationEmail = $derived(
    verificationEmailNotice || $userEmailDigestSettingsValues.email,
  )

  function getProviderKey(provider: CommunityEmailDigestService) {
    return getCommunityEmailDigestServiceDescriptorKey(provider)
  }

  const getProviderHost = (provider: CommunityEmailDigestService) => {
    try {
      return new URL(provider.requestRelay).host
    } catch {
      return provider.requestRelay
    }
  }

  function getCommunityProfileRelays(communityPubkey: string) {
    const communityRef = $activeUserCommunityRefs.find(
      ref => ref.communityPubkey === communityPubkey,
    )
    if (communityRef) return communityRef.relayHints
    if ($activeCommunityDefinition?.pubkey === communityPubkey) {
      return $activeCommunityDefinition.relays
    }
    return []
  }

  const openCommunityProfile = (communityPubkey: string) =>
    pushModal(ProfileDetail, {
      pubkey: communityPubkey,
      relays: getCommunityProfileRelays(communityPubkey),
    })

  const getProviderEvidenceKey = (provider: CommunityEmailDigestService) =>
    `${getProviderKey(provider)}:communities`

  const getCommunityCountLabel = (count: number) =>
    `${count} ${count === 1 ? "Community" : "Communities"}`

  const getRepoPath = (address: string) => {
    try {
      return makeGitPath(undefined, Address.from(address).toNaddr())
    } catch {
      return "/git"
    }
  }

  const getRepoOptionLabels = (repository: (typeof repositorySummary.repositories)[number]) => {
    const labels: string[] = []
    if (repository.options.issues.new) labels.push("new issues")
    if (repository.options.issues.comments) labels.push("issue comments")
    if (repository.options.prs.new) labels.push("new PRs")
    if (repository.options.prs.comments) labels.push("PR comments")
    if (repository.options.prs.updates) labels.push("PR updates")
    const statuses = Object.entries(repository.options.status)
      .filter(([, enabled]) => enabled)
      .map(([status]) => (status === "applied" ? "merged" : status))
    if (statuses.length > 0) labels.push(`${statuses.join("/")} status`)
    if (repository.options.assignments) labels.push("assignments")
    return labels
  }

  const formatStatusTime = (timestamp?: number | null) =>
    typeof timestamp === "number"
      ? new Date(timestamp * 1000).toLocaleString([], {dateStyle: "medium", timeStyle: "short"})
      : "Not reported"

  const setCadence = (days: number) => {
    intervalDays = days
    digestFormDirty = true
  }

  const markDigestDirty = () => {
    digestFormDirty = true
    const savedProvider = $userEmailDigestSettingsValues.provider
    if (
      savedDigestEnabled &&
      savedProvider &&
      getProviderKey(savedProvider) !== selectedProviderKey
    ) {
      providerSwitchConfirmed = true
    }
  }

  const selectProvider = (event: Event) => {
    const nextKey = (event.currentTarget as HTMLSelectElement).value
    const savedProvider = $userEmailDigestSettingsValues.provider
    const switching =
      savedDigestEnabled && savedProvider && getProviderKey(savedProvider) !== nextKey
    selectedProviderKey = nextKey
    const choice = providerChoices.find(provider => getProviderKey(provider) === nextKey)
    selectedCommunityPubkey = choice?.endorsingCommunityPubkeys[0] || ""
    digestFormDirty = true
    providerSwitchConfirmed = false
    providerState = {}
    statusRequestToken += 1
    statusRequestProviderKey = ""
    loadingStatus = false
    digestError = ""
    openProviderEvidenceKey = ""
    if (switching) email = ""
  }

  const saveInAppSettings = async (event: SubmitEvent) => {
    event.preventDefault()
    savingInApp = true
    try {
      const next = $state.snapshot(inAppSettings)
      await publishSettings(next)
      if (!next.show_notifications_badge) await clearBadges()
      pushToast({message: "In-app notification settings saved"})
    } catch (error) {
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to save notification settings",
      })
    } finally {
      savingInApp = false
    }
  }

  const refreshStatus = (provider: CommunityEmailDigestService | undefined = selectedProvider) => {
    if (!provider || !digestSettingsHydrated || savingDigest || disablingDigest) return false
    const providerKey = getProviderKey(provider)
    const requestToken = ++statusRequestToken
    statusRequestProviderKey = providerKey
    loadingStatus = true
    digestError = ""
    void queryEmailDigestProviderState(provider)
      .then(result => {
        if (requestToken !== statusRequestToken || providerKey !== statusRequestProviderKey) return
        providerState = result
        if (result.statusError) digestError = result.statusError
      })
      .catch(error => {
        if (requestToken !== statusRequestToken || providerKey !== statusRequestProviderKey) return
        digestError = error instanceof Error ? error.message : "Failed to load provider status"
      })
      .finally(() => {
        if (requestToken === statusRequestToken && providerKey === statusRequestProviderKey) {
          loadingStatus = false
        }
      })
    return true
  }

  const saveDigest = async (event: SubmitEvent) => {
    event.preventDefault()
    if (!selectedProvider) return
    const wasEnabled = savedDigestEnabled
    const savedProvider = $userEmailDigestSettingsValues.provider
    const normalizedEmail = normalizeEmailDigestEmail(email)
    const requiresNewVerification =
      !wasEnabled ||
      !savedProvider ||
      getProviderKey(savedProvider) !== selectedProviderKey ||
      $userEmailDigestSettingsValues.email !== normalizedEmail
    statusRequestToken += 1
    statusRequestProviderKey = ""
    loadingStatus = false
    savingDigest = true
    digestError = ""
    try {
      providerState = await saveAndEnableEmailDigest({
        settings: {
          version: 1,
          enabled: true,
          email,
          intervalDays,
          localTime,
          timezone,
          selectedCommunityPubkey,
          provider: selectedProvider,
        },
        watchState: $userRepoWatchValues,
        announcements: $repoAnnouncements as TrustedEvent[],
        providerSwitchConfirmed,
      })
      providerSwitchConfirmed = false
      digestFormDirty = false
      if (
        requiresNewVerification &&
        (!providerState.status || providerState.status.emailConfirmed === false)
      ) {
        verificationEmailNotice = normalizedEmail
      }
      pushToast({message: wasEnabled ? "Email digest updated" : "Email digest enabled"})
    } catch (error) {
      digestError = error instanceof Error ? error.message : "Failed to save email digest"
      pushToast({theme: "error", message: digestError})
    } finally {
      savingDigest = false
    }
  }

  const disableDigest = async () => {
    statusRequestToken += 1
    statusRequestProviderKey = ""
    loadingStatus = false
    disablingDigest = true
    digestError = ""
    try {
      await disableEmailDigest($userEmailDigestSettingsValues)
      providerState = {}
      verificationEmailNotice = ""
      pushToast({message: "Email digest disabled"})
    } catch (error) {
      digestError = error instanceof Error ? error.message : "Failed to disable email digest"
      pushToast({theme: "error", message: digestError})
    } finally {
      disablingDigest = false
    }
  }

  $effect(() => {
    inAppSettings = {...$userSettingsValues}
  })

  $effect(() => {
    const source = $userEmailDigestSettings?.event.id || ($pubkey ? `empty:${$pubkey}` : "")
    if (!source || source === digestFormSource || digestFormDirty) return

    const settings = $userEmailDigestSettingsValues
    email = settings.email
    intervalDays = settings.intervalDays
    localTime = settings.localTime
    timezone = settings.timezone
    selectedProviderKey = settings.provider ? getProviderKey(settings.provider) : ""
    selectedCommunityPubkey = settings.selectedCommunityPubkey
    digestFormSource = source
  })

  $effect(() => {
    if (selectedProviderKey || digestFormDirty || providerChoices.length === 0) return
    const provider = providerChoices[0]
    selectedProviderKey = getProviderKey(provider)
    selectedCommunityPubkey = provider.endorsingCommunityPubkeys[0] || ""
  })

  $effect(() => {
    const provider = $userEmailDigestSettingsValues.provider
    const queryKey =
      savedDigestEnabled && provider
        ? `${getProviderKey(provider)}:${$userEmailDigestSettings?.event.id || ""}`
        : ""
    if (!digestSettingsHydrated || !queryKey || queryKey === statusQueryKey) return
    if (refreshStatus(provider)) statusQueryKey = queryKey
  })

  $effect(() => {
    const provider = selectedProvider
    const profileRelays = selectedProviderProfileRelays
    const key = provider ? `${provider.servicePubkey}:${profileRelays.join(",")}` : ""
    if (!provider || !key || key === providerProfileHydrationKey) return

    providerProfileHydrationKey = key
    void hydratePubkeyProfiles({
      pubkeys: [provider.servicePubkey],
      relayHints: profileRelays,
    }).catch(() => {})
  })

  $effect(() => {
    const provider = selectedProvider
    const filter = provider ? getEmailDigestHandlerFilter(provider) : undefined
    if (!provider || !filter) return

    const providerKey = getProviderKey(provider)
    const controller = new AbortController()
    void request({
      relays: [provider.handlerRelay],
      filters: [filter],
      autoClose: true,
      signal: controller.signal,
    })
      .then(events => {
        const identity = selectEmailDigestProviderIdentity(events as TrustedEvent[], provider)
        providerIdentities = {...providerIdentities, [providerKey]: identity}
      })
      .catch(() => {})

    return () => controller.abort()
  })

  $effect(() => {
    if (providerState.status?.emailConfirmed) verificationEmailNotice = ""
  })

  onMount(() => {
    if (!$pubkey) return
    void hydrateEmailDigestSettings($pubkey).catch(error => {
      digestError = error instanceof Error ? error.message : "Failed to load email digest settings"
    })
  })
</script>

<div class="content column gap-5 pb-12">
  <section class="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
    <div class="bg-gradient-to-br from-primary/15 via-base-100 to-secondary/10 px-5 py-6 sm:px-7">
      <div class="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div class="max-w-2xl">
          <div class="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
            <Icon icon={Bell} size={4.5} /> Account-wide notification controls
          </div>
          <h1 class="text-2xl font-bold tracking-tight sm:text-3xl">Notifications</h1>
          <p class="mt-2 text-sm leading-6 text-muted-foreground sm:text-base">
            Keep in-app activity useful and send one Git digest across every repository you watch.
          </p>
        </div>
        <div
          class="flex items-center gap-2 rounded-full border border-base-300 bg-base-100/80 px-3 py-2 text-xs shadow-sm">
          <span
            class="h-2 w-2 rounded-full"
            class:bg-success={savedDigestEnabled && statusState === "active"}
            class:bg-warning={savedDigestEnabled && statusState === "pending"}
            class:bg-error={savedDigestEnabled && ["error", "suppressed"].includes(statusState)}
            class:bg-base-300={!savedDigestEnabled}></span>
          Git digest: {statusLabel}
        </div>
      </div>
    </div>
  </section>

  <form
    class="rounded-2xl border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6"
    onsubmit={saveInAppSettings}>
    <div class="mb-5 flex items-start gap-3">
      <div class="rounded-xl bg-primary/10 p-2.5 text-primary"><Icon icon={Bell} size={5} /></div>
      <div>
        <h2 class="text-lg font-semibold">In-app activity</h2>
        <p class="text-sm text-muted-foreground">
          Control local badges and sounds on this account.
        </p>
      </div>
    </div>
    <div class="grid gap-5">
      <FieldInline>
        {#snippet label()}<span>Unread badge</span>{/snippet}
        {#snippet input()}
          <input
            type="checkbox"
            class="toggle toggle-primary"
            bind:checked={inAppSettings.show_notifications_badge} />
        {/snippet}
        {#snippet info()}Show a badge when unread messages or repository updates are available.{/snippet}
      </FieldInline>
      <FieldInline>
        {#snippet label()}<span>Notification sound</span>{/snippet}
        {#snippet input()}
          <input
            type="checkbox"
            class="toggle toggle-primary"
            bind:checked={inAppSettings.play_notification_sound} />
        {/snippet}
        {#snippet info()}Play a sound for new in-app activity while Budabit is in the background.{/snippet}
      </FieldInline>
    </div>
    <div class="mt-5 flex justify-end">
      <Button
        type="submit"
        class="btn btn-neutral btn-sm inline-flex items-center justify-center text-center [&>span]:min-h-0"
        disabled={savingInApp}>
        <Spinner loading={savingInApp}>Save in-app settings</Spinner>
      </Button>
    </div>
  </form>

  <form
    class="overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm"
    onsubmit={saveDigest}>
    <div class="border-b border-base-300 px-5 py-5 sm:px-6">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-start gap-3">
          <div class="rounded-xl bg-secondary/10 p-2.5 text-secondary">
            <Icon icon={Mailbox} size={5} />
          </div>
          <div>
            <h2 class="text-lg font-semibold">Git email digest</h2>
            <p class="text-sm text-muted-foreground">
              One schedule and provider for all explicitly watched repositories.
            </p>
          </div>
        </div>
        <span
          class="badge h-auto min-h-6 px-3 py-1"
          class:badge-success={savedDigestEnabled && statusState === "active"}
          class:badge-warning={savedDigestEnabled && statusState === "pending"}
          class:badge-error={savedDigestEnabled && ["error", "suppressed"].includes(statusState)}
          class:badge-ghost={!savedDigestEnabled}>
          {statusLabel}
        </span>
      </div>
    </div>

    {#if !digestSettingsHydrated}
      <div class="border-b border-base-300 px-5 py-3 text-sm text-muted-foreground sm:px-6">
        {#if $emailDigestSettingsHydration.status === "error"}
          Encrypted email digest settings could not be loaded. Reload before changing providers.
        {:else}
          <Spinner loading={true}>Loading encrypted email digest settings</Spinner>
        {/if}
      </div>
    {/if}

    {#if verificationRequired}
      <div class="border-b border-warning/40 bg-warning/10 px-5 py-4 sm:px-6" role="status">
        <div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 items-start gap-3">
            <div class="shrink-0 rounded-xl bg-warning/15 p-2.5 text-warning-content">
              <Icon icon={Mailbox} size={5} />
            </div>
            <div class="min-w-0">
              <h3 class="font-semibold">Verify your delivery email</h3>
              <p class="mt-1 text-sm leading-6 text-muted-foreground">
                We sent a verification email{verificationEmail ? ` to ${verificationEmail}` : ""}.
                Open that inbox and click the verification link to activate your digest.
              </p>
            </div>
          </div>
          <Button
            class="btn btn-warning btn-sm inline-flex shrink-0 items-center justify-center text-center [&>span]:min-h-0"
            disabled={loadingStatus || !$userEmailDigestSettingsValues.provider}
            onclick={() => refreshStatus($userEmailDigestSettingsValues.provider)}>
            <Spinner loading={loadingStatus}>I've verified, refresh status</Spinner>
          </Button>
        </div>
      </div>
    {/if}

    <div class="grid gap-6 p-5 sm:p-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(18rem,0.85fr)]">
      <div class="grid min-w-0 gap-6">
        {#if $emailDigestProviders.length === 0}
          <div class="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
            <strong>No email digest service is advertised.</strong>
            <p class="mt-1 text-muted-foreground">
              A community administrator must declare an email digest service in a signed community
              definition before members can enable delivery.
            </p>
          </div>
        {/if}

        <fieldset
          class="contents"
          disabled={savingDigest || disablingDigest || !digestSettingsHydrated}>
          {#if providerChoices.length > 0}
            <Field>
              {#snippet label()}<span>Community-endorsed provider</span>{/snippet}
              {#snippet input()}
                <select
                  class="select select-bordered w-full"
                  value={selectedProviderKey}
                  onchange={selectProvider}>
                  {#each providerChoices as provider (getProviderKey(provider))}
                    <option value={getProviderKey(provider)}>
                      {provider.unavailable ? "No longer advertised - " : ""}{getProviderHost(
                        provider,
                      )}
                    </option>
                  {/each}
                </select>
              {/snippet}
              {#snippet info()}
                Providers are discovered only from the latest verified definitions of your active
                communities. There is no global fallback.
              {/snippet}
            </Field>

            {#if selectedProvider}
              {@const evidenceKey = getProviderEvidenceKey(selectedProvider)}
              <div class="rounded-xl border border-base-300 bg-base-200/50 p-4">
                <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div class="min-w-0">
                    <Profile
                      pubkey={selectedProvider.servicePubkey}
                      relays={selectedProviderProfileRelays}
                      avatarSize={8}
                      fallbackName={selectedProviderIdentity?.name ||
                        getProviderHost(selectedProvider)}
                      fallbackPicture={selectedProviderPicture}
                      showPubkey />
                  </div>
                  <div
                    class="flex shrink-0 items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2.5 py-1.5 text-xs text-muted-foreground">
                    <Icon icon={Server} size={3.5} />
                    {getProviderHost(selectedProvider)}
                  </div>
                </div>

                <div class="relative mt-3 w-fit">
                  <button
                    type="button"
                    class="badge cursor-pointer border border-base-content/15 bg-base-200 font-medium text-base-content/80 hover:bg-base-300"
                    class:bg-base-300={openProviderEvidenceKey === evidenceKey}
                    aria-expanded={openProviderEvidenceKey === evidenceKey}
                    onclick={() =>
                      (openProviderEvidenceKey =
                        openProviderEvidenceKey === evidenceKey ? "" : evidenceKey)}>
                    {getCommunityCountLabel(selectedProvider.endorsingCommunityPubkeys.length)}
                  </button>

                  {#if openProviderEvidenceKey === evidenceKey}
                    <InlinePopover
                      align="left"
                      widthClass="w-80 sm:w-96"
                      onClose={() => (openProviderEvidenceKey = "")}>
                      <div class="flex min-w-0 flex-col gap-3 text-sm">
                        <div>
                          <p class="text-xs font-semibold uppercase tracking-wide opacity-60">
                            Community evidence
                          </p>
                          <p class="mt-1 text-xs leading-5 opacity-70">
                            Latest verified community definitions advertising this provider.
                          </p>
                        </div>
                        <div class="flex flex-col gap-2">
                          {#each selectedProvider.endorsingCommunityPubkeys as communityPubkey (communityPubkey)}
                            {@const communityRelays = getCommunityProfileRelays(communityPubkey)}
                            <div
                              class="flex min-w-0 items-center gap-2 rounded-box bg-base-200/60 p-3">
                              <button
                                type="button"
                                class="shrink-0"
                                aria-label="Open community profile"
                                onclick={() => openCommunityProfile(communityPubkey)}>
                                <ProfileCircle
                                  pubkey={communityPubkey}
                                  relays={communityRelays}
                                  size={7} />
                              </button>
                              <div class="min-w-0 flex-1">
                                <button
                                  type="button"
                                  class="max-w-full truncate text-sm font-medium hover:underline"
                                  onclick={() => openCommunityProfile(communityPubkey)}>
                                  <ProfileName pubkey={communityPubkey} relays={communityRelays} />
                                </button>
                                <div class="text-xs opacity-70">Community definition</div>
                              </div>
                            </div>
                          {/each}
                        </div>
                      </div>
                    </InlinePopover>
                  {/if}
                </div>
              </div>
            {/if}
          {/if}

          {#if savedDigestEnabled && !savedProviderAvailable}
            <div class="rounded-xl border border-warning/50 bg-warning/10 p-4 text-sm">
              <strong>Your selected provider is no longer advertised.</strong>
              <p class="mt-1 text-muted-foreground">
                Budabit preserved the exact provider snapshot and will not transfer your email or
                registration. You can still disable it on the saved provider relay.
              </p>
            </div>
          {/if}

          <div class="rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm leading-6">
            <div class="flex items-start gap-2">
              <Icon icon={Shield} size={4.5} />
              <p>
                The selected provider receives your delivery email and mirrors the watched
                repository addresses, relays, and event-type selections shown below. The advanced
                in-app author/activity filter is not currently sent to the provider. Your email is
                encrypted to that provider and stored in your self-encrypted settings; it is never
                placed in public or plaintext tags or settings.
              </p>
            </div>
          </div>

          <Field
            error={email && !normalizeEmailDigestEmail(email)
              ? "Enter a valid email address."
              : ""}>
            {#snippet label()}<span>Delivery email</span>{/snippet}
            {#snippet input()}
              <input
                class="input input-bordered w-full"
                type="email"
                autocomplete="email"
                placeholder="you@example.com"
                bind:value={email}
                oninput={markDigestDirty}
                required />
            {/snippet}
            {#snippet info()}
              {#if savedDigestEnabled && selectedProvider && $userEmailDigestSettingsValues.provider && getProviderKey(selectedProvider) !== getProviderKey($userEmailDigestSettingsValues.provider)}
                Re-enter your email to explicitly confirm this provider switch.
              {:else}
                Used only by the selected provider to deliver this digest.
              {/if}
            {/snippet}
          </Field>

          <div class="grid gap-5 sm:grid-cols-2">
            <Field>
              {#snippet label()}<span>Cadence</span>{/snippet}
              {#snippet input()}
                <div class="grid grid-cols-4 gap-2">
                  {#each [1, 3, 7, 14] as days}
                    <Button
                      class="btn btn-sm {intervalDays === days ? 'btn-primary' : 'btn-outline'}"
                      onclick={() => setCadence(days)}>
                      {days}d
                    </Button>
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
                    oninput={markDigestDirty} />
                  <span>days</span>
                </label>
              {/snippet}
            </Field>
            <Field>
              {#snippet label()}<span>Local delivery time</span>{/snippet}
              {#snippet input()}
                <label class="input input-bordered flex items-center gap-2">
                  <Icon icon={Clock} size={4} />
                  <input type="time" bind:value={localTime} oninput={markDigestDirty} required />
                </label>
              {/snippet}
            </Field>
          </div>

          <Field>
            {#snippet label()}<span>Timezone</span>{/snippet}
            {#snippet input()}
              <input
                class="input input-bordered w-full"
                bind:value={timezone}
                oninput={markDigestDirty}
                placeholder="Europe/London"
                required />
            {/snippet}
            {#snippet info()}Use an IANA timezone. Delivery follows this timezone across devices.{/snippet}
          </Field>
        </fieldset>
      </div>

      <aside class="grid content-start gap-4">
        <div class="rounded-xl border border-base-300 bg-base-200/40 p-4">
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2 font-semibold">
              <Icon icon={Git} size={4.5} /> Watched repositories
            </div>
            <span class="badge badge-ghost">{watchedRepoCount}</span>
          </div>

          {#if watchedRepoCount === 0}
            <div class="py-6 text-center text-sm">
              <p class="text-muted-foreground">No repositories are watched yet.</p>
              <Link href="/git" class="btn btn-primary btn-sm mt-3">Browse repositories</Link>
            </div>
          {:else if repositorySummary.error}
            <p class="mt-4 rounded-lg bg-error/10 p-3 text-sm text-error">
              {repositorySummary.error}
            </p>
          {:else}
            <div class="mt-3 grid max-h-[28rem] gap-2 overflow-auto pr-1">
              {#each repositorySummary.repositories as repository (repository.address)}
                <Link
                  href={getRepoPath(repository.address)}
                  class="rounded-lg border border-base-300 bg-base-100 p-3 transition-colors hover:border-primary/40">
                  <div class="truncate text-sm font-semibold">{repository.name}</div>
                  <div class="mt-1 text-xs leading-5 text-muted-foreground">
                    {getRepoOptionLabels(repository).join(", ") || "No activity selected"}
                  </div>
                </Link>
              {/each}
            </div>
            <p class="mt-3 text-xs text-muted-foreground">
              Change this list and its event options from each repository's Watch control.
            </p>
          {/if}
        </div>

        <div class="rounded-xl border border-base-300 p-4 text-sm">
          <div class="mb-3 font-semibold">Delivery state</div>
          <dl class="grid gap-3">
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted-foreground">Next run</dt>
              <dd class="text-right font-medium">
                {formatStatusTime(providerState.status?.nextRunAt)}
              </dd>
            </div>
            <div class="flex items-start justify-between gap-4">
              <dt class="text-muted-foreground">Last completed</dt>
              <dd class="text-right font-medium">
                {formatStatusTime(providerState.status?.lastCompletedAt)}
              </dd>
            </div>
          </dl>
          {#if savedDigestEnabled && !providerState.status && !digestError}
            <p class="mt-4 rounded-lg bg-warning/10 p-3 text-xs leading-5">
              The registration is awaiting provider confirmation. Refresh after the provider has
              processed it.
            </p>
          {/if}
          {#if providerState.status?.message}
            <p
              class="mt-4 rounded-lg p-3 text-xs leading-5 {['error', 'suppressed'].includes(
                providerState.status.state,
              )
                ? 'bg-error/10'
                : 'bg-base-200'}">
              {providerState.status.message}
            </p>
          {/if}
        </div>
      </aside>
    </div>

    {#if digestError}
      <div
        class="mx-5 mb-4 rounded-xl border border-error/30 bg-error/10 p-3 text-sm text-error sm:mx-6">
        {digestError}
      </div>
    {/if}

    <div
      class="flex flex-col-reverse gap-3 border-t border-base-300 bg-base-200/30 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div class="flex flex-wrap gap-2">
        <Button
          class="btn btn-outline btn-sm inline-flex items-center justify-center text-center [&>span]:min-h-0"
          disabled={loadingStatus || !selectedProvider || !digestSettingsHydrated}
          onclick={() => refreshStatus()}>
          <Spinner loading={loadingStatus}>Refresh status</Spinner>
        </Button>
        {#if savedDigestEnabled}
          <Button
            class="btn btn-outline btn-error btn-sm inline-flex items-center justify-center text-center [&>span]:min-h-0"
            disabled={disablingDigest || savingDigest || !digestSettingsHydrated}
            onclick={disableDigest}>
            <Spinner loading={disablingDigest}>Disable digest</Spinner>
          </Button>
        {/if}
      </div>
      <Button
        type="submit"
        class="btn btn-primary inline-flex items-center justify-center text-center [&>span]:min-h-0"
        disabled={savingDigest ||
          disablingDigest ||
          !digestSettingsHydrated ||
          !selectedProvider ||
          !selectedProviderAvailable ||
          watchedRepoCount === 0 ||
          Boolean(repositorySummary.error)}>
        <Spinner loading={savingDigest}
          >{savedDigestEnabled ? "Save digest" : "Enable digest"}</Spinner>
      </Button>
    </div>
  </form>
</div>
