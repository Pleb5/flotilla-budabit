import { getBestCompatibleMint } from './submission';
import type { LoomWorker } from './types';

export interface WalletPromptState {
  selectedMint: string;
  autoTokenPromptOpen: boolean;
  autoTokenPromptKey: string;
  autoTokenDismissedKey: string;
}

/**
 * Picks a sensible mint for the selected worker. Payment amount is owned
 * by the form's number input and is not touched here.
 *
 * A current selection that is still valid for the worker (i.e. in
 * compatibleMints) is preserved — a deliberate user pick sticks. The
 * best-balance compatible mint is only filled in when nothing valid is
 * selected (initial state, or the worker changed and no longer accepts it).
 */
export function reconcileWalletSelection(args: {
  selectedWorker: LoomWorker | null;
  compatibleMints: string[];
  walletBalancesByMint: Record<string, number>;
  selectedMint: string;
}) {
  const { selectedWorker, compatibleMints, walletBalancesByMint, selectedMint } = args;
  if (!selectedWorker) return { selectedMint };

  if (selectedMint && compatibleMints.includes(selectedMint)) return { selectedMint };

  const bestCompatibleMint = getBestCompatibleMint(compatibleMints, walletBalancesByMint);
  const nextSelectedMint =
    bestCompatibleMint && selectedMint !== bestCompatibleMint ? bestCompatibleMint : selectedMint;
  return { selectedMint: nextSelectedMint };
}

export function reconcileAutoTokenPrompt(args: {
  autoTokenCandidateKey: string;
  autoTokenPromptKey: string;
  autoTokenDismissedKey: string;
  generatingPaymentToken: boolean;
}) {
  const {
    autoTokenCandidateKey,
    autoTokenPromptKey,
    autoTokenDismissedKey,
    generatingPaymentToken,
  } = args;

  if (!autoTokenCandidateKey) {
    return {
      autoTokenPromptOpen: false,
      autoTokenPromptKey: '',
    };
  }

  if (autoTokenCandidateKey === autoTokenDismissedKey || generatingPaymentToken) {
    return {
      autoTokenPromptOpen: false,
      autoTokenPromptKey,
    };
  }

  if (autoTokenCandidateKey !== autoTokenPromptKey) {
    return {
      autoTokenPromptOpen: true,
      autoTokenPromptKey: autoTokenCandidateKey,
    };
  }

  return {
    autoTokenPromptOpen: true,
    autoTokenPromptKey,
  };
}
