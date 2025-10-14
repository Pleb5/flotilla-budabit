<script lang="ts">
  import type {Snippet} from "svelte"
  import type {Profile} from "@welshman/util"
  import {preventDefault} from "@lib/html"
  import {nip19} from "nostr-tools"
  import {tokens as tokensStore} from "@nostr-git/ui"
  import UserCircle from "@assets/icons/user-circle.svg?dataurl"
  import MapPoint from "@assets/icons/map-point.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Field from "@lib/components/Field.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Button from "@lib/components/Button.svelte"
  import InputProfilePicture from "@app/components/InputProfilePicture.svelte"
  import InfoHandle from "@app/components/InfoHandle.svelte"
  import {pushModal} from "@app/util/modal"

  type Values = {
    profile: Profile
    shouldBroadcast: boolean
    githubIdentity?: {
      username: string
      proof: string // GitHub Gist ID
    }
  }

  type Props = {
    initialValues: Values
    onsubmit: (values: Values) => void
    isSignup?: boolean
    footer: Snippet
    pubkey: string
  }

  const {initialValues, hideAddress, onsubmit, footer, pubkey}: Props = $props()

  const values = $state({
    ...initialValues,
    githubIdentity: (() => {
      // Extract GitHub identity from existing profile tags if present
      const existingGithubTag = initialValues.profile.event?.tags?.find(tag => 
        tag[0] === 'i' && tag[1]?.startsWith('github:')
      )
      
      if (existingGithubTag) {
        const [, platformIdentity, proof] = existingGithubTag
        const username = platformIdentity.split(':')[1]
        if (username && proof) {
          return { username, proof }
        }
      }
      
      return { username: '', proof: '' }
    })()
  })

  const submit = () => onsubmit($state.snapshot(values))

  let file: File | undefined = $state()
  let isCreatingAttestation = $state(false)
  let attestationError = $state('')
  
  const npub = nip19.npubEncode(pubkey)
  
  // Check if user has GitHub token and no existing GitHub identity
  const githubToken = $derived(() => {
    const tokens = $tokensStore
    return tokens.find(t => t.host === 'github.com' || t.host === 'api.github.com')
  })
  
  const shouldOfferAutoAttestation = $derived(() => {
    return githubToken() && 
           (!values.githubIdentity?.username || !values.githubIdentity?.proof) &&
           !isCreatingAttestation
  })
  
  // Auto-create GitHub attestation
  async function createGitHubAttestation() {
    const token = githubToken()
    if (!token) {
      attestationError = 'No GitHub token found'
      return
    }
    
    isCreatingAttestation = true
    attestationError = ''
    
    try {
      // Get GitHub user info
      const userResponse = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${token.token}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      })
      
      if (!userResponse.ok) {
        throw new Error(`GitHub API error: ${userResponse.status}`)
      }
      
      const userData = await userResponse.json()
      const username = userData.login
      
      // Create attestation text
      const attestationText = `Verifying that I control the following Nostr public key: ${npub}`
      
      // Create GitHub Gist
      const gistResponse = await fetch('https://api.github.com/gists', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          description: 'Nostr Identity Verification (NIP-39)',
          public: true,
          files: {
            'nostr-verification.txt': {
              content: attestationText
            }
          }
        })
      })
      
      if (!gistResponse.ok) {
        throw new Error(`Failed to create Gist: ${gistResponse.status}`)
      }
      
      const gistData = await gistResponse.json()
      const gistId = gistData.id
      
      // Update form values
      values.githubIdentity = {
        username,
        proof: gistId
      }
      
    } catch (error) {
      console.error('Failed to create GitHub attestation:', error)
      attestationError = error instanceof Error ? error.message : 'Failed to create attestation'
    } finally {
      isCreatingAttestation = false
    }
  }
</script>

<form class="col-4" onsubmit={preventDefault(submit)}>
  {#if isSignup}
    <div class="grid grid-cols-2">
      <div class="flex flex-col gap-2">
        <p class="text-2xl">Create a Profile</p>
        <p class="text-sm">
          Give people something to go on — but remember, privacy matters! Be careful about sharing
          sensitive information.
        </p>
      </div>
      <div class="flex flex-col items-center justify-center gap-2">
        <InputProfilePicture bind:file bind:url={values.profile.picture} />
        <p class="text-xs">Upload an Avatar</p>
      </div>
    </div>
  {:else}
    <div class="flex items-center justify-center py-4">
      <InputProfilePicture bind:file bind:url={values.profile.picture} />
    </div>
  {/if}
  <Field>
    {#snippet label()}
      <p>Nickname</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <Icon icon={UserCircle} />
        <input bind:value={values.profile.name} class="grow" type="text" />
      </label>
    {/snippet}
    {#snippet info()}
      What would you like people to call you?
    {/snippet}
  </Field>
  <Field>
    {#snippet label()}
      <p>About You</p>
    {/snippet}
    {#snippet input()}
      <textarea
        class="textarea textarea-bordered leading-4"
        rows="5"
        bind:value={values.profile.about}></textarea>
    {/snippet}
    {#snippet info()}
      Give a brief introduction to why you're here.
    {/snippet}
  </Field>
  
  <!-- Auto-Attestation Offer -->
  {#if shouldOfferAutoAttestation()}
    <div class="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
      <div class="flex items-start gap-3">
        <Icon icon="info-circle" class="text-blue-600 mt-0.5" />
        <div class="flex-1">
          <h4 class="font-medium text-blue-900 mb-2">Automatic GitHub Verification Available</h4>
          <p class="text-sm text-blue-700 mb-3">
            We detected you have a GitHub token configured. We can automatically create a verification Gist 
            and set up your GitHub identity for you.
          </p>
          <Button 
            class="btn btn-sm btn-primary" 
            onclick={createGitHubAttestation}
            disabled={isCreatingAttestation}
          >
            {#if isCreatingAttestation}
              <Icon icon="clock-circle" class="animate-spin" />
              Creating Attestation...
            {:else}
              <Icon icon="git" />
              Auto-Verify GitHub Identity
            {/if}
          </Button>
          {#if attestationError}
            <p class="text-sm text-red-600 mt-2">{attestationError}</p>
          {/if}
        </div>
      </div>
    </div>
  {/if}
  
  <!-- GitHub Identity Section (NIP-39) -->
  <Field>
    {#snippet label()}
      <p>GitHub Identity <span class="text-xs text-gray-500">(NIP-39)</span></p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <Icon icon="git" />
        <input 
          bind:value={values.githubIdentity.username} 
          class="grow" 
          type="text" 
          placeholder="your-github-username"
        />
      </label>
    {/snippet}
    {#snippet info()}
      Your GitHub username for identity verification.
    {/snippet}
  </Field>
  
  {#if values.githubIdentity?.username}
    <Field>
      {#snippet label()}
        <p>GitHub Proof <span class="text-xs text-gray-500">(Gist ID)</span></p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon="link-round" />
          <input 
            bind:value={values.githubIdentity.proof} 
            class="grow" 
            type="text" 
            placeholder="abc123def456"
          />
        </label>
      {/snippet}
      {#snippet info()}
        {#if !shouldOfferAutoAttestation() && !values.githubIdentity?.proof}
          <p class="text-sm">
            Create a GitHub Gist with the text: <br/>
            <code class="bg-gray-100 px-1 rounded text-xs break-all">
              Verifying that I control the following Nostr public key: {npub}
            </code><br/>
            Then paste the Gist ID here.
          </p>
        {:else if values.githubIdentity?.proof}
          <p class="text-sm">
            Your verification Gist is available at:<br/>
            <a 
              href="https://gist.github.com/{values.githubIdentity?.username}/{values.githubIdentity?.proof}" 
              target="_blank" 
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 underline text-xs mt-1"
            >
              <Icon icon="link-round" size={3} />
              https://gist.github.com/{values.githubIdentity?.username}/{values.githubIdentity?.proof}
            </a>
          </p>
        {:else}
          <p class="text-sm text-gray-500">
            Gist ID will be automatically filled when you use the auto-verification above.
          </p>
        {/if}
      {/snippet}
    </Field>
  {/if}
  
  {#if !hideAddress}
    <Field>
      {#snippet label()}
        <p>Nostr Address</p>
      {/snippet}
      {#snippet input()}
        <label class="input input-bordered flex w-full items-center gap-2">
          <Icon icon={MapPoint} />
          <input bind:value={values.profile.nip05} class="grow" type="text" />
        </label>
      {/snippet}
      {#snippet info()}
        <p>
          <Button class="link" onclick={() => pushModal(InfoHandle)}
            >What is a nostr address?</Button>
        </p>
      {/snippet}
    </Field>
  {/if}
  {#if !isSignup}
    <FieldInline>
      {#snippet label()}
        <p>Broadcast Profile</p>
      {/snippet}
      {#snippet input()}
        <input
          type="checkbox"
          class="toggle toggle-primary"
          bind:checked={values.shouldBroadcast} />
      {/snippet}
      {#snippet info()}
        <p>
          If enabled, changes will be published to the broader nostr network in addition to spaces
          you are a member of.
        </p>
      {/snippet}
    </FieldInline>
  {/if}
  {@render footer()}
</form>
