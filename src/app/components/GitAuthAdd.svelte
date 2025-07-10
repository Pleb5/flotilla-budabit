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
  }

  const {tokenKey}: Props = $props()

  const key = tokenKey

  const back = () => history.back()
  //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
  const disabled = $state(true)

  let host = $state("")
  let token = $state("")
  let busy = $state(false)
  let userCode = $state("")
  let verificationUri = $state("")
  let error = $state("")

  let tokens: TokenEntry[] = $state([])

  interface TokenEntry {
    host: string
    token: string
  }

  function reset() {
    host = token = verificationUri = userCode = ""
    busy = false
    error = ""
  }

  async function saveTokens(toks: TokenEntry[]) {
    try {
      const existing = localStorage.getItem(key)
      if (existing) {
        const decrypted = await $signer.nip04.decrypt($pubkey!, existing)
        if (!decrypted) return
        const parsed = JSON.parse(decrypted)
        tokens = [...parsed, ...toks]
      } else {
        tokens = toks
      }

      const encrypted = await $signer.nip04.encrypt($pubkey!, JSON.stringify(tokens))
      console.log(key)
      tokensStore.push(toks[0])
      localStorage.setItem(key, encrypted)
    } catch (e) {
      error = "Failed to save tokens: " + e
      console.error("Failed to save tokens", e)
    }
  }

  const submit = () => {
    saveTokens([...tokens, {host: host.trim(), token: token.trim()}])
    reset()
    back()
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
      Add a Git Auth Token
    {/snippet}
    {#snippet info()}
      <p>Use this form to add a Git auth token to your account.</p>
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
      <Spinner loading={busy}>Add</Spinner>
      <Icon icon="alt-arrow-right" />
    </Button>
  </ModalFooter>
</form>
