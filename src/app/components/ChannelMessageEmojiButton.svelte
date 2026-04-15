<script lang="ts">
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import {getTag, type TrustedEvent} from "@welshman/util"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import EmojiButton from "@lib/components/EmojiButton.svelte"
  import {publishReaction, canEnforceNip70} from "@app/core/commands"

  interface Props {
    url: string
    event: TrustedEvent
    relays?: string[]
    scopeH?: string
    protect?: boolean
  }

  const {url, event, relays = [], scopeH = "", protect = true}: Props = $props()

  const reactionRelays = $derived.by(() => (relays.length > 0 ? relays : [url]).filter(Boolean))

  const shouldProtect = protect ? canEnforceNip70(url) : undefined

  const scopedTags = $derived.by(() => {
    if (!scopeH || getTag("h", event.tags)?.[1] === scopeH) {
      return [] as string[][]
    }

    return [["h", scopeH]]
  })

  const onEmoji = async (emoji: NativeEmoji) =>
    publishReaction({
      event,
      relays: reactionRelays,
      content: emoji.unicode,
      tags: scopedTags,
      protect: protect ? await shouldProtect! : false,
    })
</script>

<EmojiButton onEmoji={onEmoji} class="btn join-item btn-xs">
  <Icon icon={SmileCircle} size={4} />
</EmojiButton>
