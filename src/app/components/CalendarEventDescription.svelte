<script lang="ts">
  import {getTagValue, type TrustedEvent} from "@welshman/util"
  import Markdown from "@lib/components/Markdown.svelte"

  type Props = {
    event: TrustedEvent
    url?: string
    relays?: string[]
    communitySectionName?: string
  }

  const {event, url, relays = [], communitySectionName = ""}: Props = $props()
  const content = $derived(
    event.content || getTagValue("description", event.tags) || getTagValue("summary", event.tags),
  )
</script>

{#if content}
  <div class="flex py-2 opacity-50">
    <div class="h-px flex-grow bg-base-content opacity-25"></div>
  </div>
  <Markdown {content} {event} {url} {relays} {communitySectionName} />
{/if}
