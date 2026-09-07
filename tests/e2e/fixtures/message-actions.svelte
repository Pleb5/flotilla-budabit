<script lang="ts">
  import type {TrustedEvent} from "@welshman/util"
  import type {CommunityPointer} from "@app/core/community"
  import ChannelMessage from "@app/components/ChannelMessage.svelte"
  import RoomItem from "@app/components/RoomItem.svelte"
  import EventActions from "@app/components/EventActions.svelte"

  const {
    ownMessage,
    otherMessage,
    relays,
    community,
  }: {
    ownMessage: TrustedEvent
    otherMessage: TrustedEvent
    relays: string[]
    community: CommunityPointer
  } = $props()
  let selectedAction = $state("")
  const variants = [
    {name: "author", event: ownMessage, readOnly: false, editable: true},
    {name: "other", event: otherMessage, readOnly: false, editable: false},
    {name: "read-only", event: ownMessage, readOnly: true, editable: false},
  ]
</script>

<main
  class="fixed inset-0 overflow-auto bg-base-100 p-4"
  style="z-index: 6"
  data-testid="message-action-fixture">
  <div class="mx-auto flex max-w-3xl flex-col gap-6">
    <h1>Message action regression fixture</h1>
    <output data-testid="selected-action">{selectedAction}</output>
    {#each variants as variant}
      {#each [{name: "channel", Component: ChannelMessage}, {name: "room", Component: RoomItem}] as { name, Component }}
        <section data-testid={`${name}-${variant.name}`}>
          <h2>{name} / {variant.name}</h2>
          <Component
            url={relays[0]}
            {community}
            event={variant.event}
            readOnly={variant.readOnly}
            showPubkey
            interactionRelays={relays}
            actionRelays={relays}
            profileRelays={["wss://message-profiles.test"]}
            scopeH={community.communityId}
            communitySectionName="General"
            replyTo={() => (selectedAction = `Reply ${name}-${variant.name}`)}
            canEdit={() => variant.editable}
            onEdit={() => (selectedAction = `Edit ${name}-${variant.name}`)} />
        </section>
      {/each}
      <section data-testid={`comment-${variant.name}`}>
        <h2>Comment / {variant.name}</h2>
        <EventActions
          url={relays[0]}
          event={variant.event}
          {relays}
          noun="comment"
          readOnly={variant.readOnly}
          scopeH={community.communityId}
          communitySectionName="General"
          infoLabel="Message Info"
          menuOnly
          showReport={false}
          reply={() => (selectedAction = `Reply comment-${variant.name}`)}
          edit={variant.editable
            ? () => (selectedAction = `Edit comment-${variant.name}`)
            : undefined} />
      </section>
    {/each}
  </div>
</main>
