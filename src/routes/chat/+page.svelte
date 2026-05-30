<script lang="ts">
  import {page} from "$app/stores"
  import {onDestroy} from "svelte"
  import InfoCircle from "@assets/icons/info-circle.svg?dataurl"
  import Magnifier from "@assets/icons/magnifier.svg?dataurl"
  import MenuDots from "@assets/icons/menu-dots.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ContentSearch from "@lib/components/ContentSearch.svelte"
  import ChatSearchResults from "@app/components/ChatSearchResults.svelte"
  import ChatStart from "@app/components/ChatStart.svelte"
  import ChatMenu from "@app/components/ChatMenu.svelte"
  import {pushModal} from "@app/util/modal"
  import {setChecked} from "@app/util/notifications"

  let term = $state("")

  const startChat = () => pushModal(ChatStart)

  const openMenu = () => pushModal(ChatMenu)

  onDestroy(() => {
    setChecked($page.url.pathname)
  })
</script>

<div class="hidden min-h-screen md:hero">
  <div class="col-2 hero-content text-center">
    <p class="row-2 text-lg">
      <Icon icon={InfoCircle} />
      No conversation selected.
    </p>
    <p>
      Click on a conversation in the sidebar, or <Button class="link" onclick={startChat}
        >start a new one</Button
      >.
    </p>
  </div>
</div>

<ContentSearch class="md:hidden">
  {#snippet input()}
    <div class="row-2 min-w-0 flex-grow items-center">
      <label class="input input-sm input-bordered flex min-w-0 flex-grow items-center gap-2">
        <Icon icon={Magnifier} size={4} />
        <input
          bind:value={term}
          class="min-w-0 grow text-xs placeholder:text-xs"
          type="text"
          placeholder="Search conversations or people..." />
      </label>
      <Button class="btn btn-primary btn-square btn-sm shrink-0" onclick={openMenu}>
        <Icon icon={MenuDots} size={4} />
      </Button>
    </div>
  {/snippet}
  {#snippet content()}
    <div class="col-2">
      <ChatSearchResults
        {term}
        chatItemClass="bg-alt card2"
        peopleItemClass="bg-alt card2"
        showEmpty>
        {#snippet empty()}
          <div class="col-4 m-auto max-w-sm items-center py-20 text-center">
            <p>No chats found! Try starting one up.</p>
            <Button class="btn btn-primary" onclick={startChat}>
              <Icon icon={AddCircle} />
              Start a Chat
            </Button>
          </div>
        {/snippet}
      </ChatSearchResults>
    </div>
  {/snippet}
</ContentSearch>
