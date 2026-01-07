<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import {graspServersStore} from "@nostr-git/ui"
  import {CirclePlus, Trash} from "@lucide/svelte"
  import {pubkey} from "@welshman/app"
  import {createGraspServersEvent} from "@nostr-git/core/events"
  import {postGraspServersList} from "@src/lib/budabit"

  let newUrl = $state("")
  let isSaving = $state(false)

  async function publishGraspServersList() {
    isSaving = true
    try {
      const urls = $graspServersStore
      console.log("📡 Publishing GRASP servers list:", urls)

      const graspServersList = createGraspServersEvent({
        pubkey: $pubkey!,
        urls,
      })

      postGraspServersList(graspServersList)      
    } catch (error) {
      console.error("❌ Failed to publish GRASP servers list:", error)
    } finally {
      isSaving = false
    }
  }

  async function addUrl() {
    console.log("📡 Adding GRASP server:", newUrl)
    if (!newUrl.trim()) return
    graspServersStore.push(newUrl)
    newUrl = ""
    await publishGraspServersList()
  }

  async function removeUrl(u: string) {
    graspServersStore.remove(u)
    await publishGraspServersList()
  }
</script>

<div class="w-full max-w-2xl p-4">
  <div class="mb-3 flex items-center justify-between">
    <h3 class="text-lg font-semibold">GRASP Servers</h3>
    {#if isSaving}
      <span class="text-sm opacity-60">Saving...</span>
    {/if}
  </div>

  <div class="mb-3 flex items-center gap-2">
    <label class="w-24 text-sm opacity-80" aria-label="Add URL" for="url">Add URL</label>
    <input
      bind:value={newUrl}
      placeholder="wss://relay.ngit.dev"
      class="input input-bordered w-full"
      onkeydown={e => e.key === "Enter" && addUrl()}
      disabled={isSaving} />
    <Button class="btn btn-primary btn-sm" onclick={addUrl} disabled={isSaving || !newUrl.trim()}>
      <CirclePlus />Add
    </Button>
  </div>
  <div class="h-px w-full bg-base-200"></div>
  <div class="w-full">
    {#if ($graspServersStore?.length ?? 0) === 0}
      <p class="py-12 text-center opacity-75">No servers added yet!</p>
    {:else}
      <table class="w-full table-fixed">
        <thead>
          <tr>
            <th class="w-2/3 p-2 text-left">Server URL</th>
            <th class="w-1/3 p-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $graspServersStore as url (url)}
            <tr class="hover:bg-neutral">
              <td class="p-2 text-left">
                <span class="inline-block max-w-full truncate align-middle">{url}</span>
              </td>
              <td class="p-2 text-right">
                <div class="flex justify-end gap-2">
                  <Button
                    class="btn btn-error btn-sm"
                    onclick={() => removeUrl(url)}
                    disabled={isSaving}>
                    <Trash />
                  </Button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    {/if}
  </div>
</div>
