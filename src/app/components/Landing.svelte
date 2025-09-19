<script lang="ts">
  import Login from "@assets/icons/login-3.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import Dialog from "@lib/components/Dialog.svelte"
  import CardButton from "@lib/components/CardButton.svelte"
  import LogIn from "@app/components/LogIn.svelte"
  import SignUp from "@app/components/SignUp.svelte"
  import {PLATFORM_TERMS, PLATFORM_PRIVACY, PLATFORM_NAME} from "@app/core/state"
  import {pushModal} from "@app/util/modal"

  const logIn = () => pushModal(LogIn)

  const signUp = () => pushModal(SignUp)
</script>

<Dialog>
  <div class="column gap-4">
    <div class="py-2">
      <h1 class="heading">Welcome to {PLATFORM_NAME}!</h1>
      <p class="text-center">A Club for Builders in Freedom Tech</p>
    </div>
    <Button onclick={logIn}>
      <CardButton class="btn-primary">
        {#snippet icon()}
          <div><Icon icon={Login} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Log in</div>
        {/snippet}
        {#snippet info()}
          <div>If you've been here before, you know the drill.</div>
        {/snippet}
      </CardButton>
    </Button>
    <Button onclick={signUp} class="dark:btn-neutral">
      <CardButton>
        {#snippet icon()}
          <div><Icon icon={AddCircle} size={7} /></div>
        {/snippet}
        {#snippet title()}
          <div>Create an account</div>
        {/snippet}
        {#snippet info()}
          <div>Just a few questions and you'll be on your way.</div>
        {/snippet}
      </CardButton>
    </Button>
    <p class="text-center underline">
      By using {PLATFORM_NAME}, you consent to the rules of the club:
    </p>
    <ul class="list-decimal p-4 pt-0">
      <li>No shitcoinery and other scammy/spammy behavior will be tolerated</li>
      <li>Keep it relevant and focused: Inspire and get inspired. Be a signal rather than noise</li>
    </ul>
  </div>
</Dialog>
