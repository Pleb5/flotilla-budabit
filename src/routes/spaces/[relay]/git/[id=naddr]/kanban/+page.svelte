<script lang="ts">
  import {Card} from "@nostr-git/ui"
  import KanbanPanel from "../KanbanPanel.svelte"
  import {pubkey} from "@welshman/app"
  import {Router} from "@welshman/router"
  import {getContext} from "svelte"
  import {REPO_KEY, REPO_RELAYS_KEY, GIT_RELAYS} from "@lib/budabit/state"
  import {extensionSettings} from "@app/extensions/settings"
  import type {Readable} from "svelte/store"
  import type {Repo} from "@nostr-git/ui"
  import {page} from "$app/stores"
  import {goto} from "$app/navigation"
  import Button from "@lib/components/Button.svelte"

  const KANBAN_EXTENSION_ID = "budabit-kanban"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoRelaysStore = getContext<Readable<string[]>>(REPO_RELAYS_KEY)

  const naddr = $page.params.id
  
  // Combine repo relays with user's relays and GIT_RELAYS for better coverage
  const repoRelays = $derived.by(() => {
    const repoR = repoRelaysStore ? $repoRelaysStore : []
    // Get user's relays from the router
    const router = Router.get()
    const userRelays = router.FromUser().getUrls()
    // Combine and dedupe: repo relays + user relays + GIT_RELAYS
    const combined = [...repoR, ...userRelays, ...GIT_RELAYS]
    return [...new Set(combined)]
  })

  // Check if extension is installed and enabled
  const isInstalled = $derived.by(() => {
    const installed = $extensionSettings.installed
    return !!(installed.nip89[KANBAN_EXTENSION_ID] ?? installed.widget[KANBAN_EXTENSION_ID])
  })
  const isEnabled = $derived.by(() => $extensionSettings.enabled.includes(KANBAN_EXTENSION_ID))

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const goToExtensions = () => goto("/settings/extensions")
</script>

<div class="flex flex-col gap-4">
  <h1 class="text-2xl font-bold">Kanban Board</h1>
  
  {#if !isInstalled}
    <Card class="p-6">
      <div class="flex flex-col items-center gap-4 text-center">
        <h2 class="text-lg font-semibold">Kanban Extension Not Installed</h2>
        <p class="text-muted-foreground">
          The Repo Kanban extension needs to be installed to use this feature.
        </p>
        <Button class="btn btn-primary" onclick={goToExtensions}>
          Go to Extension Settings
        </Button>
      </div>
    </Card>
  {:else if !isEnabled}
    <Card class="p-6">
      <div class="flex flex-col items-center gap-4 text-center">
        <h2 class="text-lg font-semibold">Kanban Extension Disabled</h2>
        <p class="text-muted-foreground">
          The Repo Kanban extension is installed but not enabled.
        </p>
        <Button class="btn btn-primary" onclick={goToExtensions}>
          Enable in Extension Settings
        </Button>
      </div>
    </Card>
  {:else if repoClass.repoEvent?.pubkey && repoClass.name}
    <Card class="p-0 overflow-hidden">
      <KanbanPanel
        repoPubkey={repoClass.repoEvent.pubkey}
        repoName={repoClass.name}
        repoNaddr={naddr}
        repoRelays={repoRelays}
        maintainers={repoClass.maintainers ?? []}
        userPubkey={$pubkey}
      />
    </Card>
  {:else}
    <div class="p-4 text-center text-muted-foreground">
      Loading repository context...
    </div>
  {/if}
</div>
