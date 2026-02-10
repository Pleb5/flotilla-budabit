<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import {pushModal} from "@app/util/modal"
  import GitAuthAdd from "@app/components/GitAuthAdd.svelte"
  import {tokens as tokensStore} from "@nostr-git/ui"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import {signer, pubkey, publishThunk} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {APP_DATA, makeEvent} from "@welshman/util"
  import {GIT_AUTH_DTAG} from "@src/lib/budabit/requests"
  import {get} from "svelte/store"
  import Git from "@assets/icons/git.svg?dataurl"
  import DangerTriangle from "@assets/icons/danger-triangle.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import Pen from "@assets/icons/pen.svg?dataurl"

  type Props = {
    tokenKey: string
  }

  interface TokenEntry {
    host: string
    token: string
  }

  const {tokenKey}: Props = $props()

  function mask(t: string) {
    return t.length <= 8 ? "••••••••" : `${t.slice(0, 4)}…${t.slice(-4)}`
  }

  // Use the store directly for reactivity
  // $tokensStore is reactive and will update when tokens are loaded

  async function del(tokenToDelete: TokenEntry) {
    const currentSigner = get(signer)
    const currentPubkey = get(pubkey)
    
    if (!currentSigner?.nip44 || !currentPubkey) {
      console.error("[GitAuth] Cannot delete token: signer or pubkey not available")
      return
    }

    // Match both host AND token to uniquely identify the token to delete
    const updatedTokens = $tokensStore.filter((t: TokenEntry) => !(t.host === tokenToDelete.host && t.token === tokenToDelete.token))
    
    try {
      // Encrypt and publish updated token list
      const dataToEncrypt = JSON.stringify(updatedTokens)
      const encrypted = await currentSigner.nip44.encrypt(currentPubkey, dataToEncrypt)
      
      const event = makeEvent(APP_DATA, {
        content: encrypted,
        tags: [["d", GIT_AUTH_DTAG]]
      })
      
      const relays = Router.get().FromUser().getUrls()
      console.log("[GitAuth] Publishing updated token list after delete to relays:", relays)
      publishThunk({event, relays})
      
      // Update the reactive store
      tokensStore.clear()
      updatedTokens.forEach(token => tokensStore.push(token))
    } catch (error) {
      console.error("[GitAuth] Failed to delete token:", error)
    }
  }

  const openDialog = () => {
    pushModal(GitAuthAdd, {tokenKey})
    // No need for polling - the reactive token store will automatically update the UI
  }

  const editToken = (token: TokenEntry) => {
    pushModal(GitAuthAdd, {tokenKey, editToken: token})
    // The reactive token store will automatically update the UI when editing is complete
  }
</script>

<div class="card2 bg-alt flex flex-col gap-6 shadow-xl">
  <div class="flex items-center justify-between">
    <strong class="flex items-center gap-3">
      <Icon icon={Git} />
      Git Authentication Tokens
    </strong>
    <Button class="btn btn-primary btn-sm" onclick={openDialog}>
      <Icon icon={AddCircle} />
      Add Token
    </Button>
  </div>

  <div class="rounded border border-warning/30 bg-warning/10 p-3 text-warning">
    <div class="flex items-start gap-2">
      <Icon icon={DangerTriangle} class="mt-0.5 text-warning" size={4} />
      <p class="text-sm leading-5">
        Tokens are sent in cleartext through the BudaBit CORS proxy, and are stored encrypted in
        browser local storage. DO NOT PUT CRITICAL ACCESS TOKENS HERE! SCOPE TOKEN PERMISSIONS TO
        REDUCE RISK.
      </p>
    </div>
  </div>

  {#if $tokensStore.length}
    <div class="w-full">
      <table class="w-full table-fixed">
        <thead>
          <tr>
            <th class="p-2 text-left w-1/3">Host</th>
            <th class="p-2 text-left w-1/3">Token</th>
            <th class="p-2 text-right w-1/3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $tokensStore as t}
            <tr class="hover:bg-neutral">
              <td class="p-2 text-left">{t.host}</td>
              <td class="p-2 text-left">{mask(t.token)}</td>
              <td class="p-2 text-right">
                <div class="flex gap-2 justify-end">
                  <Button class="btn btn-primary btn-sm" onclick={() => editToken(t)}><Icon icon={Pen} /></Button>
                  <Button class="btn btn-error btn-sm" onclick={() => del(t)}
                    ><Icon icon={TrashBin2} /></Button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {:else}
    <p class="py-12 text-center opacity-75">No tokens saved yet!</p>
  {/if}
</div>
