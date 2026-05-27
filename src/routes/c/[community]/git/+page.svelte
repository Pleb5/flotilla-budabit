<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
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
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {COMMUNITY_SECTION_REPOSITORIES, TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
  import {
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilters,
  } from "@app/core/community-feeds"
  import {
    makeAddressablePublicationRef,
    makeTargetedPublicationForCommunity,
  } from "@app/core/community-targeting"
  import {
    buildRepoCommunityContexts,
    getRepoAddress,
    isEndorsedRepoCommunityContext,
  } from "@app/core/repo-community-context"
  import {parseCommunityRouteParam} from "@app/util/routes"

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
  const repoAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_REPOSITORIES,
          reportState: $activeCommunityReportState,
        })
      : [],
  )
  const repoFilters = $derived(
    communityBootstrapReady && repoAuthorPubkeys.length
      ? [{kinds: [GIT_REPO_ANNOUNCEMENT], authors: repoAuthorPubkeys, "#h": [communityPubkey]}]
      : [],
  )
  const legacyRepoEventsStore = $derived(
    repoFilters.length
      ? deriveEventsAsc(deriveEventsById({repository, filters: repoFilters}))
      : undefined,
  )
  const communityRepoAssociationFilters = $derived(
    communityBootstrapReady && communityPubkey
      ? [makeCommunityTargetingFilter(communityPubkey, [GIT_REPO_ANNOUNCEMENT])]
      : [],
  )
  const communityRepoAssociationEventsStore = $derived(
    communityRepoAssociationFilters.length
      ? deriveEventsAsc(
          deriveEventsById({repository, filters: communityRepoAssociationFilters as any}),
        )
      : undefined,
  )
  const targetedRepoFilters = $derived.by(() =>
    $communityRepoAssociationEventsStore
      ? makeTargetedPublicationOriginalFilters(
          $communityRepoAssociationEventsStore as TrustedEvent[],
        )
      : [],
  )
  const targetedRepoEventsStore = $derived(
    targetedRepoFilters.length
      ? deriveEventsAsc(deriveEventsById({repository, filters: targetedRepoFilters as any}))
      : undefined,
  )
  const repoLoadFilters = $derived.by(() => [
    ...repoFilters,
    ...communityRepoAssociationFilters,
    ...targetedRepoFilters,
  ])
  const repoReportStates = $derived.by(() =>
    communityPubkey && $activeCommunityReportState
      ? new Map([[communityPubkey, $activeCommunityReportState]])
      : undefined,
  )
  const repos = $derived.by(() => {
    if (!communityPubkey || !$activeCommunityDefinition) return []

    const associationEvents = $communityRepoAssociationEventsStore
      ? ($communityRepoAssociationEventsStore as TrustedEvent[])
      : []
    const candidates = [
      ...($legacyRepoEventsStore ? ($legacyRepoEventsStore as TrustedEvent[]) : []),
      ...($targetedRepoEventsStore ? ($targetedRepoEventsStore as TrustedEvent[]) : []),
    ]
    const latest = new Map<string, TrustedEvent>()

    for (const event of candidates) {
      const context = buildRepoCommunityContexts({
        repoEvent: event,
        associationEvents,
        definitions: [$activeCommunityDefinition],
        profileListEvents: $activeCommunityProfileListEvents,
        reportStates: repoReportStates,
        activeCommunityPubkey: communityPubkey,
      }).find(context => context.communityPubkey === communityPubkey)
      if (!isEndorsedRepoCommunityContext(context)) continue

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
      communityBootstrapReady &&
      $activeCommunityDefinition &&
      canWriteCommunityTarget({
        definition: $activeCommunityDefinition,
        profileListEvents: $activeCommunityProfileListEvents,
        userPubkey: $pubkey,
        target: COMMUNITY_WRITE_TARGETS.repository,
        reportState: $activeCommunityReportState,
      }),
    ),
  )

  const createRepoAnnouncement = () => {
    if (!$pubkey || !communityPubkey || !name.trim()) return
    if (!canCreateRepo) {
      pushToast({theme: "error", message: "You do not have permission to publish repositories."})
      return
    }
    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const repoId = slug.trim() || randomId()
    const repoTemplate = {
      content: "",
      tags: [
        ["d", repoId],
        ["h", communityPubkey, relays[0]],
        ["name", name.trim()],
        ["description", description.trim()],
        ...(clone.trim() ? [["clone", clone.trim()]] : []),
        ["relays", ...relays],
      ],
    }
    const targetingId = randomId()

    publishThunk({relays, event: makeEvent(GIT_REPO_ANNOUNCEMENT, repoTemplate)})
    publishThunk({
      relays,
      event: makeEvent(
        TARGETED_PUBLICATION_KIND,
        makeTargetedPublicationForCommunity({
          targetingId,
          originalKind: GIT_REPO_ANNOUNCEMENT,
          originalRef: makeAddressablePublicationRef({
            kind: GIT_REPO_ANNOUNCEMENT,
            pubkey: $pubkey,
            identifier: repoId,
            relay: relays[0],
          }),
          communityPubkey,
          communityRelay: relays[0],
        }),
      ),
    })

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
  let loadingRepos = $state(false)
  let repoRequestDone = $state(false)
  const reposLoading = $derived(
    communityBootstrapLoading ||
      loadingRepos ||
      (repoLoadFilters.length > 0 && !repoRequestDone && repos.length === 0),
  )

  $effect(() => {
    if (
      !communityBootstrapReady ||
      $activeCommunityRelays.length === 0 ||
      repoLoadFilters.length === 0
    ) {
      loadingRepos = false
      repoRequestDone = false
      return
    }

    const controller = new AbortController()
    loadingRepos = true
    repoRequestDone = false
    request({
      relays: $activeCommunityRelays,
      autoClose: true,
      filters: repoLoadFilters as any,
      signal: controller.signal,
    })
      .catch(() => undefined)
      .finally(() => {
        if (controller.signal.aborted) return
        loadingRepos = false
        repoRequestDone = true
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
    <CommunityMenuButton community={communityPubkey} />
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
        {:else}
          No repositories found.
        {/if}
      </p>
    {/each}
  </div>
</PageContent>
