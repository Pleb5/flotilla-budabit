<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, publishThunk, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {makeEvent, getTagValue} from "@welshman/util"
  import {randomId} from "@welshman/lib"
  import LinkRound from "@assets/icons/link-round.svg?dataurl"
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
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {COMMUNITY_SECTION_PERMALINKS, TARGETED_PUBLICATION_KIND} from "@app/core/community"
  import {
    GIT_PERMALINK_KIND,
    makeCommunityTargetingFilter,
    makeTargetedPublicationOriginalFilters,
  } from "@app/core/community-feeds"
  import {makeTargetedPublicationForCommunity, withPublicationTargetingId} from "@app/core/community-targeting"
  import {
    COMMUNITY_WRITE_TARGETS,
    canWriteCommunityTarget,
    getCommunitySectionWriterPubkeys,
  } from "@app/core/community-permissions"
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
  const targetingFilters = $derived(
    communityBootstrapReady && communityPubkey
      ? [makeCommunityTargetingFilter(communityPubkey, [GIT_PERMALINK_KIND])]
      : [],
  )
  const targetingEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: targetingFilters})),
  )
  const permalinkAuthorPubkeys = $derived(
    $activeCommunityDefinition
      ? getCommunitySectionWriterPubkeys({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          sectionName: COMMUNITY_SECTION_PERMALINKS,
        })
      : [],
  )
  const permalinkFilters = $derived(
    communityBootstrapReady && permalinkAuthorPubkeys.length
      ? makeTargetedPublicationOriginalFilters($targetingEvents, permalinkAuthorPubkeys)
      : [],
  )
  const permalinks = $derived(deriveEventsAsc(deriveEventsById({repository, filters: permalinkFilters})))
  const canCreatePermalink = $derived(
    Boolean(
      $pubkey &&
        communityBootstrapReady &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target: COMMUNITY_WRITE_TARGETS.permalink,
        }),
    ),
  )

  const createPermalink = () => {
    if (!$pubkey || !communityPubkey || !repo.trim() || !file.trim() || !commit.trim()) return
    if (!canCreatePermalink) {
      pushToast({theme: "error", message: "You do not have permission to publish permalinks."})
      return
    }
    const relays = $activeCommunityRelays
    if (relays.length === 0) {
      pushToast({theme: "error", message: "Community relays are not loaded yet."})
      return
    }

    const targetingId = randomId()
    publishThunk({
      relays,
      event: makeEvent(
        GIT_PERMALINK_KIND,
        withPublicationTargetingId(
          {
            content: description.trim(),
            tags: [
              ["repo", repo.trim()],
              ["file", file.trim()],
              ["commit", commit.trim()],
              ...(line.trim() ? [["line", line.trim()]] : []),
            ],
          },
          targetingId,
        ),
      ),
    })
    publishThunk({
      relays,
      event: makeEvent(
        TARGETED_PUBLICATION_KIND,
        makeTargetedPublicationForCommunity({
          targetingId,
          originalKind: GIT_PERMALINK_KIND,
          originalRef: undefined,
          communityPubkey,
          communityRelay: relays[0],
        }),
      ),
    })

    repo = ""
    file = ""
    commit = ""
    line = ""
    description = ""
    pushToast({message: "Permalink published."})
  }

  let repo = $state("")
  let file = $state("")
  let commit = $state("")
  let line = $state("")
  let description = $state("")
  let loadingTargets = $state(false)
  let targetRequestDone = $state(false)
  let loadingPermalinks = $state(false)
  let permalinkRequestDone = $state(false)
  const permalinksLoading = $derived(
    communityBootstrapLoading ||
      loadingTargets ||
      loadingPermalinks ||
      !targetRequestDone ||
      (permalinkFilters.length > 0 && !permalinkRequestDone && $permalinks.length === 0),
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
    request({relays: $activeCommunityRelays, autoClose: true, filters: targetingFilters, signal: controller.signal})
      .catch(() => undefined)
      .finally(() => {
        if (controller.signal.aborted) return
        loadingTargets = false
        targetRequestDone = true
      })

    return () => controller.abort()
  })

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0 || permalinkFilters.length === 0) {
      loadingPermalinks = false
      permalinkRequestDone = false
      return
    }

    const controller = new AbortController()
    loadingPermalinks = true
    permalinkRequestDone = false
    request({relays: $activeCommunityRelays, autoClose: true, filters: permalinkFilters, signal: controller.signal})
      .catch(() => undefined)
      .finally(() => {
        if (controller.signal.aborted) return
        loadingPermalinks = false
        permalinkRequestDone = true
      })

    return () => controller.abort()
  })
</script>

<PageBar>
  {#snippet icon()}
    <div class="center"><Icon icon={LinkRound} /></div>
  {/snippet}
  {#snippet title()}<strong>Permalinks</strong>{/snippet}
  {#snippet action()}
    <CommunityMenuButton community={communityPubkey} />
  {/snippet}
</PageBar>

<PageContent class="content col-4 p-4">
  <form class="card2 bg-alt col-3 p-4 shadow-md" onsubmit={preventDefault(createPermalink)}>
    <strong>Create targeted permalink</strong>
    <Field>{#snippet label()}<p>Repo address</p>{/snippet}{#snippet input()}<input bind:value={repo} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>File</p>{/snippet}{#snippet input()}<input bind:value={file} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>Commit</p>{/snippet}{#snippet input()}<input bind:value={commit} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>Line</p>{/snippet}{#snippet input()}<input bind:value={line} class="input input-bordered w-full" />{/snippet}</Field>
    <Field>{#snippet label()}<p>Description</p>{/snippet}{#snippet input()}<textarea bind:value={description} class="textarea textarea-bordered" rows="3"></textarea>{/snippet}</Field>
    <div class="flex justify-end">
      <PublishGate target={COMMUNITY_WRITE_TARGETS.permalink} action="publish permalinks" submit disabled={!repo.trim() || !file.trim() || !commit.trim()}>
        Publish permalink
      </PublishGate>
    </div>
  </form>

  <div class="col-2">
    {#each $permalinks as permalink (permalink.id)}
      <div class="card2 bg-alt p-4 shadow-md">
        <strong>{getTagValue("file", permalink.tags) || "Permalink"}</strong>
        <p class="break-all text-xs opacity-60">{getTagValue("repo", permalink.tags) || ""}</p>
        <p class="text-sm opacity-70">{getTagValue("commit", permalink.tags) || ""}{getTagValue("line", permalink.tags) ? `:${getTagValue("line", permalink.tags)}` : ""}</p>
        {#if permalink.content}<p class="whitespace-pre-wrap">{permalink.content}</p>{/if}
      </div>
    {:else}
      <p class="py-8 text-center opacity-70">
        {#if permalinksLoading}
          <Spinner loading>Looking for permalinks...</Spinner>
        {:else}
          No targeted permalinks found.
        {/if}
      </p>
    {/each}
  </div>
</PageContent>
