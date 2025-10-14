<script lang="ts">
  import {nthNe} from "@welshman/lib"
  import type {Profile} from "@welshman/util"
  import {
    getTag,
    makeEvent,
    makeProfile,
    editProfile,
    createProfile,
    isPublishedProfile,
    uniqTags,
  } from "@welshman/util"
  import {Router} from "@welshman/router"
  import {pubkey, profilesByPubkey, publishThunk} from "@welshman/app"
  import Button from "@lib/components/Button.svelte"
  import ProfileEditForm from "@app/components/ProfileEditForm.svelte"
  import {clearModals} from "@app/util/modal"
  import {pushToast} from "@app/util/toast"
  import {PROTECTED} from "@app/core/state"
  import {updateProfile} from "../core/commands"

  const profile = $profilesByPubkey.get($pubkey!) || makeProfile()
  const shouldBroadcast = !getTag(PROTECTED, profile.event?.tags || [])
  const initialValues = {profile, shouldBroadcast}

  const back = () => history.back()

  const onsubmit = ({profile, shouldBroadcast, githubIdentity}: {profile: Profile; shouldBroadcast: boolean; githubIdentity?: {username: string; proof: string}}) => {
    const router = Router.get()
    const template = isPublishedProfile(profile) ? editProfile(profile) : createProfile(profile)
    const scenarios = [router.FromRelays(getMembershipUrls($userMembership))]
    
    // Handle NIP-39 GitHub identity
    if (githubIdentity?.username && githubIdentity?.proof) {
      // Remove existing GitHub identity tags
      template.tags = template.tags.filter(tag => 
        !(tag[0] === 'i' && tag[1]?.startsWith('github:'))
      )
      
      // Add new GitHub identity tag
      const githubTag = ['i', `github:${githubIdentity.username}`, githubIdentity.proof]
      template.tags.push(githubTag)
    } else {
      // Remove GitHub identity tags if no identity provided
      template.tags = template.tags.filter(tag => 
        !(tag[0] === 'i' && tag[1]?.startsWith('github:'))
      )
    }

    if (shouldBroadcast) {
      scenarios.push(router.FromUser(), router.Index())
      template.tags = template.tags.filter(nthNe(0, "-"))
    } else {
      template.tags = uniqTags([...template.tags, PROTECTED])
    }

    const event = makeEvent(template.kind, template)
    const relays = router.merge(scenarios).getUrls()

    publishThunk({event, relays})
    pushToast({message: "Your profile has been updated!"})
    clearModals()
  }
</script>

<ProfileEditForm {initialValues} {onsubmit} pubkey={$pubkey!}>
  {#snippet footer()}
    <div class="mt-4 flex flex-row items-center justify-between gap-4">
      <Button class="btn btn-neutral" onclick={back}>Discard Changes</Button>
      <Button type="submit" class="btn btn-primary">Save Changes</Button>
    </div>
  {/snippet}
</ProfileEditForm>
