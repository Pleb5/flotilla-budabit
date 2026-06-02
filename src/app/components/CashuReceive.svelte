<script lang="ts">
  import CashuTokenRedeemFlow from "@app/components/CashuTokenRedeemFlow.svelte"
  import {formatCashuSats} from "@app/util/cashu-format"
  import {pushModal} from "@app/util/modal"
  import Button from "@lib/components/Button.svelte"

  let token = $state("")
  let received = $state<number | null>(null)

  const redeem = () => {
    const t = token.trim()
    if (!t) return

    pushModal(CashuTokenRedeemFlow, {
      token: t,
      onredeemed: ({amount}: {amount: number; mintUrl: string}) => {
        received = amount
        token = ""
      },
    })
  }
</script>

<div class="flex min-w-0 flex-col gap-4">
  {#if received !== null}
    <div class="rounded-lg bg-success/10 p-4 text-center text-success">
      <p class="text-lg font-bold">+{formatCashuSats(received)} sats received!</p>
      <Button class="btn btn-ghost btn-sm mt-2" onclick={() => (received = null)}>
        Redeem another
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      <label class="text-sm font-medium" for="cashu-token-input">Paste Cashu Token</label>
      <textarea
        id="cashu-token-input"
        class="textarea textarea-bordered min-w-0 break-all font-mono text-xs"
        rows={4}
        placeholder="cashuA..."
        bind:value={token}></textarea>
    </div>

    <Button
      class="btn btn-primary inline-flex w-full justify-center"
      onclick={redeem}
      disabled={!token.trim()}>
      Redeem Token
    </Button>
  {/if}
</div>
