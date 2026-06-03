<script lang="ts">
  import { onMount } from "svelte";
  import type { NostrEvent } from "nostr-tools";
  import type { Nip34Event, StatusEvent } from "@nostr-git/core/events";
  import { isStatusEvent } from "@nostr-git/core/events";

  import GitRepoComponent from "./GitRepoComponent.svelte";
  import GitRepoStateComponent from "./GitRepoStateComponent.svelte";
  import GitIssueComponent from "./GitIssueComponent.svelte";
  import GitCommentComponent from "./GitCommentComponent.svelte";
  import GitPermalinkComponent from "./GitPermalinkComponent.svelte";
  import GitStatusComponent from "./GitStatusComponent.svelte";
  import UnknownEventComponent from "./UnknownEventComponent.svelte";

  // New unified feed components
  import GitStatusFeed from "../feed/GitStatusFeed.svelte";
  import GitCommentFeed from "../feed/GitCommentFeed.svelte";

  interface Props {
    event: NostrEvent;
    useFeedStyle?: boolean; // Toggle between old and new style
    compact?: boolean; // Skip FeedItem wrapper (for when already in a container)
    relay?: string;
  }

  let { event, useFeedStyle = true, compact = false, relay }: Props = $props();

  let componentType = $state<string>("unknown");
  let isKnownEvent = $state(false);

  const eventKind = $derived(event.kind);

  const getComponentType = (kind: number): string => {
    switch (kind) {
      case 30617:
        return "git-repo";
      case 30618:
        return "git-repo-state";
      case 1621:
        return "git-issue";
      case 1623:
        return "git-permalink";
      case 1630:
      case 1631:
      case 1632:
      case 1633:
        return "git-status";
      case 7:
        return "reaction";
      case 10002:
        return "relay-list";
      case 14:
        return "encrypted-message";
      case 1111:
        return "git-comment";
      case 31922:
        return "calendar-event";
      default:
        return "unknown";
    }
  };

  const checkIfKnownEvent = (kind: number): boolean => {
    const knownKinds = [
      30617, 30618, 1621, 1623, 1630, 1631, 1632, 1633, 7, 10002, 14, 1111, 31922,
    ];
    return knownKinds.includes(kind);
  };

  $effect(() => {
    if (event) {
      componentType = getComponentType(event.kind);
      isKnownEvent = checkIfKnownEvent(event.kind);
    }
  });

  onMount(() => {
    componentType = getComponentType(event.kind);
    isKnownEvent = checkIfKnownEvent(event.kind);
  });
</script>

<!-- Route to appropriate component based on event kind -->
{#if useFeedStyle}
  <!-- New unified feed style components -->
  {#if componentType === "git-issue"}
    <GitIssueComponent event={event} relay={relay} />
  {:else if componentType === "git-comment"}
    <GitCommentFeed event={event} />
  {:else if componentType === "git-permalink"}
    <GitPermalinkComponent event={event} relay={relay} />
  {:else if componentType === "git-status"}
    {#if isStatusEvent(event as unknown as Nip34Event)}
      <GitStatusFeed event={event as StatusEvent} />
    {:else}
      <UnknownEventComponent event={event} />
    {/if}
  {:else if componentType === "git-repo"}
    <GitRepoComponent event={event} />
  {:else if componentType === "git-repo-state"}
    <GitRepoStateComponent event={event} />
  {:else if isKnownEvent}
    <UnknownEventComponent event={event} />
  {:else}
    <UnknownEventComponent event={event} />
  {/if}
{:else}
  <!-- Legacy components -->
  {#if componentType === "git-repo"}
    <GitRepoComponent event={event} />
  {:else if componentType === "git-repo-state"}
    <GitRepoStateComponent event={event} />
  {:else if componentType === "git-issue"}
    <GitIssueComponent event={event} relay={relay} />
  {:else if componentType === "git-comment"}
    <GitCommentComponent event={event} />
  {:else if componentType === "git-permalink"}
    <GitPermalinkComponent event={event} relay={relay} />
  {:else if componentType === "git-status"}
    <GitStatusComponent event={event} />
  {:else if isKnownEvent}
    <UnknownEventComponent event={event} />
  {:else}
    <UnknownEventComponent event={event} />
  {/if}
{/if}
