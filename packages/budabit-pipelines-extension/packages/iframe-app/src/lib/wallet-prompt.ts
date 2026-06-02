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
 */
export function reconcileWalletSelection(args: {
  selectedWorker: LoomWorker | null;
  compatibleMints: string[];
  walletBalancesByMint: Record<string, number>;
  selectedMint: string;
}) {
  const { selectedWorker, compatibleMints, walletBalancesByMint, selectedMint } = args;
  if (!selectedWorker) return { selectedMint };

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
