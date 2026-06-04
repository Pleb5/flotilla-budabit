<script lang="ts">
  import * as nip19 from "nostr-tools/nip19"
  import {hexToBytes} from "@welshman/lib"
  import {pubkey, session} from "@welshman/app"
  import Copy from "@assets/icons/copy.svg?dataurl"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import LinkRound from "@assets/icons/link-round.svg?dataurl"
  import UserRounded from "@assets/icons/user-rounded.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import InfoKeys from "@app/components/InfoKeys.svelte"
  import SignerStatus from "@app/components/SignerStatus.svelte"
  import {pushModal} from "@app/util/modal"
  import {clip} from "@app/util/toast"

  const npub = $derived($pubkey ? nip19.npubEncode($pubkey) : "")

  const copyNpub = () => {
    if (npub) clip(npub)
  }

  const copyNsec = () => {
    if ($session?.secret) clip(nip19.nsecEncode(hexToBytes($session.secret)))
  }

  const startEject = () => pushModal(InfoKeys)
</script>

{#if $pubkey}
  {#if $session?.email}
    <div class="card2 bg-alt col-4 shadow-md">
      <FieldInline>
        {#snippet label()}
          <p>Email Address</p>
        {/snippet}
        {#snippet input()}
          <label class="input input-bordered flex w-full items-center gap-2">
            <Icon icon={UserRounded} />
            <input readonly value={$session.email} class="grow" />
          </label>
        {/snippet}
        {#snippet info()}
          <p>
            Your email and password can only be used with this hosted login service.
            <Button class="link" onclick={startEject}>Start holding your own keys</Button>
          </p>
        {/snippet}
      </FieldInline>
    </div>
  {/if}

  <div class="card2 bg-alt col-4 shadow-md">
    <FieldInline>
      {#snippet label()}
        <p class="flex items-center gap-3">
          <Icon icon={Key} />
          Public Key
        </p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center justify-between gap-2">
          <div class="row-2 flex min-w-0 flex-grow items-center">
            <Icon icon={LinkRound} />
            <input readonly class="ellipsize flex-grow" value={npub} />
          </div>
          <Button class="flex items-center" onclick={copyNpub} aria-label="Copy public key">
            <Icon icon={Copy} />
          </Button>
        </label>
      {/snippet}
      {#snippet info()}
        <p>
          Your public key is your nostr user identifier. It also allows other people to authenticate
          your messages.
        </p>
      {/snippet}
    </FieldInline>
    {#if $session?.method === "nip01"}
      <FieldInline>
        {#snippet label()}
          <p class="flex items-center gap-3">
            <Icon icon={Key} />
            Private Key
          </p>
        {/snippet}
        {#snippet input()}
          <label class="input input-bordered flex w-full items-center gap-2">
            <Icon icon={LinkRound} />
            <input readonly value={$session.secret} class="grow" type="password" />
            <Button class="flex items-center" onclick={copyNsec} aria-label="Copy private key">
              <Icon icon={Copy} />
            </Button>
          </label>
        {/snippet}
        {#snippet info()}
          <p>Your private key is your nostr password. Keep this somewhere safe!</p>
        {/snippet}
      </FieldInline>
    {/if}
    <SignerStatus />
  </div>

{/if}
