<script lang="ts">
  import {displayPubkey} from "@welshman/util"
  import {deriveHandleForPubkey, displayHandle} from "@welshman/app"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import {deriveBudabitProfileDisplay} from "@app/core/profile-resolver"

  type Props = {
    value: string
    url?: string
  }

  const {value, url}: Props = $props()

  const pubkey = value
  const profileDisplay = deriveBudabitProfileDisplay(pubkey, {url})
  const handle = deriveHandleForPubkey(pubkey)
</script>

<div class="flex max-w-full gap-3">
  <div class="py-1">
    <ProfileCircle {pubkey} {url} />
  </div>
  <div class="flex min-w-0 flex-col">
    <div class="flex items-center gap-2">
      <div class="text-bold overflow-hidden text-ellipsis text-base">
        {$profileDisplay}
      </div>
    </div>
    <div class="overflow-hidden text-ellipsis text-sm opacity-75">
      {$handle ? displayHandle($handle) : displayPubkey(pubkey)}
    </div>
  </div>
</div>
