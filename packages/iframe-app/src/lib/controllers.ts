import type { WidgetBridge } from '@flotilla/ext-shared'
import { buildScriptArgs } from './blossom'
import { loadWorkflowRunDetail, loadWorkers } from './workflows'
import { createCashuPaymentToken, loadCashuWalletState } from './wallet'
import { submitRerun } from './nip07'
import type { LoomWorker, RepoContextNormalized, RerunDraft, WorkflowRunDetail } from './types'

export async function loadRunDetailController(
  bridge: WidgetBridge,
  repo: RepoContextNormalized,
  runId: string
): Promise<WorkflowRunDetail | null> {
  return loadWorkflowRunDetail(bridge, repo, runId)
}

export async function refreshWorkersController(
  bridge: WidgetBridge,
  repo: RepoContextNormalized,
  currentWorkerPubkey?: string
): Promise<{ workers: LoomWorker[]; nextWorkerPubkey: string }> {
  const workers = await loadWorkers(bridge, repo)
  return {
    workers,
    nextWorkerPubkey: currentWorkerPubkey || workers[0]?.pubkey || '',
  }
}

export async function refreshWalletController(
  bridge: WidgetBridge,
  selectedMint: string
): Promise<{
  totalBalance: number
  balancesByMint: Record<string, number>
  mints: string[]
  nextSelectedMint: string
}> {
  const state = await loadCashuWalletState(bridge)
  return {
    totalBalance: state.totalBalance,
    balancesByMint: state.balancesByMint,
    mints: state.mints,
    nextSelectedMint:
      selectedMint && state.mints.includes(selectedMint) ? selectedMint : state.mints[0] || '',
  }
}

export async function generatePaymentTokenController(
  bridge: WidgetBridge,
  amount: number,
  mintUrl: string,
  submissionMode: 'new' | 'rerun' | null
): Promise<string> {
  return createCashuPaymentToken(
    bridge,
    amount,
    mintUrl,
    submissionMode === 'new' ? 'CI/CD pipeline runner' : 'CI/CD pipeline rerun'
  )
}

export async function submitRunController(args: {
  bridge: WidgetBridge
  signerPubkey: string
  submissionMode: 'new' | 'rerun' | null
  rerunCommandMode: 'reuse' | 'regenerate'
  rerunDraft: RerunDraft
  rerunArgsText: string
  rerunPaymentToken: string
  runnerScriptTemplate: string
  rerunSecrets: Array<{ key: string; value: string }>
}) {
  const {
    bridge,
    signerPubkey,
    submissionMode,
    rerunCommandMode,
    rerunDraft,
    rerunArgsText,
    rerunPaymentToken,
    runnerScriptTemplate,
    rerunSecrets,
  } = args

  if (!rerunDraft.workerPubkey) {
    throw new Error('Worker pubkey is required. Please select a worker.')
  }

  if (!rerunDraft.workflowPath && submissionMode === 'new') {
    throw new Error('Workflow path is required.')
  }

  if (!rerunPaymentToken.trim()) {
    throw new Error('Payment token is required.')
  }

  const nextDraft: RerunDraft = {
    ...rerunDraft,
    envVars: rerunDraft.envVars.map(entry => ({ ...entry })),
    args: rerunArgsText
      .split('\n')
      .map(value => value.trim())
      .filter(Boolean),
  }

  if (submissionMode === 'new' || (submissionMode === 'rerun' && rerunCommandMode === 'regenerate')) {
    nextDraft.command = 'bash'
    nextDraft.args = await buildScriptArgs(bridge, runnerScriptTemplate)
  }

  return submitRerun(
    bridge,
    signerPubkey,
    nextDraft,
    rerunPaymentToken.trim(),
    rerunSecrets
  )
}
