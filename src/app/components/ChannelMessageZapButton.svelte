<script lang="ts">
  import Bolt from "@assets/icons/bolt.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import ZapButton from "@app/components/ZapButton.svelte"

  const {event, relays = [], scopeH = ""} = $props()
</script>

<ZapButton {event} relayHints={relays} {scopeH} class="btn join-item btn-xs">
  <Icon icon={Bolt} size={4} />
</ZapButton>
