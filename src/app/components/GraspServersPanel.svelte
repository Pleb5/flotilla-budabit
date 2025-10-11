<script lang="ts">
  import type { Readable } from "svelte/store";
  import Button from "@lib/components/Button.svelte";
  import { createGraspServersStore, toast } from "@nostr-git/ui";
  import type { GraspServersSnapshot } from "@nostr-git/ui";
  import { CirclePlus, Trash } from "@lucide/svelte";
  import type {
    EventIO,
    SignEvent,
  } from "@nostr-git/shared-types";

  const {
    io,
    signEvent,
    authorPubkey,
    onsaved,
  }: {
    io?: EventIO;
    signEvent?: SignEvent;
    authorPubkey?: string;
    onsaved?: () => void;
  } = $props();

  const store = createGraspServersStore();
  const snapshot = store.snapshot as Readable<GraspServersSnapshot>;

  let newUrl = $state("");
  let isSaving = $state(false);

  const isLoadable = Boolean(io && authorPubkey);
  const canSave = Boolean(io && signEvent && authorPubkey);

  $effect.root(() => {
    if (!isLoadable) {
      console.log('[GraspServersPanel] Not loadable - missing io or authorPubkey');
      return;
    }
    console.log('[GraspServersPanel] Loading GRASP servers...', { authorPubkey });
    store.load(io!, authorPubkey!).catch((err) => {
      console.error("[GraspServersPanel] Failed to load GRASP servers", err);
      toast.push({ title: err?.message ?? "Failed to load GRASP servers", variant: "destructive" });
    });
  });

  async function autoSave() {
    if (!canSave) {
      console.warn('[GraspServersPanel] Cannot auto-save - missing required params');
      return;
    }
    
    console.log('[GraspServersPanel] Auto-saving GRASP servers...');
    try {
      isSaving = true;
      await store.save(io!, signEvent!, authorPubkey!);
      console.log('[GraspServersPanel] Auto-save complete');
      onsaved?.();
    } catch (e: any) {
      console.error("[GraspServersPanel] Failed to auto-save GRASP servers", e);
      toast.push({ 
        title: e?.message ?? "Failed to save GRASP servers", 
        variant: "destructive" 
      });
    } finally {
      isSaving = false;
    }
  }

  async function addUrl() {
    if (!newUrl.trim()) return;
    
    console.log('[GraspServersPanel] Adding URL:', newUrl);
    store.add(newUrl);
    newUrl = "";
    await autoSave();
  }

  async function removeUrl(u: string) {
    console.log('[GraspServersPanel] Removing URL:', u);
    store.remove(u);
    await autoSave();
  }
</script>

<div class="w-full max-w-2xl p-4">
  <div class="flex items-center justify-between mb-3">
    <h3 class="text-lg font-semibold">GRASP Servers</h3>
    {#if isSaving}
      <span class="text-sm opacity-60">Saving...</span>
    {/if}
  </div>

  <div class="flex items-center gap-2 mb-3">
    <label class="w-24 text-sm opacity-80" aria-label="Add URL" for="url">Add URL</label>
    <input
      bind:value={newUrl}
      placeholder="wss://relay.ngit.dev"
      class="input input-bordered w-full"
      onkeydown={(e) => e.key === 'Enter' && addUrl()}
      disabled={isSaving}
    />
    <Button class="btn btn-primary btn-sm" onclick={addUrl} disabled={isSaving || !newUrl.trim()}>
      <CirclePlus />Add
    </Button>
  </div>
  <div class="h-px w-full bg-base-200"></div>
  <div class="w-full">
    {#if (($snapshot?.urls ?? []).length) === 0}
      <p class="py-12 text-center opacity-75">No servers added yet!</p>
    {:else}
      <table class="w-full table-fixed">
        <thead>
          <tr>
            <th class="p-2 text-left w-2/3">Server URL</th>
            <th class="p-2 text-right w-1/3">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $snapshot?.urls ?? [] as url (url)}
            <tr class="hover:bg-neutral">
              <td class="p-2 text-left">
                <span class="truncate inline-block max-w-full align-middle">{url}</span>
              </td>
              <td class="p-2 text-right">
                <div class="flex gap-2 justify-end">
                  <Button class="btn btn-error btn-sm" onclick={() => removeUrl(url)} disabled={isSaving}>
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