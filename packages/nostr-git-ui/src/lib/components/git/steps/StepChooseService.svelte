<script lang="ts">
  import ProviderSelectionStep from "../ProviderSelectionStep.svelte";

  interface Props {
    selectedProviders: string[];
    relayUrls?: string[];
    disabledProviders?: string[];
    onProvidersChange: (providers: string[]) => void;
    onRelayUrlsChange?: (urls: string[]) => void;
    graspServerOptions?: string[];
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
    selectedProviders={selectedProviders}
    onProvidersChange={onProvidersChange as any}
    disabledProviders={disabledProviders}
    relayUrls={relayUrls || []}
    onRelayUrlsChange={onRelayUrlsChange as any}
    graspServerOptions={graspServerOptions}
  />
</div>
