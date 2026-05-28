<script lang="ts">
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import {pushModal} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import GitAuthAdd from "@app/components/GitAuthAdd.svelte"
  import {
    ACCESS_TOKEN_SETTINGS_LINKS,
    checkTokenCapabilities,
    getTokenCapabilityPillLabel,
    tokens as tokensStore,
    type TokenCapability,
    type TokenCapabilityCheck,
  } from "@nostr-git/ui"
  import {
    DEFAULT_GIT_CORS_PROXY,
    gitCorsProxy,
    normalizeGitCorsProxy,
    resolveGitCorsProxy,
  } from "@app/util/git-cors-proxy"
  import AddCircle from "@assets/icons/add-circle.svg?dataurl"
  import {Router} from "@welshman/router"
  import {persistGitAuthTokens} from "@app/core/git-requests"
  import {onMount} from "svelte"
  import Git from "@assets/icons/git.svg?dataurl"
  import DangerTriangle from "@assets/icons/danger-triangle.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import Pen from "@assets/icons/pen.svg?dataurl"

  interface TokenEntry {
    host: string
    token: string
  }

  let corsProxyDraft = $state("")
  const effectiveCorsProxy = $derived.by(() => resolveGitCorsProxy($gitCorsProxy))

  $effect(() => {
    corsProxyDraft = $gitCorsProxy || ""
  })

  const saveCorsProxy = () => {
    const normalized = normalizeGitCorsProxy(corsProxyDraft)
    if (normalized !== $gitCorsProxy) {
      gitCorsProxy.set(normalized)
    }
    corsProxyDraft = normalized
  }

  const resetCorsProxy = () => {
    corsProxyDraft = DEFAULT_GIT_CORS_PROXY
    gitCorsProxy.set(DEFAULT_GIT_CORS_PROXY)
  }

  function mask(t: string) {
    return t.length <= 8 ? "••••••••" : `${t.slice(0, 4)}…${t.slice(-4)}`
  }

  const githubTokenSettings = ACCESS_TOKEN_SETTINGS_LINKS.find(link => link.provider === "github")
  const gitlabTokenSettings = ACCESS_TOKEN_SETTINGS_LINKS.find(link => link.provider === "gitlab")
  let capabilityChecks = $state<Record<string, TokenCapabilityCheck>>({})
  let capabilityRefreshing = $state(false)
  let capabilityRefreshError = $state("")
  let lastCapabilitySignature = ""
  let capabilityRunId = 0

  // Use the store directly for reactivity
  // $tokensStore is reactive and will update when tokens are loaded

  function tokenKey(token: TokenEntry) {
    return `${token.host}\n${token.token}`
  }

  function getCapabilityCheck(token: TokenEntry) {
    return capabilityChecks[tokenKey(token)]
  }

  function capabilityPillClass(capability: TokenCapability) {
    const base =
      "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium leading-5"
    if (capability.status === "present") {
      return `${base} border-blue-400/40 bg-blue-500/10 text-blue-700 dark:text-blue-300`
    }
    if (capability.status === "missing") {
      return `${base} border-amber-400/50 bg-amber-500/10 text-amber-700 dark:text-amber-300`
    }
    return `${base} border-base-300 bg-base-200 text-base-content/70`
  }

  function checkSummary(check: TokenCapabilityCheck | undefined) {
    if (!check) return "Checking token capabilities"
    if (check.unsupported) return check.error || "Capability checks unavailable for this host"
    if (!check.valid) return check.error || "Token is invalid"
    return check.userLogin ? `${check.providerLabel}: ${check.userLogin}` : check.providerLabel
  }

  function invalidPillClass() {
    return "inline-flex items-center rounded-full border border-error/40 bg-error/10 px-2 py-0.5 text-xs font-medium leading-5 text-error"
  }

  async function refreshCapabilities(tokensToCheck: TokenEntry[] = $tokensStore) {
    const runId = ++capabilityRunId
    capabilityRefreshing = true
    capabilityRefreshError = ""

    try {
      const entries = await Promise.all(
        tokensToCheck.map(
          async token => [tokenKey(token), await checkTokenCapabilities(token)] as const,
        ),
      )
      if (runId !== capabilityRunId) return
      capabilityChecks = Object.fromEntries(entries)
    } catch (error) {
      if (runId !== capabilityRunId) return
      capabilityRefreshError = error instanceof Error ? error.message : String(error)
    } finally {
      if (runId === capabilityRunId) capabilityRefreshing = false
    }
  }

  onMount(() => {
    void (async () => {
      await tokensStore.waitForInitialization()
      await tokensStore.refresh()
    })()
  })

  $effect(() => {
    const signature = $tokensStore.map(tokenKey).join("|")
    if (signature === lastCapabilitySignature) return
    lastCapabilitySignature = signature

    if (!signature) {
      capabilityChecks = {}
      capabilityRefreshing = false
      return
    }

    void refreshCapabilities($tokensStore)
  })

  async function del(tokenToDelete: TokenEntry) {
    // Match both host AND token to uniquely identify the token to delete
    const updatedTokens = $tokensStore.filter(
      (t: TokenEntry) => !(t.host === tokenToDelete.host && t.token === tokenToDelete.token),
    )

    try {
      const relays = Router.get().FromUser().getUrls()
      await persistGitAuthTokens(updatedTokens, relays)
    } catch (error) {
      console.error("[GitAuth] Failed to delete token:", error)
      pushToast({
        theme: "error",
        message: error instanceof Error ? error.message : "Failed to delete token",
      })
    }
  }

  const openDialog = () => {
    pushModal(GitAuthAdd)
    // No need for polling - the reactive token store will automatically update the UI
  }

  const editToken = (token: TokenEntry) => {
    pushModal(GitAuthAdd, {editToken: token})
    // The reactive token store will automatically update the UI when editing is complete
  }
</script>

<div class="card2 bg-alt flex min-w-0 flex-col gap-6 shadow-xl">
  <div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
    <strong class="flex min-w-0 items-center gap-3">
      <Icon icon={Git} />
      <span class="min-w-0">Git Authentication Tokens</span>
    </strong>
    <div class="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:items-center">
      <Button
        class="btn btn-ghost btn-sm justify-center whitespace-nowrap"
        onclick={() => refreshCapabilities($tokensStore)}
        disabled={capabilityRefreshing || !$tokensStore.length}>
        {capabilityRefreshing ? "Checking..." : "Refresh"}
      </Button>
      <Button class="btn btn-primary btn-sm justify-center whitespace-nowrap" onclick={openDialog}>
        <Icon icon={AddCircle} />
        Add Token
      </Button>
    </div>
  </div>

  <div class="rounded border border-warning/30 bg-warning/10 p-3 text-warning">
    <div class="flex items-start gap-2">
      <Icon icon={DangerTriangle} class="mt-0.5 shrink-0 text-warning" size={4} />
      <p class="min-w-0 text-sm leading-5">
        Tokens are sent in cleartext through the configured CORS proxy and are backed up encrypted
        to your Nostr relays. DO NOT PUT CRITICAL ACCESS TOKENS HERE! SCOPE TOKEN PERMISSIONS TO
        REDUCE RISK.
      </p>
    </div>
  </div>

  <div class="break-words rounded border border-base-300 bg-base-200/40 p-3 text-sm leading-5">
    Need a token?
    <a
      href={githubTokenSettings?.url}
      target="_blank"
      rel="noopener noreferrer"
      class="ml-1 underline underline-offset-2">
      GitHub token settings
    </a>
    <span class="mx-1 opacity-60">or</span>
    <a
      href={gitlabTokenSettings?.url}
      target="_blank"
      rel="noopener noreferrer"
      class="underline underline-offset-2">
      GitLab access token settings
    </a>
  </div>

  {#snippet capabilityDetails(capabilityCheck: TokenCapabilityCheck | undefined)}
    <div class="flex min-w-0 flex-col gap-1">
      <div class="break-words text-xs opacity-70">{checkSummary(capabilityCheck)}</div>
      <div class="flex flex-wrap gap-1">
        {#if capabilityCheck?.valid}
          {#each capabilityCheck.capabilities as capability}
            <span
              class={capabilityPillClass(capability)}
              title={capability.detail || capability.label}>
              {getTokenCapabilityPillLabel(capability)}
            </span>
          {/each}
        {:else if capabilityCheck}
          <span class={invalidPillClass()} title={capabilityCheck.error || "Token check failed"}>
            {capabilityCheck.unsupported ? "Capabilities unknown" : "Invalid token"}
          </span>
        {:else}
          <span
            class="inline-flex items-center rounded-full border border-base-300 bg-base-200 px-2 py-0.5 text-xs font-medium leading-5 text-base-content/70">
            Checking...
          </span>
        {/if}
      </div>
    </div>
  {/snippet}

  {#snippet tokenActions(t: TokenEntry)}
    <div class="flex justify-end gap-2">
      <Button
        class="btn btn-primary btn-sm shrink-0"
        aria-label="Edit token"
        onclick={() => editToken(t)}>
        <Icon icon={Pen} />
      </Button>
      <Button
        class="btn btn-error btn-sm shrink-0"
        aria-label="Delete token"
        onclick={() => del(t)}>
        <Icon icon={TrashBin2} />
      </Button>
    </div>
  {/snippet}

  {#if $tokensStore.length}
    <div class="flex flex-col gap-3 md:hidden">
      {#each $tokensStore as t}
        {@const capabilityCheck = getCapabilityCheck(t)}
        <div class="rounded border border-base-300 bg-base-200/30 p-3">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0">
              <div class="break-all text-sm font-semibold">{t.host}</div>
              <div class="font-mono text-sm opacity-70">{mask(t.token)}</div>
            </div>
            <div class="shrink-0">
              {@render tokenActions(t)}
            </div>
          </div>
          <div class="mt-3 border-t border-base-300 pt-3">
            <div class="mb-2 text-xs font-semibold uppercase tracking-wide opacity-60">
              Capabilities
            </div>
            {@render capabilityDetails(capabilityCheck)}
          </div>
        </div>
      {/each}
    </div>

    <div class="hidden w-full md:block">
      <table class="w-full table-fixed">
        <thead>
          <tr>
            <th class="w-1/5 p-2 text-left">Host</th>
            <th class="w-1/5 p-2 text-left">Token</th>
            <th class="w-2/5 p-2 text-left">Capabilities</th>
            <th class="w-1/5 p-2 text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each $tokensStore as t}
            {@const capabilityCheck = getCapabilityCheck(t)}
            <tr class="hover:bg-neutral">
              <td class="break-all p-2 text-left align-top">{t.host}</td>
              <td class="p-2 text-left align-top font-mono text-sm">{mask(t.token)}</td>
              <td class="p-2 text-left align-top">
                {@render capabilityDetails(capabilityCheck)}
              </td>
              <td class="p-2 text-right align-top">
                {@render tokenActions(t)}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      {#if capabilityRefreshError}
        <p class="mt-2 text-sm text-error">Capability check failed: {capabilityRefreshError}</p>
      {/if}
    </div>
  {:else}
    <p class="py-12 text-center opacity-75">No tokens saved yet!</p>
  {/if}

  <FieldInline>
    {#snippet label()}
      <p>CORS Proxy</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <input
          class="min-w-0 grow"
          type="url"
          placeholder={DEFAULT_GIT_CORS_PROXY}
          bind:value={corsProxyDraft}
          onchange={saveCorsProxy} />
        <Button class="btn btn-ghost btn-xs shrink-0" onclick={resetCorsProxy}>Default</Button>
      </label>
    {/snippet}
    {#snippet info()}
      <p>
        Default: <span class="break-all font-mono">{DEFAULT_GIT_CORS_PROXY}</span>. Leave blank to
        use it. Current: <span class="break-all font-mono">{effectiveCorsProxy}</span>.
      </p>
    {/snippet}
  </FieldInline>
</div>
