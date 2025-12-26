<script lang="ts">
  import type {NativeEmoji} from "emoji-picker-element/shared"
  import type {TrustedEvent} from "@welshman/util"
  import SmileCircle from "@assets/icons/smile-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import EmojiButton from "@lib/components/EmojiButton.svelte"
  import {publishReaction, canEnforceNip70} from "@app/core/commands"

  interface Props {
    url: string
    event: TrustedEvent
  }

  const {url, event}: Props = $props()

  const shouldProtect = canEnforceNip70(url)

  const onEmoji = async (emoji: NativeEmoji) =>
    publishReaction({
      event,
      relays: [url],
      content: emoji.unicode,
      protect: await shouldProtect,
    })
</script>

<EmojiButton onEmoji={onEmoji} class="btn join-item btn-xs">
  <Icon icon={SmileCircle} size={4} />
</EmojiButton>
