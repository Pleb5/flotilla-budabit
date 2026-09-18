<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, getTagValue, type TrustedEvent} from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import {GIT_REPO_ANNOUNCEMENT} from "@nostr-git/core/events"
  import Git from "@assets/icons/git.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Field from "@lib/components/Field.svelte"
  import CommunityMenuButton from "@app/components/CommunityMenuButton.svelte"
  import PublishGate from "@app/components/community/PublishGate.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {
    activeCommunityBootstrapStatus,
    activeCommunityDescriptor,
    activeExactCommunityDefinition,
    activeCommunityProfileListEvents,
    activeExactCommunityRelays,
    activeExactCommunityPublishRelays,
    activeCommunityReportState,
  } from "@app/core/community-state"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunityWriteTargetSectionName,
    getCommunityTargetWriterPubkeys,
  } from "@app/core/community-permissions"
  import {getRepoAnnouncementPublishRelays} from "@app/core/git-state"
  import {
    makeCommunityContentFilterPlan,
    makeCommunityRepositoryFilter,
  } from "@app/core/community-feeds"
  import {getRepoAddress, isAuthorizedDirectCommunityRepo} from "@app/core/repo-community-context"
  import {RELAY_REQUEST_PRIORITY} from "@app/core/relay-policy"
  import {loadBoundedCommunityHistory} from "@app/core/requests"
  import {parseExactCommunityRouteParam} from "@app/util/routes"

  const routeCommunity = $derived(parseExactCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(routeCommunity?.ownerPubkey || "")
  const communityId = $derived(routeCommunity?.communityId || "")
  const communityAddress = $derived(routeCommunity?.address || "")
  const communityDefinition = $derived(
    $activeExactCommunityDefinition?.pointer.address === communityAddress &&
      $activeExactCommunityDefinition.ownerPubkey === communityPubkey
      ? $activeExactCommunityDefinition
      : undefined,
  )
  const communityBootstrapReady = $derived(
    Boolean(
      communityPubkey &&
      communityDefinition &&
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
  const repoAuthorPubkeys = $derived(
    communityAuthorityReady && communityDefinition
      ? getCommunityTargetWriterPubkeys({
          definition: communityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          target: COMMUNITY_WRITE_TARGETS.repository,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const directRepoFilterPlan = $derived.by(() =>
    communityAuthorityReady
      ? makeCommunityContentFilterPlan(
          [makeCommunityRepositoryFilter(communityId)],
          repoAuthorPubkeys,
        )
      : {relayFilters: [], localFilters: []},
  )
  const directRepoEventsStore = $derived(
    directRepoFilterPlan.localFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: directRepoFilterPlan.localFilters as any}),
        )
      : undefined,
  )
  const repos = $derived.by(() => {
    if (!communityId || !communityAuthorityReady || !communityDefinition) return []

    const candidates = $directRepoEventsStore ? ($directRepoEventsStore as TrustedEvent[]) : []
    const latest = new Map<string, TrustedEvent>()

    for (const event of candidates) {
      if (
        !isAuthorizedDirectCommunityRepo({event, communityId, authorPubkeys: repoAuthorPubkeys})
      ) {
        continue
      }

      const address = getRepoAddress(event)
      if (!address) continue

      const current = latest.get(address)
      if (!current || event.created_at > current.created_at) latest.set(address, event)
    }

    return Array.from(latest.values()).sort(
      (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
    )
  })
  const canCreateRepo = $derived(
    Boolean(
      $pubkey &&
      communityAuthorityReady &&
      communityDefinition &&
      canWriteCommunityTarget({
        definition: communityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
        reportState: $activeCommunityReportState,
      }),
    ),
  )
  const repoSectionName = $derived(
    getCommunityWriteTargetSectionName(
      communityAuthorityReady ? communityDefinition : undefined,
      COMMUNITY_WRITE_TARGETS.repository,
    ),
  )
  const repoAccessMessage = $derived(`Request ${repoSectionName} access to publish repositories.`)

  const createRepoAnnouncement = () => {
    if (!$pubkey || !communityId || !name.trim()) return
    if (!canCreateRepo) {
      pushToast({theme: "error", message: repoAccessMessage})
      return
    }
    const relays = $activeExactCommunityPublishRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const repoId = slug.trim() || randomId()
    const repoTemplate = {
      content: "",
      tags: [
        ["d", repoId],
        ["h", communityId, relays[0]],
        ["name", name.trim()],
        ["description", description.trim()],
        ...(clone.trim() ? [["clone", clone.trim()]] : []),
        ["relays", ...relays],
      ],
    }
    const repoEvent = makeEvent(GIT_REPO_ANNOUNCEMENT, repoTemplate)
    const announcementRelays = getRepoAnnouncementPublishRelays({
      repoEvent,
      repoRelays: relays,
    })

    publishThunk({relays: announcementRelays, event: repoEvent})

    name = ""
    slug = ""
    description = ""
    clone = ""
    pushToast({message: "Repository announcement published."})
  }

  let name = $state("")
  let slug = $state("")
  let description = $state("")
  let clone = $state("")
  let directRepoLoading = $state(false)
  let directRepoLoadSettled = $state(false)
  let directRepoRetryVersion = $state(0)
  const retryDirectRepoHistory = () => {
    if (communityBootstrapFailed || communityAuthorityUnavailable) {
      window.location.reload()
      return
    }
    if (!directRepoLoading) directRepoRetryVersion += 1
  }
  const reposLoading = $derived(
    !communityBootstrapFailed &&
      !communityAuthorityUnavailable &&
      (communityBootstrapLoading ||
        communityAuthorityLoading ||
        directRepoLoading ||
        (!directRepoLoadSettled && directRepoFilterPlan.relayFilters.length > 0)),
  )
  $effect(() => {
    void directRepoRetryVersion
    const relays = $activeExactCommunityRelays
    const relayFilters = directRepoFilterPlan.relayFilters
    const localFilters = directRepoFilterPlan.localFilters

    if (!communityBootstrapReady) {
      directRepoLoading = false
      directRepoLoadSettled = false
      return
    }
    if (relayFilters.length === 0 || localFilters.length === 0) {
      directRepoLoading = false
      directRepoLoadSettled = true
      return
    }
    if (relays.length === 0) {
      directRepoLoading = false
      directRepoLoadSettled = true
      return
    }

    const controller = new AbortController()
    directRepoLoading = true
    directRepoLoadSettled = false
    void loadBoundedCommunityHistory({
      relays,
      relayFilters,
      localFilters,
      priority: RELAY_REQUEST_PRIORITY.interactive,
      owner: `community-repositories:${communityPubkey}`,
      signal: controller.signal,
    })
      .catch(error => {
        if (controller.signal.aborted) return
        console.warn("[community-repositories] Failed to load direct repositories", error)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        directRepoLoading = false
        directRepoLoadSettled = true
      })

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center">
      <Icon icon={Git} />
    </div>
  {/snippet}
  {#snippet title()}
    <strong>Repositories</strong>
  {/snippet}
  {#snippet action()}
    <CommunityMenuButton community={routeCommunity?.naddr} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createRepoAnnouncement)}>
    <strong>Create repository announcement</strong>
    <Field>
      {#snippet label()}<p>Name</p>{/snippet}
      {#snippet input()}<input
          bind:value={name}
          class="input input-bordered w-full"
          type="text" />{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Identifier</p>{/snippet}
      {#snippet input()}<input
          bind:value={slug}
          class="input input-bordered w-full"
          type="text" />{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Clone URL</p>{/snippet}
      {#snippet input()}<input
          bind:value={clone}
          class="input input-bordered w-full"
          type="text" />{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Description</p>{/snippet}
      {#snippet input()}<textarea
          bind:value={description}
          class="textarea textarea-bordered"
          rows="3"></textarea
        >{/snippet}
    </Field>
    <div class="flex justify-end">
      <PublishGate
        target={COMMUNITY_WRITE_TARGETS.repository}
        action="publish repositories"
        submit
        disabled={!name.trim()}>
        Publish repo
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each repos as repo (repo.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <strong
          >{getTagValue("name", repo.tags) || getTagValue("d", repo.tags) || "Repository"}</strong>
        <p class="text-sm opacity-70">{getTagValue("description", repo.tags) || ""}</p>
        {#if getTagValue("clone", repo.tags)}
          <p class="break-all text-xs opacity-60">{getTagValue("clone", repo.tags)}</p>
        {/if}
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">
        {#if reposLoading}
          <Spinner loading>Looking for repositories...</Spinner>
        {:else if communityBootstrapFailed || communityAuthorityUnavailable}
          <span class="flex flex-col items-center gap-3">
            Repositories unavailable.
            <button class="btn btn-neutral btn-sm" type="button" onclick={retryDirectRepoHistory}
              >Retry</button>
          </span>
        {:else}
          No repositories found.
        {/if}
      </p>
    {/each}
  </div>
</PageContent>
