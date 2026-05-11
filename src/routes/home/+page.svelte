<script lang="ts">
  import {goto} from "$app/navigation"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import HomeSmile from "@assets/icons/home-smile.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import {PLATFORM_NAME} from "@app/core/state"
  import Field from "@lib/components/Field.svelte"
  import {preventDefault} from "@lib/html"
  import {pushToast} from "@app/util/toast"
  import {activeCommunitySession, setActiveCommunityInput} from "@app/core/community-state"

  const openChat = () => goto("/chat")

  const selectCommunity = () => {
    const session = setActiveCommunityInput(communityInput)

    if (!session) {
      pushToast({theme: "error", message: "Enter a valid community npub, hex pubkey, or ncommunity."})
      return
    }

    communityInput = ""
    pushToast({message: "Community saved. Community routes are coming next."})
  }

  const displayCommunity = (pubkey?: string) =>
    pubkey ? `${pubkey.slice(0, 8)}...${pubkey.slice(-8)}` : "No community selected"

  let communityInput = $state("")
</script>

<div class="hero min-h-screen overflow-auto pb-8">
  <div class="hero-content">
    <div class="column content gap-4">
      <h1 class="text-center text-5xl">Welcome to</h1>
      <h1 class="mb-4 text-center text-5xl font-bold uppercase">{PLATFORM_NAME}</h1>
      <div class="col-3">
        <CardButton class="btn-neutral">
          {#snippet icon()}
            <Icon icon={HomeSmile} size={7} />
          {/snippet}
          {#snippet title()}
            <div>Selected community</div>
          {/snippet}
          {#snippet info()}
            <div>{displayCommunity($activeCommunitySession?.communityPubkey)}</div>
          {/snippet}
        </CardButton>
        <form class="card2 bg-alt col-4 p-4 shadow-md" onsubmit={preventDefault(selectCommunity)}>
          <Field>
            {#snippet label()}
              <p>Community npub, hex, or ncommunity</p>
            {/snippet}
            {#snippet input()}
              <label class="input input-bordered flex w-full items-center gap-2">
                <Icon icon={HomeSmile} />
                <input
                  bind:value={communityInput}
                  class="grow"
                  type="text"
                  placeholder="npub1... or ncommunity://..." />
              </label>
            {/snippet}
            {#snippet info()}
              This selects the community identity. Community routes are implemented in the next phase.
            {/snippet}
          </Field>
          <div class="flex justify-end">
            <Button type="submit" class="btn btn-primary" disabled={!communityInput.trim()}>
              Save community
            </Button>
          </div>
        </form>
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
