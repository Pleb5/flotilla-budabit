import { getContext } from "svelte";
import { SIGNER_CONTEXT } from "../internal/signer-context";
import { type SignerContext, defaultSignerContext } from "../types/signer";

/**
 * Get the signer context from Svelte context
 */
export function getSignerContext(): SignerContext {
  const context = getContext<SignerContext>(SIGNER_CONTEXT);
  return context || defaultSignerContext;
}

/**
 * Check if signer is ready for operations
 */
export function isSignerReady(context?: SignerContext): boolean {
  const ctx = context || getSignerContext();
  return ctx.isReady && ctx.signer !== null && ctx.pubkey !== null;
}
