<script lang="ts">
  import type {Snippet} from "svelte"
  import {onMount} from "svelte"
  import {page} from "$app/stores"
  import {sleep} from "@welshman/lib"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import Button from "@lib/components/Button.svelte"
  import SecondaryNav from "@lib/components/SecondaryNav.svelte"
  import SecondaryNavSection from "@lib/components/SecondaryNavSection.svelte"
  import ChatMenu from "@app/components/ChatMenu.svelte"
  import ChatSearchResults from "@app/components/ChatSearchResults.svelte"
  import {pushModal} from "@app/util/modal"

  type Props = {
    children?: Snippet
  }

  const {children}: Props = $props()

  const openMenu = () => pushModal(ChatMenu)

  let term = $state("")

  const promise = sleep(10000)

  onMount(() => {
    document.body.classList.add("chat-md-sidebar")

    return () => {
      document.body.classList.remove("chat-md-sidebar")
    }
  })
</script>

<SecondaryNav visibleClass="md:flex">
  <SecondaryNavSection>
    <div class="flex items-center gap-3 px-4 py-2">
      <span class="shrink-0 whitespace-nowrap text-xs font-bold uppercase tracking-wide">
        Recent Conversations
      </span>
      <Button class="btn btn-primary btn-square h-7 min-h-7 w-7 shrink-0 p-0" onclick={openMenu}>
        <Icon icon={MenuDots} size={3} />
      </Button>
    </div>
  </SecondaryNavSection>
  <label class="input input-sm input-bordered mx-4 -mt-4 mb-2 flex min-w-0 items-center gap-2">
    <Icon icon={Magnifier} size={4} />
    <input
      bind:value={term}
      class="min-w-0 grow text-[11px] placeholder:text-[11px]"
      type="text"
      placeholder="Search chats or people..." />
  </label>
  <div class="overflow-auto">
    <ChatSearchResults {term} loadingPromise={promise} />
  </div>
</SecondaryNav>
<Page>
  {#key $page.url.pathname}
    {@render children?.()}
  {/key}
</Page>
