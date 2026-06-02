<script lang="ts">
  import Link from "@lib/components/Link.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import Code from "@assets/icons/code-2.svg?dataurl"

  const hash = import.meta.env.VITE_BUILD_HASH
</script>

<div class="mt-8 min-h-screen bg-base-200 sm:hero">
  <div class="hero-content">
    <div class="column content gap-6">
      <h1 class="mb-4 text-center text-5xl font-bold uppercase">Thanks for using BudaBit!</h1>
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
              href="https://github.com/Pleb5/flotilla-budabit"
              class="btn btn-secondary">
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
