<script lang="ts">
  import {LOCALE} from "@welshman/lib"
  import {displayRelayUrl, isNWCWallet, fromMsats} from "@welshman/util"
  import {session, pubkey, profilesByPubkey} from "@welshman/app"
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import WalletPay from "@app/components/WalletPay.svelte"
  import WalletConnect from "@app/components/WalletConnect.svelte"
  import WalletDisconnect from "@app/components/WalletDisconnect.svelte"
  import WalletUpdateReceivingAddress from "@app/components/WalletUpdateReceivingAddress.svelte"
  import {pushModal} from "@app/util/modal"
  import {getWebLn} from "@app/core/commands"
  import {getNwcBalance} from "@app/core/nwc"
  import Wallet2 from "@assets/icons/wallet.svg?dataurl"
  import CheckCircle from "@assets/icons/check-circle.svg?dataurl"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"
  import InfoCircle from "@assets/icons/info-circle.svg?dataurl"
  import {
    cashuTotalBalance,
    cashuBackupConfirmed,
    cashuSeedEncrypted,
    cashuSeedLocked,
    cashuSetupRequired,
    cashuSetupResolved,
    cashuAutoPayWhitelist,
    removeAutoPayWhitelist,
    recoverAllTrustedMints,
  } from "@app/core/cashu"
  import {formatCashuSats} from "@app/util/cashu-format"
  import CashuMintManager from "@app/components/CashuMintManager.svelte"
  import CashuSeedBackup from "@app/components/CashuSeedBackup.svelte"
  import CashuWalletModal from "@app/components/CashuWalletModal.svelte"

  type WalletTab = "cashu" | "lightning"
  type CashuTab = "wallet" | "settings"

  const tabs: {id: WalletTab; label: string}[] = [
    {id: "cashu", label: "Cashu"},
    {id: "lightning", label: "Lightning"},
  ]
  const cashuTabs: {id: CashuTab; label: string}[] = [
    {id: "wallet", label: "Wallet"},
    {id: "settings", label: "Settings"},
  ]

  const connect = () => pushModal(WalletConnect)

  const disconnect = () => pushModal(WalletDisconnect)

  const updateReceivingAddress = () => pushModal(WalletUpdateReceivingAddress)

  const profile = $derived($profilesByPubkey.get($pubkey || ""))
  const profileLightningAddress = $derived(profile?.lud16)
  const walletLud16 = $derived(
    $session?.wallet && isNWCWallet($session.wallet) ? $session.wallet.info.lud16 : undefined,
  )

  const pay = () => pushModal(WalletPay)

  const cashuBalance = $derived($cashuTotalBalance)
  const backupConfirmed = $derived($cashuBackupConfirmed)
  const seedEncrypted = $derived($cashuSeedEncrypted)
  const seedLocked = $derived($cashuSeedLocked)
  const setupRequired = $derived($cashuSetupRequired)
  const setupResolved = $derived($cashuSetupResolved)
  const cashuReady = $derived(setupResolved && backupConfirmed && !setupRequired && !seedLocked)
  const autoPayWhitelist = $derived($cashuAutoPayWhitelist)

  const openBackup = () => pushModal(CashuSeedBackup, {mode: "backup"})
  const openRestore = () => pushModal(CashuSeedBackup, {mode: "restore"})
  const startCashuSetup = () => {
    activeCashuTab = "wallet"
    showCashuSetup = true
  }

  let recovering = $state(false)
  let activeTab = $state<WalletTab>("cashu")
  let activeCashuTab = $state<CashuTab>("wallet")
  let showCashuSetup = $state(false)
  let recoverResult = $state<
    | {succeeded: string[]; failed: {mintUrl: string; error: string}[]}
    | {topLevelError: string}
    | null
  >(null)

  const runRecovery = async () => {
    recovering = true
    recoverResult = null
    try {
      recoverResult = await recoverAllTrustedMints()
    } catch (e: any) {
      recoverResult = {topLevelError: e?.message || "Recovery failed"}
    } finally {
      recovering = false
    }
  }
</script>

<div class="content column gap-4 overflow-x-hidden">
  <div class="tabs-boxed tabs w-fit max-w-full overflow-x-auto">
    {#each tabs as tab}
      <button
        type="button"
        class="tab"
        class:tab-active={activeTab === tab.id}
        onclick={() => (activeTab = tab.id)}>
        {tab.label}
      </button>
    {/each}
  </div>

  {#if activeTab === "cashu"}
    <div class="card2 bg-alt flex min-w-0 flex-col gap-6 shadow-md">
      <div class="flex flex-col items-center gap-2 text-center">
        <strong class="flex items-center justify-center gap-3 text-xl">
          <span class="text-2xl text-warning">₿</span>
          Cashu Wallet
        </strong>
        {#if cashuReady}
          <span class="font-mono text-2xl font-bold"
            >{formatCashuSats(cashuBalance)} sats</span>
        {:else if setupResolved && seedLocked}
          <span class="text-base font-semibold text-warning">Locked</span>
        {:else if setupResolved && !setupRequired}
          <span class="text-base font-semibold text-warning">Backup needed</span>
        {:else if setupResolved}
          <span class="text-base font-semibold text-warning">Not set up</span>
        {/if}
      </div>

      <div class="tabs tabs-bordered grid w-full grid-cols-2 overflow-hidden">
        {#each cashuTabs as tab}
          <button
            type="button"
            class="tab w-full text-base font-medium"
            class:tab-active={activeCashuTab === tab.id}
            onclick={() => (activeCashuTab = tab.id)}>
            {tab.label}
          </button>
        {/each}
      </div>

      {#if activeCashuTab === "wallet"}
        {#if !setupResolved}
          <div class="flex min-h-[220px] items-center justify-center text-sm opacity-70">
            Loading Cashu wallet…
          </div>
        {:else if setupRequired && !showCashuSetup}
          <div
            class="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-box border border-base-300 bg-base-200/40 p-4 text-center">
            <p class="max-w-md text-sm opacity-75">
              Create a Cashu wallet before sending, receiving, or managing ecash.
            </p>
            <Button class="btn btn-primary btn-sm inline-flex justify-center" onclick={startCashuSetup}>
              Create wallet
            </Button>
          </div>
        {:else if setupRequired}
          <CashuSeedBackup mode="setup" />
        {:else if !cashuReady}
          <CashuSeedBackup mode={seedLocked ? "unlock" : "backup"} />
        {:else}
          <CashuWalletModal showHeader={false} showMintsTab={false} />
        {/if}
      {:else}
        {#if !setupResolved}
          <div class="flex min-h-[220px] items-center justify-center text-sm opacity-70">
            Loading Cashu wallet…
          </div>
        {:else if setupRequired}
          <div
            class="flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-box border border-base-300 bg-base-200/40 p-4 text-center">
            <p class="max-w-md text-sm opacity-75">
              Create a Cashu wallet before configuring wallet settings.
            </p>
            <Button class="btn btn-primary btn-sm inline-flex justify-center" onclick={startCashuSetup}>
              Create wallet
            </Button>
          </div>
        {:else if !cashuReady}
          <CashuSeedBackup mode={seedLocked ? "unlock" : "backup"} />
        {:else}
          <div class="flex flex-col gap-4">
            <div>
              <p class="mb-2 text-sm font-medium">Mints</p>
              <CashuMintManager />
            </div>

            <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span class="text-sm font-medium">Seed Phrase</span>
              <div class="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
                {#if seedEncrypted}
                  <div class="flex items-center gap-2 text-sm text-success">
                    <Icon icon={CheckCircle} size={4} />
                    Encrypted
                  </div>
                {:else}
                  <div class="flex items-center gap-2 text-sm text-success">
                    <Icon icon={CheckCircle} size={4} />
                    Backed up
                  </div>
                {/if}
                <Button class="btn btn-neutral btn-xs inline-flex justify-center" onclick={openBackup}
                  >Backup</Button>
                <Button
                  class="btn btn-neutral btn-xs inline-flex justify-center"
                  onclick={openRestore}>Restore</Button>
              </div>
            </div>

            {#if autoPayWhitelist.length > 0}
              <div class="flex flex-col gap-2">
                <p class="text-sm font-medium">Auto-pay whitelist</p>
                {#each autoPayWhitelist as extId (extId)}
                  <div
                    class="flex flex-col gap-2 text-sm sm:flex-row sm:items-center sm:justify-between">
                    <span class="min-w-0 break-all font-mono text-xs">{extId}</span>
                    <Button
                      class="btn btn-ghost btn-xs inline-flex w-full justify-center text-error sm:w-auto"
                      onclick={() => removeAutoPayWhitelist(extId)}>
                      Revoke
                    </Button>
                  </div>
                {/each}
              </div>
            {/if}

            <details class="rounded-md border border-base-300 bg-base-200/40">
              <summary class="cursor-pointer select-none px-3 py-2 text-sm font-medium">
                Advanced
              </summary>
              <div class="flex flex-col gap-3 border-t border-base-300 px-3 py-3 text-sm">
                <div>
                  <p class="font-medium">Recover wallet</p>
                  <p class="text-xs opacity-70">
                    Cancels stuck receive operations and asks every trusted mint for any proofs the
                    wallet may have missed. Use after token redeems fail with "outputs already signed"
                    or after restoring from a seed backup.
                  </p>
                </div>
                <Button
                  class="btn btn-warning btn-sm inline-flex w-full justify-center sm:w-auto sm:self-start"
                  onclick={runRecovery}
                  disabled={recovering}>
                  {recovering ? "Recovering…" : "Recover from all trusted mints"}
                </Button>
                {#if recoverResult}
                  {#if "topLevelError" in recoverResult}
                    <p class="text-xs text-error">{recoverResult.topLevelError}</p>
                  {:else}
                    <div class="flex flex-col gap-1 text-xs">
                      {#if recoverResult.succeeded.length > 0}
                        <p class="text-success">
                          Recovered {recoverResult.succeeded.length} mint{recoverResult.succeeded
                            .length === 1
                            ? ""
                            : "s"}.
                        </p>
                      {/if}
                      {#if recoverResult.failed.length > 0}
                        <div class="flex flex-col gap-1">
                          <p class="text-error">
                            {recoverResult.failed.length} mint{recoverResult.failed.length === 1
                              ? ""
                              : "s"} failed:
                          </p>
                          {#each recoverResult.failed as f (f.mintUrl)}
                            <p class="break-all opacity-80">
                              <span class="font-mono">{f.mintUrl}</span>: {f.error}
                            </p>
                          {/each}
                        </div>
                      {/if}
                      {#if recoverResult.succeeded.length === 0 && recoverResult.failed.length === 0}
                        <p class="opacity-70">No trusted mints to recover.</p>
                      {/if}
                    </div>
                  {/if}
                {/if}
              </div>
            </details>
          </div>
        {/if}
      {/if}
    </div>
  {:else}
    <div class="card2 bg-alt flex min-w-0 flex-col gap-6 shadow-md">
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <strong class="flex min-w-0 items-center gap-3">
          <Icon icon={Wallet2} />
          Wallet
        </strong>
        {#if $session?.wallet}
          <div class="flex items-center gap-2 text-sm text-success sm:justify-end">
            <Icon icon={CheckCircle} size={4} />
            Connected
          </div>
        {:else}
          <Button
            class="btn btn-primary btn-sm inline-flex w-full items-center justify-center sm:w-auto"
            onclick={connect}>
            <Icon icon={AddCircle} />
            Connect Wallet
          </Button>
        {/if}
      </div>
      <div class="col-4">
        {#if $session?.wallet}
          {#if $session.wallet.type === "webln"}
            {@const {node, version} = $session.wallet.info}
            <div class="flex min-w-0 flex-col justify-between gap-2 lg:flex-row">
              <p class="min-w-0 break-words">
                Connected to <strong class="break-all"
                  >{node?.alias || version || "unknown wallet"}</strong>
                via <strong>{$session.wallet.type}</strong>
              </p>
              <p class="flex flex-wrap gap-2 sm:whitespace-nowrap">
                Balance:
                {#await getWebLn()
                  ?.enable()
                  .then(() => getWebLn().getBalance())}
                  <span class="loading loading-spinner loading-sm"></span>
                {:then res}
                  {new Intl.NumberFormat(LOCALE).format(res?.balance || 0)}
                {:catch}
                  [unknown]
                {/await}
                sats
              </p>
            </div>
          {:else if $session.wallet.type === "nwc"}
            {@const {lud16, relayUrl} = $session.wallet.info}
            {@const encryptionType = ($session.wallet.info as any).encryptionType}
            <div class="flex min-w-0 flex-col justify-between gap-2 lg:flex-row">
              <p class="min-w-0 break-words">
                Connected to <strong class="break-all">{lud16}</strong> via
                <strong class="break-all">{displayRelayUrl(relayUrl)}</strong>
                {#if encryptionType === "nip44_v2"}
                  using <strong>NIP-44</strong>
                {:else if encryptionType === "nip04"}
                  using <strong>NIP-04 fallback</strong>
                {/if}
              </p>
              <p class="flex flex-wrap gap-2 sm:whitespace-nowrap">
                Balance:
                {#await getNwcBalance($session.wallet.info)}
                  <span class="loading loading-spinner loading-sm"></span>
                {:then res}
                  {new Intl.NumberFormat(LOCALE).format(fromMsats(res?.balance || 0))}
                {:catch}
                  [unknown]
                {/await}
                sats
              </p>
            </div>
          {/if}
          <Button
            class="btn btn-neutral btn-sm inline-flex w-full items-center justify-center sm:w-auto"
            onclick={disconnect}>
            <Icon icon={CloseCircle} />
            Disconnect Wallet
          </Button>
        {:else}
          <p class="py-12 text-center opacity-75">No wallet connected</p>
        {/if}
      </div>
    </div>
    <div
      class="card2 bg-alt flex min-w-0 flex-col shadow-md"
      class:gap-6={profileLightningAddress && walletLud16 && profile?.lud16 !== walletLud16}>
      <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div class="flex items-center gap-2">
          <strong>Lightning Address</strong>
          <span
            class="tooltip tooltip-right inline-flex cursor-help items-center opacity-75"
            data-tip="Use this to accept bitcoin over the Lightning network.">
            <Icon icon={InfoCircle} size={4} />
          </span>
        </div>
        <div class="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center">
          <span class={profileLightningAddress ? "break-all text-sm" : "text-sm text-warning"}>
            {profileLightningAddress ? profileLightningAddress : "Not set"}
          </span>
          <Button
            class="btn btn-neutral btn-xs inline-flex w-full justify-center sm:ml-3 sm:w-auto"
            onclick={updateReceivingAddress}>Update</Button>
        </div>
      </div>
      {#if profileLightningAddress && walletLud16 && profile?.lud16 !== walletLud16}
        <div class="card2 bg-alt flex items-start gap-2 text-xs">
          <Icon icon={InfoCircle} size={4} />
          Your profile has a different lightning address than your connected wallet.
        </div>
      {/if}
    </div>
    <div class="flex justify-center py-12">
      <Button
        class="btn btn-primary inline-flex w-full items-center justify-center sm:w-auto"
        onclick={pay}>
        <Icon icon={Bolt} />
        Pay With Lightning
      </Button>
    </div>
  {/if}
</div>
