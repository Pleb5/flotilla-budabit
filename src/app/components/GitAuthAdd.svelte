<script lang="ts">
  import {preventDefault} from "@lib/html"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Divider from "@src/lib/components/Divider.svelte"
  import Field from "@src/lib/components/Field.svelte"
  import {GithubIcon} from "@lucide/svelte"
  import {pushToast} from "@app/util/toast"
  import {toast, tokens as tokensStore} from "@nostr-git/ui"
  import {signer, pubkey, publishThunk} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {APP_DATA, makeEvent} from "@welshman/util"
  import {GIT_AUTH_DTAG} from "@src/lib/budabit/requests"
  import {get} from "svelte/store"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"

  type Props = {
    tokenKey: string
    editToken?: TokenEntry
  }

  const {tokenKey, editToken}: Props = $props()

  const back = () => history.back()
  const disabled = $state(true)

  let host = $state(editToken?.host || "")
  let token = $state(editToken?.token || "")
  let busy = $state(false)
  let userCode = $state("")
  let verificationUri = $state("")
  let error = $state("")

  interface TokenEntry {
    host: string
    token: string
  }

  function reset() {
    host = token = verificationUri = userCode = ""
    busy = false
    error = ""
  }

  const saveTokens = async (toks: TokenEntry[]) => {
    // Detailed signer validation
    if (!$signer) {
      throw new Error("Signer is not available")
    }
    if (!$signer.nip44) {
      throw new Error("Signer does not support NIP-44 encryption")
    }
    if (!$pubkey) {
      throw new Error("Public key is not available")
    }
    
    try {
      // Get current tokens from store
      let currentTokens: TokenEntry[] = get(tokensStore)
      let allTokens: TokenEntry[]
      
      if (editToken) {
        // Edit mode: replace the existing token with the same host AND token
        const existingTokens = currentTokens.filter(
          (t: TokenEntry) => !(t.host === editToken.host && t.token === editToken.token)
        )
        allTokens = [...existingTokens, ...toks]
      } else {
        // Add mode: append new tokens
        allTokens = [...currentTokens, ...toks]
      }
      
      // Clean the data to ensure it's properly formatted
      const cleanTokens = allTokens.map(t => ({
        host: String(t.host).trim(),
        token: String(t.token).trim()
      }))
      
      const dataToEncrypt = JSON.stringify(cleanTokens)
      
      // Create a promise that rejects after timeout (longer for NIP-46 signers)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(
          'NIP-44 encryption timeout. Please try logging out and back in with your signer.')),
          15000)
      })
      
      // Encrypt with NIP-44 (self-encryption)
      const encrypted = await Promise.race([
        $signer.nip44.encrypt($pubkey!, dataToEncrypt),
        timeoutPromise
      ]) as string
      
      // Create and publish the event
      const event = makeEvent(APP_DATA, {
        content: encrypted,
        tags: [["d", GIT_AUTH_DTAG]]
      })
      
      // Publish to user's relays
      const relays = Router.get().FromUser().getUrls()
      console.log("[GitAuthAdd] Publishing token event to relays:", relays)
      publishThunk({event, relays})
      
      // Update the reactive store immediately for responsive UI
      tokensStore.clear()
      cleanTokens.forEach(t => tokensStore.push(t))
      
      console.log("[GitAuthAdd] Tokens saved successfully, count:", cleanTokens.length)
      
    } catch (e) {
      error = "Failed to save tokens: " + e
      throw e // Re-throw to let submit function know it failed
    }
  }

  const submit = async () => {
    // Clean the token to remove any potential console output contamination
    const cleanToken = token.split('\n')[0].trim(); // Take only the first line
    const cleanHost = host.trim();
    
    // Basic validation
    if (!cleanHost || !cleanToken) {
      error = "Both host and token are required"
      return
    }
    
    if (cleanToken.length > 200) {
      error = "Token appears to be corrupted (too long). Please refresh the page and try again."
      return
    }
    
    busy = true
    error = "" // Clear any previous errors
    
    try {
      await saveTokens([{host: cleanHost, token: cleanToken}])
      reset()
      back()
    } catch (e) {
      error = e instanceof Error ? e.message : "An error occurred while saving the token"
    } finally {
      busy = false
    }
  }

  $effect(() => {
    if ($toast.length > 0) {
      $toast.forEach(t => {
        pushToast({
          message: t.description!,
          theme: t.variant === "error" ? "error" : undefined,
        })
      })
      toast.clear()
    }
  })

  $effect(() => {
    if (error) {
      pushToast({
        theme: "error",
        message: error,
      })
    }
  })
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      {editToken ? 'Edit Git Auth Token' : 'Add a Git Auth Token'}
    {/snippet}
    {#snippet info()}
      <p>Use this form to {editToken ? 'edit your existing' : 'add a'} Git auth token.</p>
      <a href="https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/creating-a-personal-access-token" target="_blank">Learn more about personal access tokens</a>
      <a href="https://github.com/settings/tokens" target="_blank">Create a new token</a>
    {/snippet}
  </ModalHeader>

  <Divider>
    <p>Device flow</p>
  </Divider>

  <Button class="btn btn-primary" {disabled}>
    <GithubIcon />
    Device flow
  </Button>

  <Divider>
    <p>Manual token</p>
  </Divider>

  <div class="column gap-4">
    <Field>
      {#snippet label()}
        <p>Host</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <input bind:value={host} class="grow" type="text" placeholder="git.example.com" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Token</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <input
            bind:value={token}
            type="password"
            class="grow"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
        </label>
      {/snippet}
    </Field>
  </div>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={busy}>
      <Spinner loading={busy}>{editToken ? 'Save Changes' : 'Add'}</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
