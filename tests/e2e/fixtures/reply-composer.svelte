<script lang="ts">
  import type {CommentEvent} from "@nostr-git/core/events"
  import {ConfigProvider, IssueThread} from "@nostr-git/ui"
  import EventActions from "@app/components/EventActions.svelte"
  import RepoRichCommentComposer from "@app/components/RepoRichCommentComposer.svelte"

  const {
    threadType = "issue",
    editorType = "rich",
  }: {
    threadType?: "issue" | "pr" | "commit"
    editorType?: "rich" | "plain"
  } = $props()
  const pubkey = "7".repeat(64)
  const repoAddress = `30617:${pubkey}:reply-composer`
  const rootKind = threadType === "commit" ? "commit" : threadType === "pr" ? "1618" : "1621"
  const rootId = threadType === "commit" ? `git:commit:${"a".repeat(40)}` : "a".repeat(64)
  const comments: CommentEvent[] = Array.from({length: 24}, (_, index) => ({
    id: (index + 1).toString(16).padStart(64, "0"),
    pubkey,
    kind: 1111,
    created_at: 1_700_000_000 + index,
    content: `Repository comment ${index + 1}.`,
    tags: [
      [threadType === "commit" ? "I" : "E", rootId],
      ["K", rootKind],
      [
        index === 1 || threadType !== "commit" ? "e" : "i",
        index === 1 ? "1".padStart(64, "0") : rootId,
      ],
      ["k", index === 1 ? "1111" : rootKind],
      ["p", pubkey],
      ["q", repoAddress],
    ],
    // UI-only fixture events: never signed or published.
    sig: "0".repeat(128),
  }))
  let submissions = $state(0)
</script>

<main
  class="fixed inset-0 overflow-auto bg-base-100 p-4"
  style="z-index: 6"
  data-testid="reply-composer-fixture">
  <div class="mx-auto max-w-3xl">
    <h1>{threadType} discussion / {editorType} composer</h1>
    <output data-testid="submissions">{submissions}</output>
    <ConfigProvider
      components={{
        EventActions,
        RichCommentComposer: editorType === "rich" ? RepoRichCommentComposer : undefined,
      }}>
      <IssueThread
        issueId={rootId}
        issueKind={rootKind}
        externalRoot={threadType === "commit"
          ? {type: "I", value: rootId, kind: rootKind}
          : undefined}
        {comments}
        currentCommenter={pubkey}
        onCommentCreated={async () => {
          submissions++
        }}
        canEditComment={() => true}
        onCommentEdited={async () => {
          submissions++
        }}
        relays={["wss://reply-composer.test"]}
        {repoAddress}
        enableReplies />
    </ConfigProvider>
  </div>
</main>
