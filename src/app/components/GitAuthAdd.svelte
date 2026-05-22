<script lang="ts">
  import {preventDefault} from "@lib/html"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Divider from "@src/lib/components/Divider.svelte"
  import Field from "@src/lib/components/Field.svelte"
  import {GithubIcon} from "@lucide/svelte"
  import {pushToast} from "@app/util/toast"
  import {
    ACCESS_TOKEN_SETTINGS_LINKS,
    checkTokenCapabilities,
    getMissingRecommendedTokenCapabilities,
    getTokenCapabilityPillLabel,
    toast,
    tokens as tokensStore,
    type TokenCapability,
    type TokenCapabilityCheck,
  } from "@nostr-git/ui"
  import {Router} from "@welshman/router"
  import {persistGitAuthTokens} from "@app/core/git-requests"
  import {get} from "svelte/store"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"

  type Props = {
    editToken?: TokenEntry
    initialHost?: string
  }

  const {editToken, initialHost}: Props = $props()

  const back = () => history.back()
  const disabled = $state(true)

  let host = $state(editToken?.host || initialHost || "")
  let token = $state(editToken?.token || "")
  let busy = $state(false)
  let error = $state("")
  let capabilityCheck = $state<TokenCapabilityCheck | null>(null)

  interface TokenEntry {
    host: string
    token: string
  }

  const githubTokenSettings = ACCESS_TOKEN_SETTINGS_LINKS.find(link => link.provider === "github")
  const gitlabTokenSettings = ACCESS_TOKEN_SETTINGS_LINKS.find(link => link.provider === "gitlab")

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

  function capabilityPanelClass(check: TokenCapabilityCheck) {
    const base = "rounded border p-3 text-sm"
    if (!check.valid && !check.unsupported) return `${base} border-error bg-error/10`
    if (check.unsupported) return `${base} border-warning bg-warning/10`
    return `${base} border-base-300 bg-base-200/40`
  }

  function reset() {
    host = token = ""
    busy = false
    error = ""
    capabilityCheck = null
  }

  const saveTokens = async (toks: TokenEntry[]) => {
    try {
      // Get current tokens from store
      const currentTokens: TokenEntry[] = get(tokensStore)
      let allTokens: TokenEntry[]

      if (editToken) {
        // Edit mode: replace the existing token with the same host AND token
        const existingTokens = currentTokens.filter(
          (t: TokenEntry) => !(t.host === editToken.host && t.token === editToken.token),
        )
        allTokens = [...existingTokens, ...toks]
      } else {
        // Add mode: append new tokens
        allTokens = [...currentTokens, ...toks]
      }

      // Clean the data to ensure it's properly formatted
      const cleanTokens = allTokens.map(t => ({
        host: String(t.host).trim(),
        token: String(t.token).trim(),
      }))

      const relays = Router.get().FromUser().getUrls()
      await persistGitAuthTokens(cleanTokens, relays)

      console.log("[GitAuthAdd] Tokens saved successfully, count:", cleanTokens.length)
    } catch (e) {
      error = "Failed to save tokens: " + e
      throw e // Re-throw to let submit function know it failed
    }
  }

  const submit = async () => {
    // Clean the token to remove any potential console output contamination
    const cleanToken = token.split("\n")[0].trim() // Take only the first line
    const cleanHost = host.trim()

    // Basic validation
    if (!cleanHost || !cleanToken) {
      error = "Both host and token are required"
      return
    }

    if (cleanToken.length > 200) {
      error = "Token appears to be corrupted (too long). Please refresh the page and try again."
      return
    }

    busy = true
    error = "" // Clear any previous errors

    try {
      capabilityCheck = await checkTokenCapabilities({host: cleanHost, token: cleanToken})
      if (!capabilityCheck.valid && !capabilityCheck.unsupported) {
        error = capabilityCheck.error || "Token validation failed"
        return
      }

      await saveTokens([{host: cleanHost, token: cleanToken}])
      const missingCapabilities = getMissingRecommendedTokenCapabilities(capabilityCheck)
      if (missingCapabilities.length > 0) {
        pushToast({
          theme: "warning",
          timeout: 8000,
          message: `Token saved, but missing: ${missingCapabilities
            .map(getTokenCapabilityPillLabel)
            .join(", ")}. Some Budabit Git workflows may fail until permissions are updated.`,
        })
      } else if (capabilityCheck.unsupported) {
        pushToast({
          theme: "warning",
          timeout: 8000,
          message: "Token saved, but Budabit could not verify capabilities for this host.",
        })
      }
      reset()
      back()
    } catch (e) {
      error = e instanceof Error ? e.message : "An error occurred while saving the token"
    } finally {
      busy = false
    }
  }

  $effect(() => {
    if ($toast.length > 0) {
      $toast.forEach(t => {
        pushToast({
          message: t.description!,
          theme: t.variant === "error" ? "error" : undefined,
        })
      })
      toast.clear()
    }
  })

  $effect(() => {
    if (error) {
      pushToast({
        theme: "error",
        message: error,
      })
    }
  })
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      {editToken ? "Edit Git Auth Token" : "Add a Git Auth Token"}
    {/snippet}
    {#snippet info()}
      <p>Use this form to {editToken ? "edit your existing" : "add a"} Git auth token.</p>
      <p>
        Need a token?
        <a href={githubTokenSettings?.url} target="_blank" rel="noopener noreferrer"
          >GitHub token settings</a>
        |
        <a href={gitlabTokenSettings?.url} target="_blank" rel="noopener noreferrer"
          >GitLab access token settings</a>
      </p>
    {/snippet}
  </ModalHeader>

  <Divider>
    <p>Device flow</p>
  </Divider>

  <Button class="btn btn-primary" {disabled}>
    <GithubIcon />
    Device flow
  </Button>

  <Divider>
    <p>Manual token</p>
  </Divider>

  <div class="column gap-4">
    <Field>
      {#snippet label()}
        <p>Host</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <input bind:value={host} class="grow" type="text" placeholder="git.example.com" />
        </label>
      {/snippet}
    </Field>
    <Field>
      {#snippet label()}
        <p>Token</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <input
            bind:value={token}
            type="password"
            class="grow"
            placeholder="ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
        </label>
      {/snippet}
    </Field>
    {#if capabilityCheck}
      <div class={capabilityPanelClass(capabilityCheck)}>
        <div class="mb-2 font-medium">
          {#if capabilityCheck.valid}
            {capabilityCheck.providerLabel} token checked{capabilityCheck.userLogin
              ? ` for ${capabilityCheck.userLogin}`
              : ""}
          {:else if capabilityCheck.unsupported}
            Capability check unavailable
          {:else}
            Token validation failed
          {/if}
        </div>
        {#if capabilityCheck.error}
          <p class="mb-2 text-sm opacity-80">{capabilityCheck.error}</p>
        {/if}
        <div class="flex flex-wrap gap-1">
          {#each capabilityCheck.capabilities as capability}
            <span class={capabilityPillClass(capability)} title={capability.detail || capability.label}>
              {getTokenCapabilityPillLabel(capability)}
            </span>
          {/each}
        </div>
      </div>
    {/if}
  </div>
  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={busy}>
      <Spinner loading={busy}>{editToken ? "Save Changes" : "Add"}</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
