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
  import SecondaryNavHeader from "@lib/components/SecondaryNavHeader.svelte"
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
  let searchTerm = $state("")

  const promise = sleep(10000)

  $effect(() => {
    const value = term
    const timeout = setTimeout(() => {
      searchTerm = value
    }, 200)

    return () => clearTimeout(timeout)
  })

  onMount(() => {
    document.body.classList.add("chat-md-sidebar")

    return () => {
      document.body.classList.remove("chat-md-sidebar")
    }
  })
</script>

<SecondaryNav visibleClass="md:flex">
  <SecondaryNavSection>
    <SecondaryNavHeader>
      Recent Conversations
      <Button onclick={openMenu}>
        <Icon icon={MenuDots} />
      </Button>
    </SecondaryNavHeader>
  </SecondaryNavSection>
  <label class="input input-sm input-bordered mx-6 -mt-4 mb-2 flex items-center gap-2">
    <Icon icon={Magnifier} />
    <input
      bind:value={term}
      class="grow"
      type="text"
      placeholder="Search conversations or people..." />
  </label>
  <div class="overflow-auto">
    <ChatSearchResults term={searchTerm} loadingPromise={promise} />
  </div>
</SecondaryNav>
<Page>
  {#key $page.url.pathname}
    {@render children?.()}
  {/key}
</Page>
