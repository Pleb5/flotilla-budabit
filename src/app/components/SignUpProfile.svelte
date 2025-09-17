<script lang="ts">
  import type {Profile} from "@welshman/util"
  import {PROFILE, createProfile, makeProfile, makeEvent} from "@welshman/util"
  import {loginWithNip01, publishThunk} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import ProfileEditForm from "@app/components/ProfileEditForm.svelte"
  import {INDEXER_RELAYS} from "@app/state"

  type Props = {
    secret: string
    pubkey: string
  }

  const {secret, pubkey}: Props = $props()

  const initialValues = {
    profile: makeProfile(),
    shouldBroadcast: true,
  }

  const onsubmit = ({
    profile,
    shouldBroadcast,
    githubIdentity,
  }: {
    profile: Profile
    shouldBroadcast: boolean
    githubIdentity?: {username: string; proof: string}
  }) => {
    const template = createProfile(profile)

    // Handle NIP-39 GitHub identity
    if (githubIdentity?.username && githubIdentity?.proof) {
      const githubTag = ["i", `github:${githubIdentity.username}`, githubIdentity.proof]
      template.tags.push(githubTag)
    }

    const event = makeEvent(PROFILE, template)
    const relays = shouldBroadcast ? INDEXER_RELAYS : []

    loginWithNip01(secret)
    publishThunk({event, relays})
  }
</script>

<ProfileEditForm {pubkey} hideAddress {initialValues} {onsubmit}>
  {#snippet footer()}
    <Button type="submit" class="btn btn-primary">Create Account</Button>
  {/snippet}
</ProfileEditForm>
