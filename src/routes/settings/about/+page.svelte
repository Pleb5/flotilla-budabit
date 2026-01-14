<script lang="ts">
  import Link from "@lib/components/Link.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import {PLATFORM_NAME} from "@app/core/state"
  import Code from "@assets/icons/code-2.svg?dataurl"

  const hash = import.meta.env.VITE_BUILD_HASH

</script>

<div class="mt-8 min-h-screen bg-base-200 sm:hero">
  <div class="hero-content">
    <div class="column content gap-6">
      <p class="text-center text-2xl">Thanks for using</p>
      <h1 class="mb-4 text-center text-5xl font-bold uppercase">{PLATFORM_NAME}</h1>
      <div class="flex flex-col gap-4">
        <div class="items-center text-center">
          {#if hash}
            <p class="text-xs">Running build {hash.slice(0, 8)}</p>
          {/if}
        </div>
        <div class="flex justify-center gap-4">
          <div class="tooltip" data-tip="Source Code">
            <Link
              external 
              href="https://budabit.club/spaces/budabit.nostr1.com/git/naddr1qvzqqqrhnypzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqqgxvmr0w35kcmrp94382erpvf5hgqtk2vr"
              class="btn btn-secondary"
            >
              <div class="flex items-center gap-x-2">
                Source Code
                <Icon icon={Code} />
              </div>
            </Link>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
