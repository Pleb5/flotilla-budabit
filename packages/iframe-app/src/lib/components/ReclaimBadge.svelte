<script lang="ts">
  import {AlertCircle, Check, Clock, Coins, Lock, RotateCw} from '@lucide/svelte'

  export type ReclaimBadgeStatus =
    | 'idle'
    | 'pending'
    | 'redeemed'
    | 'rateLimited'
    | 'failed'
    | 'p2pkUnsupported'

  interface Props {
    status: ReclaimBadgeStatus
    kind: 'change' | 'original'
    amount?: number | null
    /** Unix ms when a rate-limit cooldown lifts. Required when status === 'rateLimited'. */
    rateLimitUntil?: number
    /** Last error message — surfaced as a tooltip when status === 'failed'. */
    error?: string
    /** Render as an interactive button. When false, renders a passive span. */
    interactive?: boolean
    onclick?: () => void
  }

  const {
    status,
    kind,
    amount,
    rateLimitUntil,
    error,
    interactive = false,
    onclick,
  }: Props = $props()

  // Tick once a second so the rate-limit countdown updates.
  let now = $state(Date.now())
  $effect(() => {
    if (status !== 'rateLimited') return
    const id = setInterval(() => (now = Date.now()), 1000)
    return () => clearInterval(id)
  })

  const cooldownSecs = $derived(
    rateLimitUntil ? Math.max(0, Math.ceil((rateLimitUntil - now) / 1000)) : 0
  )

  const amountText = $derived(
    typeof amount === 'number' ? `₿ ${amount.toLocaleString()}` : null
  )

  const labelPrefix = $derived(kind === 'change' ? 'Change' : 'Refund')

  const visual = $derived(visualFor())

  function visualFor() {
    switch (status) {
      case 'idle':
        return {
          icon: Coins,
          spin: false,
          tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
          text: amountText ? `Reclaim ${amountText}` : 'Reclaim',
          title: `${labelPrefix} available — click to reclaim into your wallet.`,
        }
      case 'pending':
        return {
          icon: RotateCw,
          spin: true,
          tone: 'border-sky-500/30 bg-sky-500/10 text-sky-300',
          text: 'Reclaiming…',
          title: 'Calling the mint…',
        }
      case 'redeemed':
        return {
          icon: Check,
          spin: false,
          tone: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300',
          text: amountText ? `Reclaimed ${amountText}` : 'Reclaimed',
          title: `${labelPrefix} returned to your wallet.`,
        }
      case 'rateLimited':
        return {
          icon: Clock,
          spin: false,
          tone: 'border-amber-500/30 bg-amber-500/10 text-amber-300',
          text: `Retry in ${cooldownSecs}s`,
          title: 'Mint rate-limited — retrying after the cooldown.',
        }
      case 'failed':
        return {
          icon: AlertCircle,
          spin: false,
          tone: 'border-red-500/30 bg-red-500/10 text-red-300',
          text: 'Reclaim failed',
          title: error || 'Reclaim failed.',
        }
      case 'p2pkUnsupported':
        return {
          icon: Lock,
          spin: false,
          tone: 'border-zinc-500/30 bg-zinc-500/10 text-zinc-300',
          text: 'Locked refund',
          title:
            'Token is P2PK-locked. Unlocking requires the wallet keyring (coming soon). The reclaim attempt was skipped to avoid hitting the mint.',
        }
    }
  }
</script>

{#if interactive}
  <button
    type="button"
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60 {visual.tone}"
    title={visual.title}
    disabled={status !== 'idle' && status !== 'failed'}
    onclick={event => {
      event.stopPropagation()
      onclick?.()
    }}>
    <visual.icon class={`h-3 w-3 ${visual.spin ? 'animate-spin' : ''}`} />
    <span>{visual.text}</span>
  </button>
{:else}
  <span
    class="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium {visual.tone}"
    title={visual.title}>
    <visual.icon class={`h-3 w-3 ${visual.spin ? 'animate-spin' : ''}`} />
    <span>{visual.text}</span>
  </span>
{/if}
