import type { WidgetBridge } from '@flotilla/ext-shared';
import {
  generatePaymentTokenController,
  loadRunDetailController,
  refreshWalletController,
  submitRunController,
} from './controllers';
import { createClosedDetailSessionState, createOpenedDetailSessionState } from './detail-session';
import type { DetailSessionState } from './detail-session';
import type { RepoContextNormalized, RerunDraft } from './types';

export async function refreshWalletViewModel(args: { bridge: WidgetBridge; selectedMint: string }) {
  const state = await refreshWalletController(args.bridge, args.selectedMint);

  return {
    walletAvailable: true,
    walletTotalBalance: state.totalBalance,
    walletBalancesByMint: state.balancesByMint,
    walletMints: state.mints,
    selectedMint: state.nextSelectedMint,
  };
}

export async function generatePaymentTokenViewModel(args: {
  bridge: WidgetBridge;
  paymentAmount: number;
  selectedMint: string;
  submissionMode: 'new' | 'rerun' | null;
}) {
  if (!args.selectedMint) {
    throw new Error('Select a mint first.');
  }

  if (args.paymentAmount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const rerunPaymentToken = await generatePaymentTokenController(
    args.bridge,
    args.paymentAmount,
    args.selectedMint,
    args.submissionMode
  );

  const walletState = await refreshWalletViewModel({
    bridge: args.bridge,
    selectedMint: args.selectedMint,
  });

  return {
    rerunPaymentToken,
    ...walletState,
  };
}

export async function submitRunViewModel(args: {
  bridge: WidgetBridge;
  repo: RepoContextNormalized;
  signerPubkey: string;
  submissionMode: 'new' | 'rerun' | null;
  rerunCommandMode: 'reuse' | 'regenerate';
  rerunDraft: RerunDraft;
  rerunArgsText: string;
  rerunPaymentToken: string;
  runnerScriptTemplate: string;
  rerunSecrets: Array<{ key: string; value: string }>;
}) {
  const runId = await submitRunController({
    bridge: args.bridge,
    signerPubkey: args.signerPubkey,
    submissionMode: args.submissionMode,
    rerunCommandMode: args.rerunCommandMode,
    rerunDraft: args.rerunDraft,
    rerunArgsText: args.rerunArgsText,
    rerunPaymentToken: args.rerunPaymentToken,
    runnerScriptTemplate: args.runnerScriptTemplate,
    rerunSecrets: args.rerunSecrets,
  });

  // The run-list subscription will pick up the new run; open the detail directly.
  let detailSessionState: DetailSessionState = createClosedDetailSessionState();
  if (runId) {
    const detail = await loadRunDetailController(args.bridge, args.repo, runId);
    detailSessionState = createOpenedDetailSessionState(detail);
  }

  return {
    runId,
    detailSessionState,
  };
}
