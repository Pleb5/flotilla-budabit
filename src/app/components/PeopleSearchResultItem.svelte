<script lang="ts">
  import UserCircle from "@assets/icons/user-circle.svg?dataurl"
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import Button from "@lib/components/Button.svelte"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import {pushModal} from "@app/util/modal"
  import {makeChatPath} from "@app/util/routes"
  import type {PeopleSearchResult} from "@app/util/people-search"

  type Props = {
    result: PeopleSearchResult
    class?: string
  }

  const {result, class: className = ""}: Props = $props()

  const openProfile = () => pushModal(ProfileDetail, {pubkey: result.pubkey})
  const chatPath = $derived(makeChatPath(result.pubkey))
</script>

<div class="flex items-center gap-2 border-t border-solid border-base-100 px-6 py-2 {className}">
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-2 text-left"
    onclick={openProfile}>
    <ProfileCircle pubkey={result.pubkey} size={5} />
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-semibold">
        <ProfileName pubkey={result.pubkey} />
      </div>
    </div>
  </button>
  <Button class="btn btn-ghost btn-xs" onclick={openProfile}>
    <Icon icon={UserCircle} size={4} />
  </Button>
  <Link href={chatPath} class="btn btn-primary btn-xs">
    <Icon icon={Letter} size={4} />
    Message
  </Link>
</div>
