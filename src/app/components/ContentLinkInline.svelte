<script lang="ts">
  import {call, displayUrl} from "@welshman/lib"
  import {isRelayUrl} from "@welshman/util"
  import {preventDefault} from "@lib/html"
  import LinkRound from "@assets/icons/link-round.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import ContentLinkDetail from "@app/components/ContentLinkDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import {APP_URL} from "@app/core/state"

  const {value} = $props()

  const url = value.url.toString()
  const [href, external] = call(() => {
    if (isRelayUrl(url)) {
      return [url, true]
    }
    if ($APP_URL && url.startsWith($APP_URL)) return [url.replace($APP_URL, ""), false]

    return [url, true]
  })

  const expand = () => pushModal(ContentLinkDetail, {url}, {fullscreen: true})
</script>

{#if url.match(/\.(jpe?g|png|gif|webp)$/)}
  <!-- Use a real link so people can copy the href -->
  <a href={url} class="link-content whitespace-nowrap" onclick={preventDefault(expand)}>
    <Icon icon={LinkRound} size={3} class="inline-block" />
    {displayUrl(url)}
  </a>
{:else}
  <Link {external} {href} class="link-content whitespace-nowrap">
    <Icon icon={LinkRound} size={3} class="inline-block" />
    {displayUrl(url)}
  </Link>
{/if}
