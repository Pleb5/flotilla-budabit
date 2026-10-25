<script lang="ts">
  import {goto} from "$app/navigation"
  import {pubkey, repository} from "@welshman/app"
  import {deriveEventsAsc, deriveEventsById} from "@welshman/store"
  import type {Filter} from "@welshman/util"
  import Button from "@lib/components/Button.svelte"
  import {
    activeExactCommunityDefinition,
    activeCommunityAdmissionForms,
    activeCommunityDescriptor,
    activeCommunityProfileListEvents,
    activeCommunityReportState,
    loadCommunityEventsWithStatus,
  } from "@app/core/community-state"
  import {selectCommunityMemberList} from "@app/core/community-membership"
  import {getAdmissionSubmissionState} from "@app/core/community-forms"
  import {getGrantCapableSectionModeratorPubkeys} from "@app/core/community-permissions"
  import {isCommunityPersonBanned} from "@app/core/community-reports"
  import {readCommunityJoinEntry, usableJoinForm, joinSetupMessage} from "@app/core/community-join"
  import {makeExactCommunityPath} from "@app/util/routes"

  const definition = $derived($activeExactCommunityDefinition)
  const entry = $derived(readCommunityJoinEntry(definition?.event.tags || []))
  const forms = $derived($activeCommunityAdmissionForms)
  const authorityReady = $derived(
    $activeCommunityDescriptor?.community.address === definition?.pointer.address &&
      $activeCommunityDescriptor?.authorityReadiness.state === "ready",
  )
  const formsReady = $derived(
    $activeCommunityDescriptor?.community.address === definition?.pointer.address &&
      $activeCommunityDescriptor?.admissionFormReadiness.state === "ready",
  )
  const member = $derived(
    selectCommunityMemberList({
      definition,
      profileListEvents: $activeCommunityProfileListEvents,
      reportState: $activeCommunityReportState,
    }).find(p => p.pubkey === $pubkey),
  )
  const banned = $derived(
    Boolean($pubkey && isCommunityPersonBanned($activeCommunityReportState, $pubkey)),
  )
  const filters = $derived<Filter[]>(
    definition && $pubkey
      ? [
          {kinds: [1069], authors: [$pubkey], "#h": [definition.communityId], limit: 200},
          {kinds: [7], "#p": [$pubkey], "#h": [definition.communityId], limit: 200},
          {kinds: [5], authors: [$pubkey], limit: 500},
        ]
      : [],
  )
  const events = $derived(deriveEventsAsc(deriveEventsById({repository, filters})))
  let checked = $state("")
  const checkKey = $derived(`${definition?.event.id || ""}:${$pubkey || ""}`)
  $effect(() => {
    const key = checkKey
    const queries = filters
    const relays = definition?.relays || []
    const controller = new AbortController()
    if (!queries.length) checked = key
    else
      void loadCommunityEventsWithStatus(relays, queries, {signal: controller.signal})
        .then(result => {
          if (!controller.signal.aborted && result.complete && result.events.length < 200)
            checked = key
        })
        .catch(() => {})
    return () => controller.abort()
  })
  const states = $derived(
    definition && $pubkey
      ? Object.values(forms).map(form =>
          getAdmissionSubmissionState({
            community: definition.pointer,
            formAddress: form.address,
            applicantPubkey: $pubkey,
            responseEvents: $events,
            deleteEvents: $events,
            reviewEvents: $events,
            moderatorPubkeys: getGrantCapableSectionModeratorPubkeys({
              definition,
              sectionName: form.sectionName || "",
              profileListEvents: $activeCommunityProfileListEvents,
              reportState: $activeCommunityReportState,
            }),
          }),
        )
      : [],
  )
  const application = $derived(
    states.find(s => s.status === "pending") ||
      states.find(s => s.status === "granted") ||
      states.find(s => s.status === "rejected"),
  )
  const available = $derived(
    entry.status === "selected"
      ? usableJoinForm(forms[entry.sectionName])
      : entry.status === "absent" && Object.values(forms).some(usableJoinForm),
  )
  const ready = $derived(authorityReady && formsReady && checked === checkKey)
</script>

{#if definition}
  <div
    class="flex w-full flex-wrap items-center justify-between gap-2 text-sm"
    aria-label="Community membership">
    <span role="status">
      {#if !authorityReady}Checking membership…
      {:else if banned}Membership unavailable
      {:else if member}Member{member.isOwner
          ? " · Owner"
          : member.isModerator
            ? " · Moderator"
            : ""}
      {:else if !ready}Checking application…
      {:else if application?.status === "pending"}Application pending approval
      {:else if application?.status === "granted"}Approved · checking access
      {:else if application?.status === "rejected"}Application not approved · review it in
        Membership
      {:else if !available}Not joined · application unavailable
      {:else}Not joined{/if}
    </span>
    {#if ready && !member && !banned && !application && available}
      <Button
        class="btn btn-primary btn-sm"
        onclick={() => goto(`${makeExactCommunityPath(definition.pointer, "access")}?join=1`)}
        >Join</Button>
    {/if}
    {#if definition.ownerPubkey === $pubkey && formsReady && joinSetupMessage(definition, forms)}
      <a class="w-full text-sm underline" href={makeExactCommunityPath(definition.pointer, "admin")}
        >{joinSetupMessage(definition, forms)}</a>
    {/if}
  </div>
{/if}
