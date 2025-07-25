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
  import {pushToast} from "@app/toast"
  import {toast, tokens as tokensStore} from "@nostr-git/ui"
  import {signer, pubkey} from "@welshman/app"

  type Props = {
    tokenKey: string
    editToken?: TokenEntry
  }

  const {tokenKey, editToken}: Props = $props()

  const key = tokenKey

  const back = () => history.back()
  //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
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
    if (!$signer.nip04) {
      throw new Error("Signer does not support NIP-04 encryption")
    }
    if (!$pubkey) {
      throw new Error("Public key is not available")
    }
    
    try {
      let allTokens: TokenEntry[] = [];
      
      const existing = localStorage.getItem(key)
      
      if (existing) {
        const decrypted = await $signer.nip04.decrypt($pubkey!, existing)
        if (!decrypted) {
          throw new Error("Failed to decrypt existing tokens")
        }
        const parsed = JSON.parse(decrypted)
        
        if (editToken) {
          // Edit mode: replace the existing token with the same host
          const existingTokens = parsed.filter((t: TokenEntry) => t.host !== editToken.host)
          allTokens = [...existingTokens, ...toks]
        } else {
          // Add mode: append new tokens
          allTokens = [...parsed, ...toks]
        }
      } else {
        allTokens = toks
      }
      
      // Clean the data to ensure it's properly formatted
      const cleanTokens = allTokens.map(token => ({
        host: String(token.host).trim(),
        token: String(token.token).trim()
      }));
      
      const dataToEncrypt = JSON.stringify(cleanTokens);
      
      // Create a promise that rejects after timeout (longer for NIP-46 signers)
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('NIP-46 encryption timeout. Please try logging out and back in with your signer.')), 15000)
      })
      
      // Race the encryption against the timeout
      const encrypted = await Promise.race([
        $signer.nip04.encrypt($pubkey!, dataToEncrypt),
        timeoutPromise
      ]) as string
      
      localStorage.setItem(key, encrypted)
      
      // Update the reactive store only after successful save
      if (editToken) {
        // Edit mode: remove old token and add new one
        // First, clear and repopulate the entire store with updated tokens
        tokensStore.clear()
        cleanTokens.forEach(token => tokensStore.push(token))
      } else {
        // Add mode: just add the new token
        tokensStore.push(toks[0])
      }
      
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
      <Icon icon="alt-arrow-left" />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={busy}>
      <Spinner loading={busy}>{editToken ? 'Save Changes' : 'Add'}</Spinner>
      <Icon icon="alt-arrow-right" />
    </Button>
  </ModalFooter>
</form>
