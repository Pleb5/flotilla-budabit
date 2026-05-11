<script lang="ts">
  import {goto} from "$app/navigation"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import {PLATFORM_NAME} from "@app/core/state"
  import {makeSpacePath} from "@src/app/util/routes"
  import * as appState from "@app/core/state"

  const openPlatformRelay = () => goto(makeSpacePath(appState.PLATFORM_RELAYS[0]))
  const openChat = () => goto("/chat")
</script>

<div class="hero min-h-screen overflow-auto pb-8">
  <div class="hero-content">
    <div class="column content gap-4">
      <h1 class="text-center text-5xl">Welcome to</h1>
      <h1 class="mb-4 text-center text-5xl font-bold uppercase">{PLATFORM_NAME}</h1>
      <div class="col-3">
        {#if appState.PLATFORM_RELAYS.length === 0}
          <CardButton class="btn-neutral">
            {#snippet title()}
              <div>No platform relay configured</div>
            {/snippet}
            {#snippet info()}
              <div>Budabit needs a platform relay before workspace features are available.</div>
            {/snippet}
          </CardButton>
        {:else}
          <Button onclick={openPlatformRelay}>
            <CardButton class="btn-primary">
              {#snippet icon()}
                <Icon icon={HomeSmile} size={7} />
              {/snippet}
              {#snippet title()}
                <div>Open platform relay</div>
              {/snippet}
              {#snippet info()}
                <div>Go to your configured Budabit relay.</div>
              {/snippet}
            </CardButton>
          </Button>
        {/if}
        <Button onclick={openChat}>
          <CardButton class="btn-neutral">
            {#snippet icon()}
              <Icon icon={ChatRound} size={7} />
            {/snippet}
            {#snippet title()}
              <div>Start a conversation</div>
            {/snippet}
            {#snippet info()}
              <div>Use nostr's encrypted direct messages to stay in touch.</div>
            {/snippet}
          </CardButton>
        </Button>
      </div>
    </div>
  </div>
</div>
