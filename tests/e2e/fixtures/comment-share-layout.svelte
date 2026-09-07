<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import type {CommentEvent} from "@nostr-git/core/events"
  import {ConfigProvider, IssueThread} from "@nostr-git/ui"
  import EventActions from "@app/components/EventActions.svelte"
  import ContentQuote from "@app/components/ContentQuote.svelte"

  const {
    comment,
    issue,
    repoAddress,
    relays,
  }: {
    comment: TrustedEvent
    issue: TrustedEvent
    repoAddress: string
    relays: string[]
  } = $props()
</script>

<main
  class="fixed inset-0 overflow-auto bg-base-100 p-4"
  style="z-index: 6"
  data-testid="comment-share-layout">
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <h1>Comment sharing layout</h1>
    <section data-testid="comment-toolbar">
      <ConfigProvider components={{EventActions}}>
        <IssueThread
          issueId={issue.id}
          issueKind={String(issue.kind)}
          comments={[comment as CommentEvent]}
          currentCommenter={comment.pubkey}
          onCommentCreated={async () => {}}
          {relays}
          {repoAddress}
          enableReplies />
      </ConfigProvider>
    </section>
    <section data-testid="quoted-comment">
      <h2>Shared comment</h2>
      <ContentQuote
        event={comment}
        url={relays[0]}
        value={{id: comment.id, pubkey: comment.pubkey, kind: comment.kind, relays}} />
    </section>
  </div>
</main>
