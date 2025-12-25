<script lang="ts">
  import { ConfigProvider, NewRepoWizard } from "@nostr-git/ui"
  
  const props = $props()
</script>

<ConfigProvider>
  <NewRepoWizard {...props} />
</ConfigProvider>
