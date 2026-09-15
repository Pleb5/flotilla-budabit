<script lang="ts">
  import {onMount, type Snippet} from "svelte"
  import {tokens as tokensStore} from "@nostr-git/ui"
  import {preventDefault} from "@lib/html"
  import {Github, Globe, Info, LoaderCircle, UserRound} from "@lucide/svelte"
  import Field from "@lib/components/Field.svelte"
  import Button from "@lib/components/Button.svelte"
  import InputProfilePicture from "@app/components/InputProfilePicture.svelte"
  import IdentityStatus from "@app/components/IdentityStatus.svelte"
  import Nip05Status from "@app/components/Nip05Status.svelte"
  import {
    createGitHubAttestation,
    githubProofText,
    normalizeGitHubIdentity,
    normalizeWebsite,
    readGitHubIdentity,
    verifyGitHubIdentity,
    verifyNip05,
    type IdentityVerification,
    type ProfileValues,
  } from "@app/util/profile-identity"

  type Props = {
    initialValues: ProfileValues
    onsubmit: (values: ProfileValues) => unknown
    hideAddress?: boolean
    isSignup?: boolean
    footer: Snippet
    pubkey: string
  }
  const {
    initialValues,
    hideAddress = false,
    isSignup = false,
    onsubmit,
    footer,
    pubkey,
  }: Props = $props()
  // Work on a detached draft, never mutate the profile held by the shared store.
  const values = $state({
    profile: {
      ...initialValues.profile,
      name: initialValues.profile.name || initialValues.profile.display_name || "",
    },
    githubIdentity: {
      ...(initialValues.githubIdentity ?? readGitHubIdentity(initialValues.profile)),
    },
  })
  const originalNip05 = initialValues.profile.nip05?.trim() || ""
  const originalGithub = JSON.stringify(normalizeGitHubIdentity(values.githubIdentity))
  let isCreatingAttestation = $state(false)
  let submitting = $state(false)
  let uploadingPicture = $state(false)
  let uploadingBanner = $state(false)
  let attestationError = $state("")
  let formError = $state("")
  let nip05Result = $state<IdentityVerification>()
  let githubResult = $state<IdentityVerification>()
  let checkingNip05 = $state(false)
  let checkingGithub = $state(false)
  let verificationAttempt = $state(0)
  const githubToken = $derived(
    $tokensStore.find(
      token => /^(?:https?:\/\/)?(?:api\.)?github\.com\/?$/i.test(token.host) && token.token,
    ),
  )
  const github = $derived(normalizeGitHubIdentity(values.githubIdentity))
  const busy = $derived(submitting || isCreatingAttestation || uploadingPicture || uploadingBanner)

  onMount(() => {
    void tokensStore.waitForInitialization()
  })

  $effect(() => {
    const address = values.profile.nip05?.trim()
    const key = pubkey
    void verificationAttempt
    const controller = new AbortController()
    nip05Result = undefined
    checkingNip05 = Boolean(address)
    const timer = setTimeout(async () => {
      if (!address) return
      const result = await verifyNip05(address, key, controller.signal)
      if (!controller.signal.aborted) {
        nip05Result = result
        checkingNip05 = false
      }
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  })
  $effect(() => {
    const identity = github
    const key = pubkey
    void verificationAttempt
    const controller = new AbortController()
    githubResult = undefined
    checkingGithub = Boolean(identity.username || identity.proof)
    const timer = setTimeout(async () => {
      if (!identity.username && !identity.proof) return
      const result = await verifyGitHubIdentity(identity, key, controller.signal)
      if (!controller.signal.aborted) {
        githubResult = result
        checkingGithub = false
      }
    }, 400)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  })

  async function autoVerifyGithub() {
    if (!githubToken || busy) return
    isCreatingAttestation = true
    attestationError = ""
    try {
      values.githubIdentity = await createGitHubAttestation(githubToken.token, pubkey)
    } catch (error) {
      attestationError = error instanceof Error ? error.message : "Failed to create GitHub proof."
    } finally {
      isCreatingAttestation = false
    }
  }

  async function submit() {
    if (busy) return
    formError = ""
    const draft = $state.snapshot(values)
    draft.profile.name = draft.profile.name.trim()
    draft.profile.nip05 = draft.profile.nip05?.trim() || ""
    draft.githubIdentity = normalizeGitHubIdentity(draft.githubIdentity)
    if (!draft.profile.name) {
      formError = "Name is required."
      return
    }
    if (draft.profile.website?.trim()) {
      const website = normalizeWebsite(draft.profile.website)
      if (!website) {
        formError = "Enter an http or https website URL."
        return
      }
      draft.profile.website = website
    } else draft.profile.website = ""
    submitting = true
    try {
      // A temporary service failure must not prevent unrelated edits to existing claims.
      if (draft.profile.nip05 && (isSignup || draft.profile.nip05 !== originalNip05)) {
        nip05Result = await verifyNip05(draft.profile.nip05, pubkey)
        if (nip05Result.status !== "valid") {
          formError = nip05Result.message
          return
        }
      }
      if (
        JSON.stringify(draft.githubIdentity) !== originalGithub &&
        (draft.githubIdentity.username || draft.githubIdentity.proof)
      ) {
        githubResult = await verifyGitHubIdentity(draft.githubIdentity, pubkey)
        if (githubResult.status !== "valid") {
          formError = githubResult.message
          return
        }
      }
      await onsubmit(draft)
    } finally {
      submitting = false
    }
  }
</script>

<form
  class="col-4"
  onsubmit={preventDefault(submit)}
  aria-label={isSignup ? "Create profile" : "Edit profile"}>
  <fieldset disabled={busy} class="col-4 min-w-0">
    <div class="flex justify-center py-2">
      <InputProfilePicture bind:url={values.profile.picture} bind:uploading={uploadingPicture} />
    </div>
    <input
      aria-label="Profile image URL"
      class="input input-bordered w-full"
      type="url"
      placeholder="Profile image URL (optional)"
      bind:value={values.profile.picture} />
    <Field>
      {#snippet label()}<p>Banner image</p>{/snippet}
      {#snippet input()}
        <InputProfilePicture
          variant="banner"
          bind:url={values.profile.banner}
          bind:uploading={uploadingBanner} />
        <input
          aria-label="Banner image URL"
          class="input input-bordered mt-2 w-full"
          type="url"
          placeholder="https://example.com/banner.jpg"
          bind:value={values.profile.banner} />
      {/snippet}
      {#snippet info()}Upload a wide image or paste its URL.{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Name <span class="text-error">*</span></p>{/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <UserRound class="h-5 w-5 shrink-0" />
          <input
            aria-label="Name"
            bind:value={values.profile.name}
            class="min-w-0 grow"
            type="text"
            required
            pattern=".*\S.*"
            autocomplete="nickname" />
        </label>
      {/snippet}
      {#snippet info()}What would you like people to call you? A name is required.{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>About you</p>{/snippet}
      {#snippet input()}<textarea
          aria-label="About you"
          class="textarea textarea-bordered leading-5"
          rows="4"
          bind:value={values.profile.about}></textarea
        >{/snippet}
      {#snippet info()}Give a brief introduction to why you're here.{/snippet}
    </Field>
    <Field>
      {#snippet label()}<p>Website</p>{/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Globe class="h-5 w-5 shrink-0" />
          <input
            aria-label="Website"
            bind:value={values.profile.website}
            class="min-w-0 grow"
            type="text"
            inputmode="url"
            placeholder="https://example.com" />
        </label>
      {/snippet}
    </Field>
    {#if !hideAddress}
      <Field>
        {#snippet label()}<p>
            Nostr address <span class="text-xs opacity-60">(NIP-05)</span>
          </p>{/snippet}
        {#snippet input()}
          <label class="input input-bordered flex w-full items-center gap-2">
            <input
              aria-label="NIP-05 address"
              bind:value={values.profile.nip05}
              class="min-w-0 grow"
              type="text"
              placeholder="name@example.com"
              autocapitalize="none"
              spellcheck="false" />
            <Nip05Status result={nip05Result} loading={checkingNip05} />
          </label>
        {/snippet}
        {#snippet info()}
          <p class:text-error={nip05Result?.status === "invalid"}>
            {nip05Result?.message || "Optional. The address must point to your Nostr public key."}
          </p>
          {#if isSignup}<p class="mt-1">
              Your new public key: <code class="break-all text-xs"
                >{githubProofText(pubkey).split(": ")[1]}</code>
            </p>{/if}
          {#if nip05Result?.status === "unavailable"}<Button
              class="link text-sm"
              onclick={() => verificationAttempt++}>Retry NIP-05 check</Button
            >{/if}
        {/snippet}
      </Field>
    {/if}
    <Field>
      {#snippet label()}<p>
          GitHub account <span class="text-xs opacity-60">(NIP-39)</span>
        </p>{/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Github class="h-5 w-5 shrink-0" />
          <input
            aria-label="GitHub username"
            bind:value={values.githubIdentity.username}
            class="min-w-0 grow"
            type="text"
            placeholder="your-github-username"
            autocapitalize="none"
            spellcheck="false" />
        </label>
      {/snippet}
      {#snippet info()}Optional. Link your GitHub account using a public verification Gist.{/snippet}
    </Field>
    {#if values.githubIdentity.username || values.githubIdentity.proof}
      <Field>
        {#snippet label()}<p>
            GitHub proof <span class="text-xs opacity-60">(Gist ID or URL)</span>
          </p>{/snippet}
        {#snippet input()}
          <label class="input input-bordered flex w-full items-center gap-2">
            <input
              aria-label="GitHub proof"
              bind:value={values.githubIdentity.proof}
              class="min-w-0 grow"
              type="text"
              placeholder="Gist ID or https://gist.github.com/…"
              spellcheck="false" />
            <IdentityStatus result={githubResult} loading={checkingGithub} />
          </label>
        {/snippet}
        {#snippet info()}
          {#if githubResult}<p class:text-error={githubResult?.status === "invalid"}>
              {githubResult?.message}
            </p>{/if}
          {#if github.proof && /^[a-f\d]+$/i.test(github.proof)}
            <a
              href="https://gist.github.com/{github.username}/{github.proof}"
              target="_blank"
              rel="noopener noreferrer"
              class="link mt-1 inline-block break-all">View verification Gist</a>
          {/if}
          <p class="mt-2">The Gist must contain one file with this text:</p>
          <code class="mt-1 block break-all rounded bg-base-200 p-2 text-xs text-base-content"
            >{githubProofText(pubkey)}</code>
          <Button class="link mt-2 text-sm" onclick={() => verificationAttempt++}
            >Recheck GitHub proof</Button>
          <Button
            class="link ml-3 mt-2 text-sm"
            onclick={() => (values.githubIdentity = {username: "", proof: ""})}
            >Remove GitHub link</Button>
        {/snippet}
      </Field>
    {/if}
    {#if githubToken && (!github.username || !github.proof || isCreatingAttestation)}
      <div class="rounded-lg border border-info/30 bg-info/10 p-4 text-base-content">
        <div class="flex items-start gap-3">
          <Info class="mt-0.5 h-5 w-5 shrink-0 text-info" />
          <div class="min-w-0 flex-1">
            <h4 class="mb-2 font-medium">Automatic GitHub verification available</h4>
            <p class="mb-3 text-sm opacity-80">
              Use your configured GitHub token to reuse an existing proof or create a public
              verification Gist. Save the profile to publish the link. The token needs Gist write
              permission.
            </p>
            <Button
              class="btn btn-primary btn-sm h-auto min-h-8 py-2"
              onclick={autoVerifyGithub}
              disabled={busy}>
              {#if isCreatingAttestation}<LoaderCircle class="h-4 w-4 animate-spin" />Creating
                GitHub proof…{:else}<Github class="h-4 w-4" />Auto-Verify GitHub Identity{/if}
            </Button>
          </div>
        </div>
      </div>
    {/if}
    {#if attestationError}<p role="alert" class="text-sm text-error">{attestationError}</p>{/if}
    {#if formError}<p role="alert" class="text-sm text-error">{formError}</p>{/if}
    {#if submitting}<p role="status" class="text-sm opacity-70">
        Checking and saving profile…
      </p>{/if}
    {@render footer()}
  </fieldset>
</form>
