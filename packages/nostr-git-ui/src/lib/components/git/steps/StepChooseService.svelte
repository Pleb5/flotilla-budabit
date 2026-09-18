<script lang="ts">
  import ProviderSelectionStep from "../ProviderSelectionStep.svelte";
  import type { RemoteTargetOption } from "../../../utils/remote-targets.js";

  interface Props {
    selectedProviders: string[];
    relayUrls?: string[];
    disabledProviders?: string[];
    onProvidersChange: (providers: string[]) => void;
    onRelayUrlsChange?: (urls: string[]) => void;
    graspServerOptions?: string[];
    importing?: boolean;
    accountChecks?: RemoteTargetOption[];
    checkingAccounts?: boolean;
  }

  const __props = $props();
  const selectedProviders = $derived(__props.selectedProviders || []);
  const relayUrls = $derived(__props.relayUrls);
  const disabledProviders = $derived(__props.disabledProviders ?? []);
  const onProvidersChange = $derived(__props.onProvidersChange);
  const onRelayUrlsChange = $derived(__props.onRelayUrlsChange);
  const graspServerOptions = $derived(__props.graspServerOptions ?? []);
</script>

<div class="space-y-4">
  <ProviderSelectionStep
    importing={__props.importing ?? false}
    selectedProviders={selectedProviders}
    onProvidersChange={onProvidersChange as any}
    disabledProviders={disabledProviders}
    relayUrls={relayUrls || []}
    onRelayUrlsChange={onRelayUrlsChange as any}
    graspServerOptions={graspServerOptions}
    accountChecks={__props.accountChecks}
    checkingAccounts={__props.checkingAccounts}
  />
</div>
