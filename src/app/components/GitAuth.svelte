<script lang="ts">
  import {onMount} from "svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import {pushModal} from "@app/modal"
  import GitAuthAdd from "@app/components/GitAuthAdd.svelte"
  import {pubkey} from "@welshman/app"
  import {signer} from "@welshman/app"

  type Props = {
    tokenKey: string
  }

  const {tokenKey}: Props = $props()

  type TokenEntry = {host: string; token: string}

  async function loadTokens(): Promise<TokenEntry[]> {
    try {
      const tok = localStorage.getItem(tokenKey)
      if (!tok) return []
      const decrypted = await $signer.nip04.decrypt($pubkey!, tok)
      if (!decrypted) return []
      return JSON.parse(decrypted)
    } catch (e) {
      console.error("Failed to load tokens", e)
      return []
    }
  }

  async function saveTokens(toks: TokenEntry[]) {
    try {
      const encrypted = await $signer.nip04.encrypt($pubkey!, JSON.stringify(toks))
      console.log(encrypted)
      localStorage.setItem(tokenKey, encrypted)
    } catch (e) {
      console.error("Failed to save tokens", e)
    }
  }

  function mask(t: string) {
    return t.length <= 8 ? "••••••••" : `${t.slice(0, 4)}…${t.slice(-4)}`
  }

  let tokens: TokenEntry[] = $state([])

  onMount(async () => (tokens = await loadTokens()))

  function del(h: string) {
    tokens = tokens.filter(t => t.host !== h)
    saveTokens(tokens)
  }

  const openDialog = () => pushModal(GitAuthAdd, {tokenKey})
</script>

<div class="card2 bg-alt flex flex-col gap-6 shadow-xl">
  <div class="flex items-center justify-between">
    <strong class="flex items-center gap-3">
      <Icon icon="git" />
      Git Authentication Tokens
    </strong>
    <Button class="btn btn-primary btn-sm" onclick={openDialog}>
      <Icon icon="add-circle" />
      Add Token
    </Button>
  </div>

  {#if tokens.length}
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
          {#each tokens as t}
            <tr class="hover:bg-neutral">
              <td class="p-2 text-left">{t.host}</td>
              <td class="p-2 text-left">{mask(t.token)}</td>
              <td class="p-2 text-right">
                <div class="flex gap-2 justify-end">
                  <Button class="btn btn-primary btn-sm"><Icon icon="pen" /></Button>
                  <Button class="btn btn-error btn-sm" onclick={() => del(t.host)}
                    ><Icon icon="trash-bin-2" /></Button>
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
