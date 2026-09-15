<script lang="ts">
  import type {Profile} from "@welshman/util"
  import {Github, Globe, Copy} from "@lucide/svelte"
  import {clip} from "@app/util/toast"
  import {deriveProfileIdentities, loadProfileIdentities} from "@app/core/profile-identities"
  import {
    normalizeWebsite,
    readGitHubIdentity,
    verifyGitHubIdentity,
    verifyNip05,
    type IdentityVerification,
  } from "@app/util/profile-identity"
  import IdentityStatus from "./IdentityStatus.svelte"
  import Nip05Status from "./Nip05Status.svelte"

  const {
    profile,
    pubkey,
    relays = [],
  }: {profile?: Profile | null; pubkey: string; relays?: string[]} = $props()
  const identities = $derived(deriveProfileIdentities(pubkey))
  const github = $derived(readGitHubIdentity(profile, $identities))
  const website = $derived(normalizeWebsite(profile?.website))
  let nip05Result = $state<IdentityVerification>()
  let githubResult = $state<IdentityVerification>()
  let checkingNip05 = $state(false)
  let checkingGithub = $state(false)

  $effect(() => {
    void loadProfileIdentities(pubkey, relays).catch(() => undefined)
  })
  $effect(() => {
    const address = profile?.nip05
    const key = pubkey
    const controller = new AbortController()
    nip05Result = undefined
    checkingNip05 = Boolean(address)
    if (address)
      void verifyNip05(address, key, controller.signal).then(result => {
        if (!controller.signal.aborted) {
          nip05Result = result
          checkingNip05 = false
        }
      })
    return () => controller.abort()
  })
  $effect(() => {
    const identity = github
    const key = pubkey
    const controller = new AbortController()
    githubResult = undefined
    checkingGithub = Boolean(identity.username)
    if (identity.username)
      void verifyGitHubIdentity(identity, key, controller.signal).then(result => {
        if (!controller.signal.aborted) {
          githubResult = result
          checkingGithub = false
        }
      })
    return () => controller.abort()
  })
</script>

<div class="flex min-w-0 flex-col gap-2 text-sm" data-testid="profile-identity-links">
  {#if profile?.nip05}
    <div class="flex min-w-0 items-center gap-1.5">
      <Nip05Status address={profile.nip05} result={nip05Result} loading={checkingNip05} />
      <button
        type="button"
        class="btn btn-ghost btn-xs shrink-0"
        aria-label="Copy NIP-05 address"
        title="Copy NIP-05 address"
        onclick={() => clip(profile!.nip05!)}>
        <Copy class="h-3.5 w-3.5" />
      </button>
    </div>
  {/if}
  {#if website}
    <a
      href={website}
      target="_blank"
      rel="noopener noreferrer"
      class="link inline-flex min-w-0 items-center gap-2">
      <Globe class="h-4 w-4 shrink-0" /><span class="break-all">{profile?.website}</span>
    </a>
  {/if}
  {#if github.username}
    <div class="flex min-w-0 items-center gap-2">
      <a
        href="https://github.com/{github.username}"
        target="_blank"
        rel="noopener noreferrer"
        class="link inline-flex min-w-0 items-center gap-2">
        <Github class="h-4 w-4 shrink-0" /><span class="break-all">{github.username}</span>
      </a>
      <IdentityStatus result={githubResult} loading={checkingGithub} />
    </div>
  {/if}
</div>
