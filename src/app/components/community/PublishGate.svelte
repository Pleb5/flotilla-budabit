<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import {activeCommunityAdmissionForms, activeCommunityDefinition, activeCommunityProfileListEvents, activeCommunityRelays} from "@app/core/community-state"
  import {FORM_RESPONSE_KIND, getProfileListPubkeys} from "@app/core/community"
  import {
    canWriteCommunityTarget,
    findProfileListEvent,
    getGrantCapableSectionModeratorPubkeys,
    getPrimaryProfileListRef,
    type CommunityWriteTarget,
  } from "@app/core/community-permissions"
  import {
    COMMUNITY_FORM_DELETE_KIND,
    COMMUNITY_FORM_REVIEW_KIND,
    getAdmissionSubmissionState,
    type CommunitySubmissionState,
  } from "@app/core/community-forms"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  type Props = {
    target: CommunityWriteTarget
    action: string
    disabled?: boolean
    submit?: boolean
    class?: string
    children?: import("svelte").Snippet
  }

  const {target, action, disabled = false, submit = false, class: className = "btn btn-primary", children}: Props = $props()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(parsedCommunity?.pubkey || $activeCommunityDefinition?.pubkey || "")
  const accessPath = $derived(communityPubkey ? makeCommunityPath(communityPubkey, "access") : "")
  const section = $derived($activeCommunityDefinition?.sections.find(section => section.name === target.sectionName))
  const form = $derived($activeCommunityAdmissionForms[target.sectionName])
  const responseFilters = $derived(
    $pubkey && form ? [{kinds: [FORM_RESPONSE_KIND], authors: [$pubkey], "#a": [form.address]}] : [],
  )
  const responseEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})))
  const responseIds = $derived($responseEvents.map(event => event.id))
  const deleteFilters = $derived(
    $pubkey && responseIds.length
      ? [{kinds: [COMMUNITY_FORM_DELETE_KIND], authors: [$pubkey], "#e": responseIds}]
      : [],
  )
  const reviewFilters = $derived(
    responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [],
  )
  const deleteEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})))
  const reviewEvents = $derived(deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})))
  const canWrite = $derived(
    Boolean(
      $pubkey &&
        $activeCommunityDefinition &&
        canWriteCommunityTarget({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target,
        }),
    ),
  )
  const hasForm = $derived(Boolean(form))
  const profileListEvent = $derived(findProfileListEvent(getPrimaryProfileListRef(section), $activeCommunityProfileListEvents))
  const writerCount = $derived(getProfileListPubkeys(profileListEvent).length)
  const admissionState = $derived.by<CommunitySubmissionState>(() => {
    if (canWrite) return {status: "granted"}
    if (!$pubkey || !form || !$activeCommunityDefinition) return {status: "none"}

    return getAdmissionSubmissionState({
      responseEvents: $responseEvents,
      deleteEvents: $deleteEvents,
      reviewEvents: $reviewEvents,
      formAddress: form.address,
      applicantPubkey: $pubkey,
      moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({
        definition: $activeCommunityDefinition,
        sectionName: target.sectionName,
      }),
    })
  })
  const reason = $derived(
    !$pubkey
      ? "Log in to request publishing access."
      : admissionState.status === "pending"
        ? `Your ${target.sectionName} access request is pending.`
        : admissionState.status === "rejected"
          ? `Your ${target.sectionName} access request was rejected. Delete it before resubmitting.`
          : !hasForm
            ? `You need ${target.sectionName} permission to ${action}, but no application form is available yet.`
            : `You need ${target.sectionName} permission to ${action}.`,
  )

  $effect(() => {
    if ($activeCommunityRelays.length === 0) return

    const filters = [...responseFilters, ...deleteFilters, ...reviewFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

{#if canWrite}
  <Button type={submit ? "submit" : "button"} class={className} disabled={disabled}>
    {@render children?.()}
  </Button>
{:else if accessPath && $pubkey && hasForm}
  <span title={reason}>
    <Link href={accessPath} class={`${className} btn-disabled pointer-events-auto opacity-75`}>
      {#if admissionState.status === "pending"}
        {target.sectionName} request pending
      {:else if admissionState.status === "rejected"}
        Revise {target.sectionName} request
      {:else}
        Request {target.sectionName} access
      {/if}
    </Link>
  </span>
{:else}
  <Button type="button" class={className} disabled title={reason}>
    {#if $pubkey}
      {hasForm ? `Request ${target.sectionName} access` : `${target.sectionName} access unavailable`}
    {:else}
      Log in to {action}
    {/if}
  </Button>
{/if}

{#if !canWrite && (hasForm || writerCount > 0)}
  <p class="mt-2 text-right text-xs opacity-60">{reason}</p>
{/if}
