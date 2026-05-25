<script lang="ts">
  import {getNip07} from "@welshman/signer"
  import {addSession, type Session, makeNip07Session} from "@welshman/app"
  import Widget from "@assets/icons/widget-2.svg?dataurl"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import Cpu from "@assets/icons/cpu-bolt.svg?dataurl"
  import Compass from "@assets/icons/compass-big.svg?dataurl"
  import ShieldWarning from "@assets/icons/shield-warning.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import SignUp from "@app/components/SignUp.svelte"
  import InfoNostr from "@app/components/InfoNostr.svelte"
  import LogInBunker from "@app/components/LogInBunker.svelte"
  import LogInLocalKey from "@app/components/LogInLocalKey.svelte"
  import LogInLocalKeyUnlock from "@app/components/LogInLocalKeyUnlock.svelte"
  import LogInPassword from "@app/components/LogInPassword.svelte"
  import {lockedLocalKeySessions} from "@app/core/session-storage"
  import {pushModal, clearModals} from "@app/util/modal"
  import {BURROW_URL} from "@app/core/state"
  import {pushToast} from "@app/util/toast"
  import {setChecked} from "@app/util/notifications"
  import {formatShortNpub} from "@app/util/pubkeys"

  let loading: string | undefined = $state()

  const disabled = $derived(loading ? true : undefined)

  const signUp = () => pushModal(SignUp)

  const onSuccess = async (session: Session) => {
    addSession(session)
    pushToast({message: "Successfully logged in!"})
    setChecked("*")
    clearModals()
  }

  const loginWithNip07 = async () => {
    loading = "nip07"

    try {
      const pubkey = await getNip07()?.getPublicKey()

      if (pubkey) {
        await onSuccess(makeNip07Session(pubkey))
      } else {
        pushToast({
          theme: "error",
          message: "Something went wrong! Please try again.",
        })
      }
    } finally {
      loading = undefined
    }
  }

  const loginWithPassword = () => pushModal(LogInPassword)

  const loginWithBunker = () => pushModal(LogInBunker)

  const loginWithLocalKey = () => pushModal(LogInLocalKey)

  const unlockLocalKey = (pubkey: string) => pushModal(LogInLocalKeyUnlock, {pubkey})

  const hasSigner = $derived(Boolean(getNip07()))
  const lockedLocalKeys = $derived(Object.values($lockedLocalKeySessions))
</script>

<div class="column gap-4" data-testid="login-modal">
  <h1 class="heading">Log in with Nostr</h1>
  <p class="m-auto max-w-sm text-center">
    This app is built using the
    <Button class="link" onclick={() => pushModal(InfoNostr)}>nostr protocol</Button>, which allows
    you to own your social identity.
  </p>
  {#if lockedLocalKeys.length > 0}
    <div class="rounded-box border border-primary/30 bg-primary/10 p-3 text-left text-sm">
      <p class="font-semibold">Encrypted local key saved on this device</p>
      <p class="mt-1 opacity-75">Unlock it with your passphrase to continue.</p>
      <div class="mt-3 flex flex-col gap-2">
        {#each lockedLocalKeys as lockedLocalKey (lockedLocalKey.pubkey)}
          <Button class="btn btn-primary" onclick={() => unlockLocalKey(lockedLocalKey.pubkey)}>
            <Icon icon={Key} />
            Unlock {formatShortNpub(lockedLocalKey.pubkey) || "local key"}
          </Button>
        {/each}
      </div>
    </div>
  {/if}
  {#if getNip07()}
    <Button {disabled} onclick={loginWithNip07} class="btn btn-primary">
      {#if loading === "nip07"}
        <span class="loading loading-spinner mr-3"></span>
      {:else}
        <Icon icon={Widget} />
      {/if}
      Log in with Extension
    </Button>
  {/if}
  {#if BURROW_URL && !hasSigner}
    <Button {disabled} onclick={loginWithPassword} class="btn btn-primary">
      {#if loading === "password"}
        <span class="loading loading-spinner mr-3"></span>
      {:else}
        <Icon icon={Key} />
      {/if}
      Log in with Password
    </Button>
  {/if}
  <Button
    onclick={loginWithBunker}
    {disabled}
    data-testid="login-option-bunker"
    class="btn {hasSigner || BURROW_URL ? 'btn-neutral' : 'btn-primary'}">
    <Icon icon={Cpu} />
    Log in with Remote Signer
  </Button>
  {#if BURROW_URL && hasSigner}
    <Button {disabled} onclick={loginWithPassword} class="btn">
      {#if loading === "password"}
        <span class="loading loading-spinner mr-3"></span>
      {:else}
        <Icon icon={Key} />
      {/if}
      Log in with Password
    </Button>
  {/if}
  <Button
    onclick={loginWithLocalKey}
    {disabled}
    data-testid="login-option-local-key"
    class="btn btn-outline grid grid-cols-[1fr_auto_1fr] border-warning/50 bg-warning/10 text-base-content hover:border-warning hover:bg-warning/20">
    <span></span>
    <span class="flex items-center gap-2 justify-self-center">
      <Icon icon={ShieldWarning} />
      Local key
    </span>
    <span class="badge badge-warning badge-outline justify-self-end text-xs font-semibold"
      >least secure</span>
  </Button>
  {#if !hasSigner || !BURROW_URL}
    <Link
      external
      {disabled}
      href="https://nostrapps.com#signers"
      class="btn {hasSigner || BURROW_URL ? '' : 'btn-neutral'}">
      <Icon icon={Compass} />
      Browse Signer Apps
    </Link>
  {/if}
  <div class="text-sm">
    Need an account?
    <Button class="link" onclick={signUp}>Register instead</Button>
  </div>
</div>
