<script lang="ts">
  import Letter from "@assets/icons/letter-opened.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
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

<div class="flex items-center gap-2 border-t border-solid border-base-100 px-4 py-2 {className}">
  <button
    type="button"
    class="flex min-w-0 flex-1 items-center gap-2 rounded-box text-left"
    onclick={openProfile}>
    <ProfileCircle pubkey={result.pubkey} size={5} />
    <div class="min-w-0 flex-1">
      <div class="truncate text-sm font-semibold">
        <ProfileName pubkey={result.pubkey} />
      </div>
      <div class="truncate text-[11px] leading-4 opacity-60">{result.label}</div>
    </div>
  </button>
  <Link
    href={chatPath}
    class="btn btn-primary btn-square btn-xs shrink-0">
    <Icon icon={Letter} size={4} />
  </Link>
</div>
