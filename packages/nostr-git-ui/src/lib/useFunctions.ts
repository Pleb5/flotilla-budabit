import { getContext } from "svelte";
import {
  FUNCTION_REGISTRY,
  type FunctionRegistry,
  defaultFunctions,
} from "./internal/function-registry";

/**
 * Hook to access the registered functions
 * @returns All registered functions from the context or default implementations
 */
export function useFunctions(): FunctionRegistry {
  const functions = getContext<FunctionRegistry>(FUNCTION_REGISTRY);

  // Return functions from context if available, otherwise return defaults
  return functions || defaultFunctions;
}

/**
 * Get a specific function from the registry
 * @param functionName The name of the function to retrieve
 * @returns The requested function
 */
export function useFunction<K extends keyof FunctionRegistry>(
  functionName: K
): FunctionRegistry[K] {
  const functions = useFunctions();
  return functions[functionName];
}
