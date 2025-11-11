<script lang="ts">
  import { ConfigProvider, RepoPicker } from "@nostr-git/ui"
  import Profile from "@app/components/Profile.svelte"
  
  const props = $props()
</script>

<ConfigProvider
  components={{
    ProfileComponent: Profile as typeof import("@nostr-git/ui").Profile,
  }}>
  <RepoPicker {...props} />
</ConfigProvider>

