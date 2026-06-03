<script lang="ts">
  import { setContext } from "svelte";
  import { REGISTRY, defaultRegistry, type Registry } from "./internal/component-registry";
  import { SIGNER_CONTEXT } from "./internal/signer-context";
  import { type SignerContext, defaultSignerContext } from "./types/signer";

  type RegistryOverrides = Record<string, any>;
  const {
    components = {},
    signerContext = defaultSignerContext,
    children,
  } = $props<{
    components?: RegistryOverrides;
    signerContext?: SignerContext;
    children?: any;
  }>();

  const registry: Registry = { ...defaultRegistry, ...(components as Partial<Registry>) };
  setContext(REGISTRY, registry);
  setContext(SIGNER_CONTEXT, signerContext);
</script>

{@render children()}
