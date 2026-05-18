<script lang="ts">
  import {page} from "$app/stores"
  import {request} from "@welshman/net"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import {DELETE} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import {
    activeCommunityAdmissionForms,
    activeCommunityBootstrapStatus,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
    activeCommunityRelays,
  } from "@app/core/community-state"
  import {FORM_RESPONSE_KIND} from "@app/core/community"
  import {
    getCommunityPublishGateState,
    type CommunityPublishGateState,
    type CommunityWriteTarget,
  } from "@app/core/community-permissions"
  import {COMMUNITY_FORM_REVIEW_KIND} from "@app/core/community-forms"
  import LogIn from "@app/components/LogIn.svelte"
  import {pushModal} from "@app/util/modal"
  import {makeCommunityPath, parseCommunityRouteParam} from "@app/util/routes"

  type Props = {
    target: CommunityWriteTarget
    action: string
    disabled?: boolean
    submit?: boolean
    compact?: boolean
    class?: string
    href?: string
    children?: import("svelte").Snippet
  }

  const {
    target,
    action,
    disabled = false,
    submit = false,
    compact = false,
    class: className = "btn btn-primary",
    href = "",
    children,
  }: Props = $props()

  const parsedCommunity = $derived(parseCommunityRouteParam($page.params.community))
  const communityPubkey = $derived(
    parsedCommunity?.pubkey || $activeCommunityDefinition?.pubkey || "",
  )
  const accessPath = $derived(
    communityPubkey
      ? `${makeCommunityPath(communityPubkey, "access")}?section=${encodeURIComponent(target.sectionName)}`
      : "",
  )
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
  const form = $derived($activeCommunityAdmissionForms[target.sectionName])
  const responseFilters = $derived(
    communityBootstrapReady && $pubkey && form
      ? [{kinds: [FORM_RESPONSE_KIND], authors: [$pubkey], "#a": [form.address]}]
      : [],
  )
  const responseEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: responseFilters})),
  )
  const responseIds = $derived($responseEvents.map(event => event.id))
  const deleteFilters = $derived(
    $pubkey && responseIds.length ? [{kinds: [DELETE], authors: [$pubkey], "#e": responseIds}] : [],
  )
  const reviewFilters = $derived(
    responseIds.length ? [{kinds: [COMMUNITY_FORM_REVIEW_KIND], "#e": responseIds}] : [],
  )
  const deleteEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: deleteFilters})),
  )
  const reviewEvents = $derived(
    deriveEventsAsc(deriveEventsById({repository, filters: reviewFilters})),
  )
  const gateState = $derived.by<CommunityPublishGateState>(() =>
    communityBootstrapReady && $activeCommunityDefinition
      ? getCommunityPublishGateState({
          definition: $activeCommunityDefinition,
          profileListEvents: $activeCommunityProfileListEvents,
          userPubkey: $pubkey,
          target,
          form,
          responseEvents: $responseEvents,
          deleteEvents: $deleteEvents,
          reviewEvents: $reviewEvents,
        })
      : {...target, status: $pubkey ? "missing" : "login-required", form},
  )
  const canWrite = $derived(gateState.status === "allowed")
  const hasForm = $derived(Boolean(form))
  const reason = $derived(
    !$pubkey
      ? "Log in to request publishing access."
      : gateState.status === "pending"
        ? `Your ${target.sectionName} access request is pending.`
        : gateState.status === "rejected"
          ? `Your ${target.sectionName} access request was rejected. Delete it before resubmitting.`
          : gateState.status === "granted"
            ? `Your ${target.sectionName} request was granted. Waiting for community permission state to sync.`
            : !hasForm
              ? `You need ${target.sectionName} permission to ${action}, but no application form is available yet.`
              : `You need ${target.sectionName} permission to ${action}.`,
  )
  const accessLabel = $derived(
    gateState.status === "pending"
      ? "Access pending"
      : gateState.status === "rejected"
        ? "Revise access"
        : gateState.status === "granted"
          ? "Syncing access"
          : hasForm
            ? "Request access"
            : "Access options",
  )

  const login = () => pushModal(LogIn)

  $effect(() => {
    if (!communityBootstrapReady || $activeCommunityRelays.length === 0) return

    const filters = [...responseFilters, ...deleteFilters, ...reviewFilters]
    if (filters.length === 0) return

    const controller = new AbortController()
    request({relays: $activeCommunityRelays, autoClose: true, filters, signal: controller.signal})

    return () => controller.abort()
  })
</script>

{#if communityBootstrapLoading}
  <Button type="button" class={className} disabled title="Loading community permissions...">
    {@render children?.()}
  </Button>
{:else if canWrite && href && !submit && !disabled}
  <Link {href} class={className}>
    {@render children?.()}
  </Link>
{:else if canWrite}
  <Button type={submit ? "submit" : "button"} class={className} {disabled}>
    {@render children?.()}
  </Button>
{:else if accessPath && $pubkey && hasForm}
  <span title={reason}>
    <Link href={accessPath} class={`${className} ${compact ? "btn-sm" : ""}`}>
      {accessLabel}
    </Link>
  </span>
{:else if accessPath && $pubkey}
  <span title={reason}>
    <Link href={accessPath} class={`${className} ${compact ? "btn-sm" : ""}`}>
      {accessLabel}
    </Link>
  </span>
{:else if $pubkey}
  <Button type="button" class={className} disabled title={reason}>
    {hasForm ? "Request access" : "Access unavailable"}
  </Button>
{:else}
  <Button type="button" class={className} title={reason} onclick={login}>
    {compact ? "Log in" : `Log in to ${action}`}
  </Button>
{/if}
