<script lang="ts">
  import {ConfigProvider, ImportRepoDialog} from "@nostr-git/ui"

  const props = $props()
</script>

<ConfigProvider>
  <ImportRepoDialog {...props} />
</ConfigProvider>
