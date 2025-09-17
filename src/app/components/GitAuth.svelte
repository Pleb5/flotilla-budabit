<script lang="ts">
  import {onMount} from "svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import {pushModal} from "@app/modal"
  import GitAuthAdd from "@app/components/GitAuthAdd.svelte"
  import {tokens as tokensStore} from "@nostr-git/ui"

  type Props = {
    tokenKey: string
  }

  const {tokenKey}: Props = $props()

  import {loadTokensFromStorage, saveTokensToStorage, type TokenEntry} from "$lib/utils/tokenLoader"

  async function loadTokens(): Promise<TokenEntry[]> {
    return await loadTokensFromStorage(tokenKey)
  }

  async function saveTokens(toks: TokenEntry[]) {
    await saveTokensToStorage(tokenKey, toks)
  }

  function mask(t: string) {
    return t.length <= 8 ? "••••••••" : `${t.slice(0, 4)}…${t.slice(-4)}`
  }

  // Use reactive token store instead of local state
  let tokens = $state($tokensStore)

  onMount(async () => {
    // Tokens are now loaded at app level - just ensure they're loaded
    // If tokens aren't loaded yet, wait for them
    if (tokens.length === 0) {
      try {
        const loadedTokens = await loadTokens()
        if (loadedTokens.length > 0) {
          tokensStore.clear()
          loadedTokens.forEach(token => tokensStore.push(token))
        }
      } catch (error) {
        console.warn("GitAuth: Failed to load tokens as fallback:", error)
      }
    }
  })

  // Subscribe to store changes
  $effect(() => {
    tokens = $tokensStore
  })

  function del(h: string) {
    const updatedTokens = tokens.filter(t => t.host !== h)
    saveTokens(updatedTokens)
    // Update the reactive store
    tokensStore.clear()
    updatedTokens.forEach(token => tokensStore.push(token))
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
            <th class="w-1/3 p-2 text-left">Host</th>
            <th class="w-1/3 p-2 text-left">Token</th>
            <th class="w-1/3 p-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each tokens as t}
            <tr class="hover:bg-neutral">
              <td class="p-2 text-left">{t.host}</td>
              <td class="p-2 text-left">{mask(t.token)}</td>
              <td class="p-2 text-right">
                <div class="flex justify-end gap-2">
                  <Button class="btn btn-primary btn-sm" onclick={() => editToken(t)}
                    ><Icon icon="pen" /></Button>
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
