<script lang="ts">
  import type {CashuTokenStatus} from "@app/core/cashu-token-status"
  import {cashuTokenPresentation} from "@app/util/cashu-token-status"
  import ClickHelp from "@lib/components/ClickHelp.svelte"
  const {status}: {status?: CashuTokenStatus} = $props()
  const display = $derived(cashuTokenPresentation(status))
</script>

<span
  class={display.tone === "success"
    ? "text-success"
    : display.tone === "warning"
      ? "text-warning"
      : "text-base-content/65"}>
  <ClickHelp label={display.label} text={display.help} />
</span>
