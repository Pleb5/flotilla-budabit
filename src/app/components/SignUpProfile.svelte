<script lang="ts">
  import type {Profile} from "@welshman/util"
  import {makeProfile} from "@welshman/util"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import ProfileEditForm from "@app/components/ProfileEditForm.svelte"
  import SignUpKey from "@app/components/SignUpKey.svelte"
  import {pushModal} from "@app/util/modal"

  const initialValues = {
    profile: makeProfile(),
    shouldBroadcast: false,
  }

  const onsubmit = ({
    profile,
    shouldBroadcast,
    githubIdentity,
  }: {
    profile: Profile;
    shouldBroadcast: boolean;
    githubIdentity?: {username: string; proof: string}
  }) => {
    const template = createProfile(profile)
    
    // Handle NIP-39 GitHub identity
    if (githubIdentity?.username && githubIdentity?.proof) {
      const githubTag = ['i', `github:${githubIdentity.username}`, githubIdentity.proof]
      template.tags.push(githubTag)
    }
    
    const event = makeEvent(PROFILE, template)
    const relays = shouldBroadcast ? INDEXER_RELAYS : []

  const onsubmit = (values: {profile: Profile}) => pushModal(SignUpKey, values)
</script>

<div class="flex flex-col gap-4">
  <ProfileEditForm isSignup {initialValues} {onsubmit}>
    {#snippet footer()}
      <ModalFooter>
        <Button class="btn btn-link" onclick={back}>
          <Icon icon={AltArrowLeft} />
          Go back
        </Button>
        <Button class="btn btn-primary" type="submit">
          Create Account
          <Icon icon={AltArrowRight} />
        </Button>
      </ModalFooter>
    {/snippet}
  </ProfileEditForm>
</div>
