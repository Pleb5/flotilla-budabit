<script lang="ts">
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import {
    activeCommunityAdmissionForms,
    activeCommunityDefinition,
    activeCommunityProfileListEvents,
  } from "@app/core/community-state"
  import {getProfileListPubkeys} from "@app/core/community"
  import {
    canWriteCommunityTarget,
    findProfileListEvent,
    getPrimaryProfileListRef,
    type CommunityWriteTarget,
  } from "@app/core/community-permissions"
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
  const hasForm = $derived(Boolean($activeCommunityAdmissionForms[target.sectionName]))
  const profileListEvent = $derived(findProfileListEvent(getPrimaryProfileListRef(section), $activeCommunityProfileListEvents))
  const writerCount = $derived(getProfileListPubkeys(profileListEvent).length)
  const reason = $derived(
    !$pubkey
      ? "Log in to request publishing access."
      : !hasForm
        ? `You need ${target.sectionName} permission to ${action}, but no application form is available yet.`
        : `You need ${target.sectionName} permission to ${action}.`,
  )
</script>

{#if canWrite}
  <Button type={submit ? "submit" : "button"} class={className} disabled={disabled}>
    {@render children?.()}
  </Button>
{:else if accessPath && $pubkey && hasForm}
  <span title={reason}>
    <Link href={accessPath} class={`${className} btn-disabled pointer-events-auto opacity-75`}>
      Request {target.sectionName} access
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
