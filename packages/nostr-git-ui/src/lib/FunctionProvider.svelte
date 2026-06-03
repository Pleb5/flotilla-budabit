<script lang="ts">
  import { setContext } from "svelte";
  import {
    FUNCTION_REGISTRY,
    defaultFunctions,
    type FunctionRegistry,
  } from "./internal/function-registry";

  const { functions = {}, children } = $props<{
    functions?: Partial<FunctionRegistry>;
    children?: any;
  }>();

  // Merge provided functions with default implementations
  const registry: FunctionRegistry = { ...defaultFunctions, ...functions };

  // Make functions available via context
  setContext(FUNCTION_REGISTRY, registry);
</script>

{@render children()}
