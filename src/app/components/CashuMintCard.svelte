<script lang="ts">
  import type {Snippet} from "svelte"
  import Close from "@assets/icons/close.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import CashuMintRecommendationEvidence from "@app/components/CashuMintRecommendationEvidence.svelte"
  import {
    cashuMintInfoByUrl,
    getCashuMintInfoKey,
    loadCashuMintInfo,
    type CashuMintInfoState,
  } from "@app/core/cashu-mint-info"
  import type {CashuMintRecommendation} from "@app/core/cashu-mint-recommendations"
  import {formatCashuSats} from "@app/util/cashu-format"

  interface Props {
    mintUrl: string
    balance?: number
    recommendation?: CashuMintRecommendation
    action?: Snippet
  }

  const {mintUrl, balance, recommendation, action}: Props = $props()

  const idleState: CashuMintInfoState = {status: "idle"}

  let detailsOpen = $state(false)
  let failedIconUrl = $state("")

  const infoKey = $derived(getCashuMintInfoKey(mintUrl))
  const infoState = $derived($cashuMintInfoByUrl[infoKey] || idleState)
  const info = $derived(infoState.info)
  const hasBalance = $derived(typeof balance === "number")

  const host = $derived.by(() => {
    try {
      return new URL(mintUrl).host
    } catch {
      return mintUrl
    }
  })
  const displayName = $derived(info?.name || host)
  const description = $derived(info?.description || "")
  const longDescription = $derived(info?.description_long || "")
  const iconUrl = $derived(info?.icon_url || "")
  const showIcon = $derived(Boolean(iconUrl && failedIconUrl !== iconUrl))
  const fallbackInitial = $derived((displayName.trim().charAt(0) || "M").toUpperCase())
  const nutNumbers = $derived.by(() => {
    if (!info?.nuts) return []

    return Object.keys(info.nuts)
      .filter(key => /^\d+$/.test(key))
      .sort((a, b) => Number(a) - Number(b))
  })
  const primaryNutNumbers = $derived(nutNumbers.slice(0, 4))
  const serverTime = $derived(info?.time ? new Date(info.time * 1000).toLocaleString() : "")

  const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === "object" && !Array.isArray(value))

  const getString = (value: unknown) => (typeof value === "string" ? value.trim() : "")

  const getAmount = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) ? formatCashuSats(value) : ""

  const getMethodLabel = (value: unknown) => {
    if (!isRecord(value)) return ""

    const method = getString(value.method)
    const unit = getString(value.unit)
    const min = getAmount(value.min_amount)
    const max = getAmount(value.max_amount)
    const range = min && max ? `${min}-${max}` : min ? `min ${min}` : max ? `max ${max}` : ""

    return [method, unit, range].filter(Boolean).join(" ")
  }

  const getNutSummary = (nutNumber: string) => {
    const nut = info?.nuts?.[nutNumber]
    if (!isRecord(nut)) return "Supported"
    if (nut.disabled === true) return "Disabled"

    const methods = Array.isArray(nut.methods) ? nut.methods.map(getMethodLabel).filter(Boolean) : []
    if (methods.length) return methods.join(", ")
    if (nut.supported === false) return "Not supported"

    return "Supported"
  }

  const contactLabel = (method: string) => `${method.charAt(0).toUpperCase()}${method.slice(1)}`

  $effect(() => {
    loadCashuMintInfo(mintUrl).catch(() => undefined)
  })
</script>

<div
  class="card2 bg-alt flex min-w-0 flex-col gap-3 px-3 py-3 text-sm sm:flex-row sm:items-start sm:justify-between">
  <div class="flex min-w-0 flex-1 gap-3">
    <div
      class="center h-11 w-11 shrink-0 overflow-hidden rounded-full border border-base-300 bg-base-200 text-sm font-bold text-base-content/70">
      {#if showIcon}
        <img
          alt=""
          src={iconUrl}
          class="h-full w-full object-cover"
          onerror={() => (failedIconUrl = iconUrl)} />
      {:else}
        <span>{fallbackInitial}</span>
      {/if}
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex min-w-0 flex-col gap-0.5">
        <div class="flex min-w-0 flex-wrap items-center gap-1.5">
          <p class="min-w-0 max-w-full truncate font-semibold">{displayName}</p>
          {#if info?.motd}
            <button
              type="button"
              class="badge badge-warning badge-xs cursor-pointer hover:brightness-95"
              title="Open mint notice"
              onclick={() => (detailsOpen = true)}>
              Mint notice
            </button>
          {/if}
          {#if infoState.status === "loading"}
            <span class="loading loading-spinner loading-xs opacity-60"></span>
          {/if}
        </div>
        <p class="max-w-full break-all font-mono text-[11px] opacity-60 sm:truncate">{mintUrl}</p>
      </div>

      {#if description}
        <p class="mt-1 line-clamp-2 text-xs opacity-75">{description}</p>
      {:else if infoState.status === "error"}
        <p class="mt-1 text-xs opacity-60">Mint info unavailable</p>
      {:else if infoState.status === "loading"}
        <p class="mt-1 text-xs opacity-60">Loading mint profile...</p>
      {/if}

      <div class="mt-2 flex flex-wrap items-center gap-1.5">
        {#if hasBalance}
          <span class="badge border-base-content/10 bg-base-200 text-xs font-medium">
            {formatCashuSats(balance || 0)} sats
          </span>
        {/if}
        {#each primaryNutNumbers as nutNumber (nutNumber)}
          <span class="badge border-base-content/10 bg-base-200 text-[10px] font-medium">
            NUT-{nutNumber}
          </span>
        {/each}
        {#if nutNumbers.length > primaryNutNumbers.length}
          <span class="badge border-base-content/10 bg-base-200 text-[10px] font-medium">
            +{nutNumbers.length - primaryNutNumbers.length}
          </span>
        {/if}

        <div class="relative">
          <Button
            class="btn btn-ghost btn-xs inline-flex min-h-fit rounded-full px-2 py-1"
            onclick={() => (detailsOpen = !detailsOpen)}>
            Details
          </Button>
          {#if detailsOpen}
            <InlinePopover onClose={() => (detailsOpen = false)} align="left" widthClass="w-80 sm:w-96">
              <div class="relative flex min-w-0 flex-col gap-3 pr-7 text-sm">
                <button
                  type="button"
                  class="btn btn-ghost btn-xs btn-circle absolute right-0 top-0"
                  aria-label="Close mint details"
                  onclick={() => (detailsOpen = false)}>
                  <Icon icon={Close} size={4} />
                </button>

                <div class="flex min-w-0 items-center gap-3">
                  <div
                    class="center h-10 w-10 shrink-0 overflow-hidden rounded-full border border-base-300 bg-base-200 font-bold text-base-content/70">
                    {#if showIcon}
                      <img
                        alt=""
                        src={iconUrl}
                        class="h-full w-full object-cover"
                        onerror={() => (failedIconUrl = iconUrl)} />
                    {:else}
                      <span>{fallbackInitial}</span>
                    {/if}
                  </div>
                  <div class="min-w-0 flex-1">
                    <p class="truncate font-semibold">{displayName}</p>
                    <p class="break-all font-mono text-[11px] opacity-60">{mintUrl}</p>
                  </div>
                </div>

                {#if infoState.status === "loading"}
                  <p class="text-xs opacity-70">Loading NUT-06 mint info...</p>
                {:else if infoState.status === "error"}
                  <div class="rounded-lg border border-base-300 bg-base-200/50 p-3 text-xs opacity-75">
                    Could not load NUT-06 mint info. The mint may not support CORS or may be offline.
                  </div>
                {:else}
                  {#if info?.motd}
                    <div class="rounded-lg border border-warning/50 bg-warning/10 p-3 text-xs text-warning">
                      <p class="font-semibold">Mint notice</p>
                      <p class="mt-1 whitespace-pre-wrap">{info.motd}</p>
                    </div>
                  {/if}

                  {#if longDescription || description}
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-wide opacity-60">About</p>
                      <p class="mt-1 whitespace-pre-wrap text-xs opacity-80">{longDescription || description}</p>
                    </div>
                  {/if}

                  <div class="grid grid-cols-1 gap-2 text-xs">
                    {#if info?.version}
                      <div class="rounded-lg bg-base-200/60 p-2">
                        <p class="font-semibold opacity-60">Version</p>
                        <p class="mt-1 break-all font-mono">{info.version}</p>
                      </div>
                    {/if}
                    {#if info?.pubkey}
                      <div class="rounded-lg bg-base-200/60 p-2">
                        <p class="font-semibold opacity-60">Mint pubkey</p>
                        <p class="mt-1 break-all font-mono">{info.pubkey}</p>
                      </div>
                    {/if}
                    {#if serverTime}
                      <div class="rounded-lg bg-base-200/60 p-2">
                        <p class="font-semibold opacity-60">Server time</p>
                        <p class="mt-1">{serverTime}</p>
                      </div>
                    {/if}
                  </div>

                  {#if info?.contact?.length}
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Contact</p>
                      <div class="mt-1 flex flex-col gap-1">
                        {#each info.contact as contact (`${contact.method}:${contact.info}`)}
                          <div class="rounded-lg bg-base-200/60 px-2 py-1.5 text-xs">
                            <span class="font-semibold">{contactLabel(contact.method)}:</span>
                            <span class="break-all"> {contact.info}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if info?.tos_url || info?.urls?.length}
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Links</p>
                      <div class="mt-1 flex flex-col gap-1 text-xs">
                        {#if info.tos_url}
                          <a
                            class="break-all rounded-lg bg-base-200/60 px-2 py-1.5 hover:underline"
                            href={info.tos_url}
                            target="_blank"
                            rel="noreferrer">
                            Terms of service
                          </a>
                        {/if}
                        {#each info.urls || [] as url (url)}
                          <a
                            class="break-all rounded-lg bg-base-200/60 px-2 py-1.5 font-mono hover:underline"
                            href={url}
                            target="_blank"
                            rel="noreferrer">
                            {url}
                          </a>
                        {/each}
                      </div>
                    </div>
                  {/if}

                  {#if nutNumbers.length}
                    <div>
                      <p class="text-xs font-semibold uppercase tracking-wide opacity-60">Supported NUTs</p>
                      <div class="mt-1 grid grid-cols-1 gap-1 text-xs">
                        {#each nutNumbers as nutNumber (nutNumber)}
                          <div class="rounded-lg bg-base-200/60 px-2 py-1.5">
                            <span class="font-semibold">NUT-{nutNumber}</span>
                            <span class="opacity-70"> - {getNutSummary(nutNumber)}</span>
                          </div>
                        {/each}
                      </div>
                    </div>
                  {:else if !info?.name && !description && !longDescription}
                    <p class="rounded-lg bg-base-200/60 p-3 text-xs opacity-70">
                      This mint did not return display metadata.
                    </p>
                  {/if}
                {/if}
              </div>
            </InlinePopover>
          {/if}
        </div>
      </div>

      {#if recommendation}
        <div class="mt-2">
          <CashuMintRecommendationEvidence {recommendation} />
        </div>
      {/if}
    </div>
  </div>

  {#if action}
    <div class="flex w-full shrink-0 justify-stretch sm:w-auto sm:justify-end">
      {@render action()}
    </div>
  {/if}
</div>
