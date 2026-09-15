<script lang="ts">
  import {makeProfile} from "@welshman/util"
  import {get} from "svelte/store"
  import {pubkey, profilesByPubkey, forceLoadProfile, repository} from "@welshman/app"
  import {getBudabitProfileRelays} from "@app/core/profile-resolver"
  import {loadProfileIdentities} from "@app/core/profile-identities"
  import {
    IDENTITY_KIND,
    readGitHubIdentity,
    selectIdentityEvent,
    type ProfileValues,
  } from "@app/util/profile-identity"
  import Button from "@lib/components/Button.svelte"
  import ProfileEditForm from "@app/components/ProfileEditForm.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {PROFILE_PUBLISH_RETRY_MESSAGE, updateProfile} from "@app/core/commands"

  let initialValues = $state<ProfileValues>()
  let loadError = $state("")
  let retry = $state(0)

  $effect(() => {
    const key = $pubkey
    void retry
    if (!key) return
    let current = true
    initialValues = undefined
    loadError = ""
    void Promise.all([
      forceLoadProfile(key, getBudabitProfileRelays({includeActiveCommunityRelays: true})),
      loadProfileIdentities(key, [], true),
    ])
      .then(() => {
        if (!current) return
        const profile = get(profilesByPubkey).get(key) || makeProfile()
        const identities = selectIdentityEvent(
          repository.query([{kinds: [IDENTITY_KIND], authors: [key]}]),
          key,
        )
        initialValues = {profile, githubIdentity: readGitHubIdentity(profile, identities)}
      })
      .catch(() => {
        if (current)
          loadError =
            "Could not load your profile and identity proofs. Please retry before editing."
      })
    return () => {
      current = false
    }
  })

  let saving = $state(false)

  const back = () => history.back()

  const onsubmit = async (values: ProfileValues) => {
    if (saving) return

    saving = true

    try {
      await updateProfile(values)
      pushToast({message: "Your profile has been updated!"})
      clearModals()
    } catch (error) {
      pushToast({
        theme: "error",
        message: `${error instanceof Error ? error.message : "Failed to update profile"} ${PROFILE_PUBLISH_RETRY_MESSAGE}`,
      })
    } finally {
      saving = false
    }
  }
</script>

{#if loadError}
  <p role="alert" class="text-error">{loadError}</p>
  <Button class="btn btn-neutral" onclick={() => retry++}>Retry loading profile</Button>
{:else if initialValues}
  <ProfileEditForm {initialValues} {onsubmit} pubkey={$pubkey!}>
    {#snippet footer()}
      <div class="mt-4 flex flex-row items-center justify-between gap-4">
        <Button class="btn btn-neutral" onclick={back} disabled={saving}>Discard Changes</Button>
        <Button type="submit" class="btn btn-primary" disabled={saving}>
          {saving ? "Saving..." : "Save Changes"}
        </Button>
      </div>
    {/snippet}
  </ProfileEditForm>
{:else}
  <p role="status" class="py-6 text-center opacity-70">Loading profile and identity proofs…</p>
{/if}
