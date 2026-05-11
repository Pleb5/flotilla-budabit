<script lang="ts">
  import SettingsMinimalistic from "@assets/icons/settings-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Page from "@lib/components/Page.svelte"
  import PageBar from "@lib/components/PageBar.svelte"
  import PageContent from "@lib/components/PageContent.svelte"
  import MenuSpacesItem from "@app/components/MenuSpacesItem.svelte"
  import {PLATFORM_RELAYS} from "@app/core/state"
</script>

<Page class="cw-full">
  <PageBar class="cw-full">
    {#snippet icon()}
      <div class="center">
        <Icon icon={SettingsMinimalistic} />
      </div>
    {/snippet}
    {#snippet title()}
      <strong>Your Spaces</strong>
    {/snippet}
  </PageBar>
  <PageContent class="cw-full flex flex-col gap-2 p-2 pt-4">
    {#each PLATFORM_RELAYS as url (url)}
      <MenuSpacesItem {url} />
    {:else}
      <div class="flex flex-col gap-8 items-center py-20 text-center">
        <p>No platform relays are configured.</p>
      </div>
    {/each}
  </PageContent>
</Page>
