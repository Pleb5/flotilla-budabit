<script lang="ts">
  import {
    cashuMints,
    cashuBalancesByMint,
    cashuBackupConfirmed,
    cashuSeedLocked,
    cashuSetupRequired,
    cashuSetupResolved,
    addCashuMint,
    removeCashuMint,
    confirmCashuBackup,
    getCashuMnemonic,
  } from "@app/core/cashu"
  import {
    cashuMintRecommendationState,
    cashuMintRecommendations,
    loadCashuMintRecommendations,
  } from "@app/core/cashu-mint-recommendations"
  import {createCashuBackupText, type CashuBackupData} from "@app/util/cashu-backup"
  import {downloadText} from "@lib/html"
  import CashuMintRecommendationEvidence from "@app/components/CashuMintRecommendationEvidence.svelte"
  import {
    activeUserCommunityRefs,
    communityMemberProfileListEvents,
    communityMemberReportStates,
    communityModeratorProfileListEvents,
  } from "@app/core/community-state"
  import {pubkey} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import Confirm from "@lib/components/Confirm.svelte"
  import {pushModal} from "@app/util/modal"

  let newMintUrl = $state("")
  let adding = $state(false)
  let addingMintUrl = $state("")
  let error = $state("")
  let recommendationLoadKey = $state("")
  let showAllRecommendations = $state(false)

  const mints = $derived($cashuMints)
  const balances = $derived($cashuBalancesByMint)
  const recommendations = $derived($cashuMintRecommendations)
  const recommendationState = $derived($cashuMintRecommendationState)
  const configuredWallet = $derived(
    $cashuSetupResolved && $cashuBackupConfirmed && !$cashuSetupRequired && !$cashuSeedLocked,
  )
  const profileListEvents = $derived([
    ...$communityMemberProfileListEvents,
    ...$communityModeratorProfileListEvents,
  ])
  const visibleRecommendations = $derived(
    showAllRecommendations ? recommendations : recommendations.slice(0, 5),
  )

  const getMintBalance = (mintUrl: string) => balances.get(mintUrl) ?? 0

  const getBackupText = (nextMints: string[]) => {
    const data: CashuBackupData = {mnemonic: getCashuMnemonic(), mints: nextMints}

    return createCashuBackupText(data)
  }

  const downloadUpdatedBackup = async (backupText: string) => {
    downloadText("Budabit Cashu Wallet Seed.txt", backupText)
    await confirmCashuBackup()
  }

  const confirmConfiguredMintChange = ({
    action,
    mintUrl,
    balance,
    confirm,
  }: {
    action: "add" | "remove"
    mintUrl: string
    balance: number
    confirm: () => Promise<boolean>
  }) => {
    pushModal(Confirm, {
      title: action === "add" ? "Add Trusted Mint" : "Remove Trusted Mint",
      message: `You have ${balance.toLocaleString()} sats in this mint: ${mintUrl}. Changing trusted mints changes what your Cashu backup can recover, so Budabit will download an updated backup file after this ${action}.`,
      confirmLabel: action === "add" ? "Add and download backup" : "Remove and download backup",
      confirm: async () => {
        await confirm()
        history.back()
      },
    })
  }

  const performAdd = async (url: string, source: "manual" | "recommendation") => {
    const nextMints = Array.from(new Set([...mints, url]))

    if (source === "manual") adding = true
    else addingMintUrl = url

    error = ""
    try {
      const backupText = configuredWallet ? getBackupText(nextMints) : ""
      await addCashuMint(url)
      if (configuredWallet) await downloadUpdatedBackup(backupText)
      if (source === "manual") newMintUrl = ""
      return true
    } catch (e: any) {
      error = e?.message || "Failed to add mint"
      return false
    } finally {
      if (source === "manual") adding = false
      else addingMintUrl = ""
    }
  }

  const addWithPolicy = async (url: string, source: "manual" | "recommendation") => {
    if (!configuredWallet) {
      await performAdd(url, source)
      return
    }

    confirmConfiguredMintChange({
      action: "add",
      mintUrl: url,
      balance: getMintBalance(url),
      confirm: () => performAdd(url, source),
    })
  }

  const performRemove = async (url: string) => {
    const nextMints = mints.filter(mint => mint !== url)
    if (configuredWallet && nextMints.length === 0) {
      error = "Add another trusted mint before removing this one."
      return false
    }

    error = ""
    try {
      const backupText = configuredWallet ? getBackupText(nextMints) : ""
      await removeCashuMint(url)
      if (configuredWallet) await downloadUpdatedBackup(backupText)
      return true
    } catch (e: any) {
      error = e?.message || "Failed to remove mint"
      return false
    }
  }

  const removeWithPolicy = async (url: string) => {
    if (!configuredWallet) {
      await performRemove(url)
      return
    }

    if (mints.length <= 1) {
      error = "Add another trusted mint before removing this one."
      return
    }

    confirmConfiguredMintChange({
      action: "remove",
      mintUrl: url,
      balance: getMintBalance(url),
      confirm: () => performRemove(url),
    })
  }

  const add = async () => {
    const url = newMintUrl.trim()
    if (!url) return
    try {
      new URL(url)
    } catch {
      error = "Invalid URL"
      return
    }

    await addWithPolicy(url, "manual")
  }

  const remove = async (url: string) => {
    await removeWithPolicy(url)
  }

  const addRecommended = async (url: string) => {
    await addWithPolicy(url, "recommendation")
  }

  $effect(() => {
    const key = JSON.stringify({
      pubkey: $pubkey || "",
      mints,
      communities: $activeUserCommunityRefs.map(
        ref => `${ref.communityPubkey}:${ref.definition.event.id}`,
      ),
      profileLists: profileListEvents.map(event => `${event.id}:${event.created_at}`),
      reports: Array.from($communityMemberReportStates.entries()).map(([community, state]) => [
        community,
        state.personReports.length,
        state.eventReports.length,
      ]),
    })

    if (key === recommendationLoadKey) return

    recommendationLoadKey = key
    loadCashuMintRecommendations({
      trustedMints: mints,
      communityRefs: $activeUserCommunityRefs,
      profileListEvents,
      reportStates: $communityMemberReportStates,
    }).catch(() => undefined)
  })
</script>

<div class="flex min-w-0 flex-col gap-4">
  {#if mints.length === 0}
    <div
      class="flex flex-col gap-2 rounded-lg border border-base-300 p-3 text-sm opacity-75 sm:p-4">
      <p>No mints added yet.</p>
      <p class="text-xs">
        Choose a recommendation below or add a mint URL manually. Only add mints you are willing to
        trust with ecash.
      </p>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      {#each mints as mint (mint)}
        <div
          class="card2 bg-alt flex min-w-0 flex-col items-start gap-2 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div class="flex min-w-0 flex-col gap-0.5 overflow-hidden">
            <span class="max-w-full break-all font-mono text-xs sm:truncate">{mint}</span>
            <span class="text-xs opacity-60">
              {(balances.get(mint) ?? 0).toLocaleString()} sats
            </span>
          </div>
          <Button
            class="btn btn-ghost btn-xs inline-flex w-full justify-center text-error sm:w-auto"
            onclick={() => remove(mint)}
            disabled={configuredWallet && mints.length <= 1}>✕</Button>
        </div>
      {/each}
      {#if configuredWallet && mints.length === 1}
        <p class="text-xs opacity-70">Add another trusted mint before removing this one.</p>
      {/if}
    </div>
  {/if}

  <div class="flex flex-col gap-2">
    <div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <p class="text-sm font-medium">Recommended mints</p>
      <p class="text-xs opacity-60">
        {#if recommendationState.status === "loading"}
          Checking your communities and mint lists…
        {:else if recommendationState.status === "error"}
          Could not load recommendations.
        {:else if recommendationState.recommendationCount > 0}
          {recommendationState.recommendationCount} found
        {:else}
          None found yet
        {/if}
      </p>
    </div>

    {#if visibleRecommendations.length > 0}
      <div class="flex flex-col gap-2">
        {#each visibleRecommendations as recommendation (recommendation.mintUrl)}
          <div
            class="card2 bg-alt flex min-w-0 flex-col gap-3 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
            <div class="flex min-w-0 flex-1 flex-col gap-1">
              <span class="max-w-full break-all font-mono text-xs sm:truncate">
                {recommendation.mintUrl}
              </span>
              <CashuMintRecommendationEvidence {recommendation} />
            </div>
            <Button
              class="btn btn-neutral btn-xs inline-flex w-full justify-center sm:w-auto"
              onclick={() => addRecommended(recommendation.mintUrl)}
              disabled={Boolean(addingMintUrl)}>
              {addingMintUrl === recommendation.mintUrl ? "Adding…" : "+ Add"}
            </Button>
          </div>
        {/each}
      </div>
      {#if recommendations.length > 5}
        <Button
          class="btn btn-ghost btn-xs inline-flex w-full justify-center"
          onclick={() => (showAllRecommendations = !showAllRecommendations)}>
          {showAllRecommendations ? "Show top 5" : `Show all ${recommendations.length}`}
        </Button>
      {/if}
    {:else if recommendationState.status === "ready"}
      <p class="rounded-box bg-base-200/50 p-3 text-xs opacity-70">
        No community or nutzap mint recommendations were found. You can still add a mint URL
        manually.
      </p>
    {/if}
  </div>

  <div class="flex flex-col gap-2 sm:flex-row">
    <input
      class="input input-bordered min-h-12 min-w-0 flex-1 font-mono text-sm"
      type="url"
      placeholder="https://mint.example.com"
      bind:value={newMintUrl}
      onkeydown={e => e.key === "Enter" && add()} />
    <Button
      class="btn btn-primary min-h-12 inline-flex w-full justify-center sm:w-auto"
      onclick={add}
      disabled={adding || !newMintUrl.trim()}>
      {adding ? "Adding…" : "+ Add"}
    </Button>
  </div>

  {#if error}
    <p class="text-xs text-error">{error}</p>
  {/if}
</div>
