import { toRepoNostrUrl } from './nip07'
import type { LoomWorker, RepoContextNormalized, RerunDraft } from './types'

export function getSelectedWorker(draft: RerunDraft | null, workers: LoomWorker[]): LoomWorker | null {
  return draft?.workerPubkey
    ? workers.find(worker => worker.pubkey === draft.workerPubkey) || null
    : null
}

export function getCompatibleMints(selectedWorker: LoomWorker | null, walletMints: string[]) {
  if (!selectedWorker) return walletMints
  const workerMints = selectedWorker.mints || []
  return walletMints.filter(mint => workerMints.includes(mint))
}

export function getVisibleMintOptions(compatibleMints: string[], walletMints: string[]) {
  return compatibleMints.length > 0 ? compatibleMints : walletMints
}

export function getBestCompatibleMint(
  compatibleMints: string[],
  walletBalancesByMint: Record<string, number>
) {
  return (
    compatibleMints
      .slice()
      .sort((a, b) => (walletBalancesByMint[b] || 0) - (walletBalancesByMint[a] || 0))[0] || ''
  )
}

export function canGenerateSuggestedToken(args: {
  walletAvailable: boolean
  selectedMint: string
  paymentAmount: number
  walletBalancesByMint: Record<string, number>
}) {
  const { walletAvailable, selectedMint, paymentAmount, walletBalancesByMint } = args
  return walletAvailable && !!selectedMint && paymentAmount > 0 && (walletBalancesByMint[selectedMint] || 0) >= paymentAmount
}

export function createNewRunDraft(repo: RepoContextNormalized): RerunDraft | null {
  if (!repo.repoAddress) return null

  const publishRelays = Array.from(new Set([...repo.repoRelays, 'wss://relay.sharegap.net', 'wss://nos.lol']))

  return {
    repoAddress: repo.repoAddress,
    workflowPath: '',
    branch: 'main',
    commit: '',
    workerPubkey: '',
    command: 'bash',
    args: ['-lc', 'echo "Runner script will be injected at submit time"'],
    envVars: [{ key: '', value: '' }],
    repoNostrUrl: toRepoNostrUrl(repo.repoAddress, publishRelays),
    publishRelays,
  }
}
