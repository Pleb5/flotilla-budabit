<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import {neventEncode} from "nostr-tools/nip19"
  import EventActions from "@app/components/EventActions.svelte"
  import GitItem from "@app/components/GitItem.svelte"
  import RepoFeedGitItem from "@app/components/RepoFeedGitItem.svelte"
  import ContentQuote from "@app/components/ContentQuote.svelte"
  import ThreadActions from "@app/components/ThreadActions.svelte"
  import GoalActions from "@app/components/GoalActions.svelte"
  import CalendarEventActions from "@app/components/CalendarEventActions.svelte"
  import CommentActions from "@app/components/CommentActions.svelte"
  import CommunityLinkCard from "@app/components/community/CommunityLinkCard.svelte"
  import {makeCommunityPointer} from "@app/core/community"
  // Use packaged components, just as the app does (package-local aliases are compiled out).
  import FeedItem from "../../../packages/nostr-git-ui/dist/components/feed/FeedItem.svelte"
  import GitPermalinkComponent from "../../../packages/nostr-git-ui/dist/components/events/GitPermalinkComponent.svelte"

  const {
    event,
    announcement,
    permalink,
    relays,
  }: {
    event: TrustedEvent
    announcement: TrustedEvent
    permalink: TrustedEvent
    relays: string[]
  } = $props()
  const url = relays[0]
  const eventLink = neventEncode({id: event.id, author: event.pubkey, kind: event.kind, relays})
  const community = makeCommunityPointer({
    ownerPubkey: event.pubkey,
    communityId: "3".repeat(64),
    relayHints: relays,
  })!
  const noop = () => {}
</script>

<main
  class="fixed inset-0 overflow-auto bg-base-100 p-4"
  style="z-index: 100"
  data-testid="share-action-fixture">
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <h1>Share action regression fixture</h1>
    <section data-testid="read-only">
      <h2>Read only</h2>
      <EventActions {event} {url} {relays} noun="issue" readOnly />
    </section>
    <section data-testid="menu-only">
      <h2>Compact actions</h2>
      <EventActions {event} {url} {relays} noun="issue" menuOnly />
    </section>
    <section data-testid="no-menu">
      <h2>No overflow menu</h2>
      <EventActions {event} {url} {relays} noun="issue" hideMenu />
    </section>
    <section data-testid="repo">
      <h2>Repository without secondary actions</h2>
      <GitItem
        event={announcement}
        {url}
        showActions={false}
        loadProfiles={false}
        onToggleBookmark={noop} />
    </section>
    <section data-testid="activity">
      <h2>Repository activity</h2>
      <RepoFeedGitItem {event} {url} interactionRelays={relays} openHref="/git" />
    </section>
    <section data-testid="quote">
      <h2>Quoted issue</h2>
      <ContentQuote
        {event}
        {url}
        value={{id: event.id, pubkey: event.pubkey, kind: event.kind, relays}} />
    </section>
    <section data-testid="permalink">
      <h2>Permalink</h2>
      <GitPermalinkComponent event={permalink} {relays} />
    </section>
    <section data-testid="feed">
      <h2>Feed actions without hover</h2>
      <FeedItem
        author={{pubkey: event.pubkey}}
        createdAt="2026-09-07"
        {eventLink}
        onReact={noop}
        onReply={noop}
        onBookmark={noop}>
        Share remains first.
      </FeedItem>
    </section>
    <section data-testid="feed-no-actions">
      <h2>Feed without quick actions</h2>
      <FeedItem
        author={{pubkey: event.pubkey}}
        createdAt="2026-09-07"
        {eventLink}
        showQuickActions={false}>
        Share remains visible.
      </FeedItem>
    </section>
    <section data-testid="community">
      <h2>Community link</h2>
      <CommunityLinkCard value={community} />
    </section>
    <section data-testid="thread">
      <h2>Thread actions</h2>
      <ThreadActions {event} {url} {relays} readOnly />
    </section>
    <section data-testid="goal">
      <h2>Goal actions</h2>
      <GoalActions {event} {url} {relays} readOnly />
    </section>
    <section data-testid="calendar">
      <h2>Calendar actions</h2>
      <CalendarEventActions {event} {url} {relays} readOnly />
    </section>
    <section data-testid="comment">
      <h2>Comment actions</h2>
      <CommentActions {event} {url} />
    </section>
  </div>
</main>
