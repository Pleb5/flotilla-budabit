<script lang="ts">
  import { onMount } from "svelte";
  import {
    DEFAULT_RECOMMENDED_GRASP_SERVER_URLS,
    normalizeGraspServerUrls,
  } from "../../stores/graspServers.js";
  import { tokens as tokensStore, type Token } from "../../stores/tokens.js";
  import { ACCESS_TOKEN_SETTINGS_PATH } from "../../utils/tokenManagement";
  import { sanitizeRelays } from "@nostr-git/core/utils";
  import { registerGitHost, type GitVendor } from "@nostr-git/core/git";
  import { newRepoTargetCards, validGraspSelection } from "../../utils/new-repo-targets.js";
  import type { RemoteTargetOption } from "../../utils/remote-targets.js";

  interface Props {
    selectedProviders: string[];
    onProvidersChange: (providers: string[]) => void;
    disabledProviders?: string[];
    relayUrls?: string[];
    onRelayUrlsChange?: (urls: string[]) => void;
    graspServerOptions: string[];
    importing?: boolean;
    accountChecks?: RemoteTargetOption[];
    checkingAccounts?: boolean;
  }
  const {
    selectedProviders,
    onProvidersChange,
    disabledProviders = [],
    relayUrls = [],
    onRelayUrlsChange,
    graspServerOptions,
    importing = false,
    accountChecks = [],
    checkingAccounts = false,
  }: Props = $props();
  let tokens = $state<Token[]>([]);
  let newRelay = $state("");
  let inputError = $state("");
  onMount(() => {
    const unsubscribe = tokensStore.subscribe((value) => {
      tokens = value;
    });
    void tokensStore.waitForInitialization();
    return unsubscribe;
  });
  const providers = $derived(newRepoTargetCards(tokens));
  const graspValid = $derived(validGraspSelection(selectedProviders.includes("grasp"), relayUrls));
  const recommended = $derived(
    normalizeGraspServerUrls([...graspServerOptions, ...DEFAULT_RECOMMENDED_GRASP_SERVER_URLS])
  );

  function toggle(id: string) {
    onProvidersChange(
      selectedProviders.includes(id)
        ? selectedProviders.filter((value) => value !== id)
        : [...selectedProviders, id]
    );
  }
  function addRelay(value: string) {
    if (!validGraspSelection(true, [value])) {
      inputError = "Enter a valid ws:// or wss:// server URL without credentials.";
      return;
    }
    const normalized = sanitizeRelays([value])[0];
    onRelayUrlsChange?.([...new Set([...relayUrls, normalized])]);
    newRelay = "";
    inputError = "";
  }
</script>

<div class="min-w-0 space-y-4 [overflow-wrap:anywhere]">
  <div class="space-y-2">
    {#if !importing}<h2 class="text-xl font-semibold">Choose Git Service</h2>{/if}
    <p class="text-sm text-muted-foreground">
      {importing
        ? "Select at least one writable destination for independent Git copies. The new repositories will be announced on Nostr."
        : "Select one or more services for your new repository."}
      Hosted destinations need their own token; GRASP uses your Nostr signer.
    </p>
  </div>
  {#each providers as provider (provider.id)}
    <section
      class="rounded-lg border border-border bg-card p-4 {selectedProviders.includes(provider.id)
        ? 'ring-2 ring-accent'
        : ''}"
    >
      <label
        class="flex min-h-10 cursor-pointer items-center gap-3 {provider.hasToken
          ? ''
          : 'opacity-60'}"
      >
        <input
          type="checkbox"
          class="h-5 w-5 shrink-0 rounded-sm accent-primary"
          checked={selectedProviders.includes(provider.id)}
          disabled={!provider.hasToken || !provider.supported}
          onchange={() => toggle(provider.id)}
        />
        <span class="min-w-0 flex-1">
          <span class="block font-medium">{provider.name}</span>
          <span class="block text-sm text-muted-foreground"
            >{provider.id === "grasp" ? "Uses your Nostr signer" : provider.host}</span
          >
        </span>
        {#if disabledProviders.includes(provider.id)}<span class="text-sm text-destructive"
            >Name conflict</span
          >{/if}
      </label>
      {#if selectedProviders.includes(provider.id) && provider.id !== "grasp"}
        {@const account = accountChecks.find((item) => item.host === provider.host)}
        {#if checkingAccounts}<p role="status" class="mt-2 text-sm">
            Checking destination account…
          </p>
        {:else if account?.status === "ready"}<p
            role="status"
            class="mt-2 text-sm font-semibold text-green-700 dark:text-green-300"
          >
            Destination account: {account.username}
          </p>
        {:else}<p role="alert" class="mt-2 text-sm text-destructive">
            {account?.detail ||
              "Could not verify this destination account. Check its token in Settings, then select the destination again."}
          </p>{/if}
      {/if}
      {#if !provider.hasToken}
        <p class="mt-2 text-sm text-muted-foreground">
          Add a destination token in <a class="underline" href={ACCESS_TOKEN_SETTINGS_PATH}
            >Settings</a
          >
          to enable {provider.name}.
        </p>
      {/if}
      {#if !provider.supported}
        <label class="mt-2 block text-sm"
          >Provider for {provider.host}
          <select
            class="mt-1 w-full rounded border border-input bg-background px-3 py-2"
            onchange={(event) => {
              const family = event.currentTarget.value as GitVendor;
              if (!family) return;
              registerGitHost(provider.host, family);
              tokens = [...tokens];
              onProvidersChange([...selectedProviders]);
            }}
          >
            <option value="">Choose this host's provider</option>
            <option value="github">GitHub Enterprise</option><option value="gitlab">GitLab</option
            ><option value="gitea">Gitea</option><option value="forgejo">Forgejo</option>
          </select>
        </label>
      {/if}
      {#if provider.id === "grasp" && selectedProviders.includes("grasp")}
        <fieldset class="mt-3 space-y-3 border-t border-border pt-3">
          <legend class="px-1 text-sm font-medium">GRASP servers — select at least one</legend>
          {#if !graspValid}
            <p role="status" class="text-sm text-destructive">
              Select at least one valid GRASP server below to continue.
            </p>
          {:else}
            <p role="status" class="text-sm text-muted-foreground">
              {relayUrls.length} server{relayUrls.length === 1 ? "" : "s"} selected
            </p>
          {/if}
          {#each [...new Set([...relayUrls, ...recommended])] as url}
            <label class="flex min-h-10 cursor-pointer items-center gap-3 text-sm">
              <input
                type="checkbox"
                class="h-4 w-4 shrink-0 rounded-sm accent-primary"
                checked={relayUrls.includes(url)}
                onchange={() =>
                  relayUrls.includes(url)
                    ? onRelayUrlsChange?.(relayUrls.filter((value) => value !== url))
                    : addRelay(url)}
              />
              <span class="min-w-0 break-all">{url}</span>
            </label>
          {/each}
          <div class="flex min-w-0 flex-wrap gap-2">
            <input
              aria-label="Custom GRASP server"
              class="min-w-0 flex-1 rounded border border-input bg-background px-3 py-2"
              placeholder="wss://grasp.example.org"
              bind:value={newRelay}
              onkeydown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  addRelay(newRelay.trim());
                }
              }}
            />
            <button
              type="button"
              class="rounded border border-input px-3 py-2"
              onclick={() => addRelay(newRelay.trim())}>Add server</button
            >
          </div>
          {#if inputError}<p role="alert" class="text-sm text-destructive">{inputError}</p>{/if}
        </fieldset>
      {/if}
    </section>
  {/each}
  {#if selectedProviders.length === 0}
    <p class="text-sm text-muted-foreground">Select at least one target to continue.</p>
  {:else if !checkingAccounts && graspValid && accountChecks.length > 0 && accountChecks.every((account) => account.status === "ready") && selectedProviders.every( (id) => providers.some((provider) => provider.id === id && provider.hasToken && provider.supported) )}
    <p role="status" class="rounded bg-muted/50 p-3 text-sm">
      Ready: {selectedProviders
        .map((id) => providers.find((provider) => provider.id === id)?.name)
        .join(", ")}
    </p>
  {/if}
</div>
