<script lang="ts">
  import {slideAndFade} from "@lib/transition"
  import AltArrowDown from "@assets/icons/alt-arrow-down.svg?dataurl"
  import AltArrowUp from "@assets/icons/alt-arrow-up.svg?dataurl"
  import TrashBin2 from "@assets/icons/trash-bin-2.svg?dataurl"
  import Button from "@lib/components/Button.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ProfileDelete from "@app/components/ProfileDelete.svelte"
  import {pushModal} from "@app/util/modal"

  let showAdvanced = $state(false)

  const startDelete = () => pushModal(ProfileDelete)

  const toggleAdvanced = () => (showAdvanced = !showAdvanced)
</script>

<div class="card2 bg-alt shadow-md">
  <Button
    class="flex w-full items-center justify-between gap-3"
    aria-expanded={showAdvanced}
    onclick={toggleAdvanced}>
    <strong>Advanced</strong>
    {#if showAdvanced}
      <Icon icon={AltArrowUp} />
    {:else}
      <Icon icon={AltArrowDown} />
    {/if}
  </Button>
  {#if showAdvanced}
    <div transition:slideAndFade class="flex flex-col gap-2 pt-4">
      <Button class="btn btn-outline btn-error" onclick={startDelete}>
        <Icon icon={TrashBin2} />
        Delete your profile
      </Button>
    </div>
  {/if}
</div>
