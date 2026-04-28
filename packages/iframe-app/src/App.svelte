<script lang="ts">
  import {untrack} from 'svelte'
  import type {WidgetBridge} from '@flotilla/ext-shared'
  import {
    AlertCircle,
    ArrowLeft,
    ChevronDown,
    Copy,
    ExternalLink,
    FileCheck,
    Play,
    RotateCw,
    SearchX,
    Terminal,
  } from '@lucide/svelte'
  import {friendlyErrorMessage, normalizeRepo} from './lib/context'
  import {
    eventERefs,
    eventSummary,
    eventTagValue,
    externalUrlForEvent,
    mergeEventIntoDetail,
    publicLinkForRun,
    statusLabel,
  } from './lib/workflows'
  import {
    buildAutoTokenCandidateKey,
    formatDuration,
    formatExactTime,
    formatTimeAgo,
    getStatusBadge,
    getStatusColor,
    getStatusIcon,
    shortId,
    suggestedPaymentAmount,
  } from './lib/presentation'
  import {reconcileAutoTokenPrompt, reconcileWalletSelection} from './lib/wallet-prompt'
  import {
    canGenerateSuggestedToken as canGenerateSuggestedTokenValue,
    getCompatibleMints,
    getSelectedWorker,
    getVisibleMintOptions,
  } from './lib/submission'
  import RunSubmissionForm from './lib/components/RunSubmissionForm.svelte'
  import ConsoleOutput from './lib/components/ConsoleOutput.svelte'
  import WorkflowJobs from './lib/components/WorkflowJobs.svelte'
  import ReleaseSigningView from './lib/components/ReleaseSigningView.svelte'
  import UserDisplay from './lib/components/UserDisplay.svelte'
  import FilterDropdown from './lib/components/FilterDropdown.svelte'
  import RunListItem from './lib/components/RunListItem.svelte'
  import RunDetailSidebar from './lib/components/RunDetailSidebar.svelte'
  import RunActionsMenu from './lib/components/RunActionsMenu.svelte'
  import SplitButton from './lib/components/SplitButton.svelte'
  import {getProfileContent} from 'applesauce-core/helpers/profile'
  import {eventStore} from './lib/nostr'
  import {loadRunDetailController} from './lib/controllers'
  import {
    createSubmissionResetState,
    prepareNewRunSubmissionState,
    prepareRerunSubmissionState,
  } from './lib/submission-state'
  import {
    createClosedDetailSessionState,
    createDetailSessionErrorState,
    createOpenedDetailSessionState,
    createOpeningDetailSessionState,
  } from './lib/detail-session'
  import {setupWidgetLifecycle} from './lib/widget-lifecycle'
  import {repoEvents$, repoRuns$} from './lib/workflows'
  import {
    generatePaymentTokenViewModel,
    refreshWalletViewModel,
    refreshWorkersViewModel,
    submitRunViewModel,
  } from './lib/view-model'
  import {buildRunnerScriptTemplate} from './lib/runner-script'
  import {loadRepoMetadata} from './lib/repo'
  import {getJobGroups, parseActLog, parseWorkflowJobsFromYaml} from './lib/cicd'
  import {parseCashuTokenAmount} from './lib/payment'
  import type {
    RepoBranchInfo,
    RepoContext,
    RerunDraft,
    LoomWorker,
    WorkflowDefinition,
    WorkflowRun,
    WorkflowRunDetail,
  } from './lib/types'

  let bridge = $state<WidgetBridge | null>(null)
  let repoCtx = $state<RepoContext | null>(null)
  let repo = $derived(normalizeRepo(repoCtx))

  let loading = $state(false)
  let error = $state<string | null>(null)
  let workflowRuns = $state<WorkflowRun[]>([])

  let detailLoading = $state(false)
  let detailRefreshing = $state(false)
  let detailError = $state<string | null>(null)
  let selectedRunId = $state<string | null>(null)
  let selectedRunDetail = $state<WorkflowRunDetail | null>(null)

  let signerPubkey = $state<string | null>(null)
  let signerError = $state<string | null>(null)

  let rerunDraft = $state<RerunDraft | null>(null)
  let submissionMode = $state<'new' | 'rerun' | null>(null)
  let rerunArgsText = $state('')
  let rerunPaymentToken = $state('')
  let rerunSecrets = $state([{key: '', value: ''}])
  let rerunSubmitting = $state(false)
  let immediateRerunInFlight = $state(false)
  let rerunCommandMode = $state<'reuse' | 'regenerate'>('reuse')
  let maxDuration = $state(900)

  let discoveredWorkers = $state<LoomWorker[]>([])
  let loadingWorkers = $state(false)
  let walletAvailable = $state(false)
  let walletLoading = $state(false)
  let walletError = $state<string | null>(null)
  let walletTotalBalance = $state(0)
  let walletBalancesByMint = $state<Record<string, number>>({})
  let walletMints = $state<string[]>([])
  let selectedMint = $state('')
  let paymentAmount = $state(100)
  let generatingPaymentToken = $state(false)
  let autoTokenPromptOpen = $state(false)
  let autoTokenPromptKey = $state('')
  let autoTokenDismissedKey = $state('')

  let runnerScriptTemplate = $state('')
  let runnerScriptAutoManaged = $state(true)

  let repoWorkflows = $state<WorkflowDefinition[]>([])
  let repoBranches = $state<RepoBranchInfo[]>([])
  let defaultBranch = $state('main')
  let repoMetadataLoading = $state(false)
  let repoMetadataError = $state<string | null>(null)

  let workflowJobsLoading = $state(false)
  let workflowJobsError = $state<string | null>(null)
  let workflowJobs = $state<ReturnType<typeof parseWorkflowJobsFromYaml>>([])
  let workflowFallback = $state<WorkflowDefinition | null>(null)
  let usingWorkflowFallback = $state(false)
  let actLogContent = $state('')
  let actLogError = $state<string | null>(null)
  let loomStdout = $state('')
  let loomStderr = $state('')
  let loomStdoutUrl = $state<string | null>(null)
  let loomStderrUrl = $state<string | null>(null)
  let prepaidAmount = $state<number | null>(null)
  let changeAmount = $state<number | null>(null)

  let searchTerm = $state('')
  let workflowFilter = $state<Set<string>>(new Set())
  let triggerFilter = $state<Set<string>>(new Set())
  let statusFilter = $state<Set<string>>(new Set())
  let branchFilter = $state<Set<string>>(new Set())
  let actorFilter = $state<Set<string>>(new Set())
  let showStalePending = $state(false)

  const STALE_PENDING_MS = 72 * 60 * 60 * 1000

  // Bump on every event store insert so profile-name lookups used in the
  // filtered-runs derivation recompute when a kind-0 loads.
  let profileTick = $state(0)

  let currentView = $state<'pipelines' | 'releases'>('pipelines')

  let detailSeq = 0

  const ACTIVE_RUN_STATUSES = ['pending', 'queued', 'running', 'in_progress'] as const
  const FALLBACK_RELAYS = ['wss://relay.sharegap.net', 'wss://nos.lol']

  let liveDurationSeconds = $state<number | null>(null)

  const selectedWorker = $derived(getSelectedWorker(rerunDraft, discoveredWorkers))
  const compatibleMints = $derived.by(() => getCompatibleMints(selectedWorker, walletMints))
  const visibleMintOptions = $derived(getVisibleMintOptions(compatibleMints, walletMints))
  const canGenerateSuggestedToken = $derived(
    canGenerateSuggestedTokenValue({
      walletAvailable,
      selectedMint,
      paymentAmount,
      walletBalancesByMint,
    }),
  )
  const autoTokenCandidateKey = $derived.by(() =>
    buildAutoTokenCandidateKey({
      draft: rerunDraft,
      selectedWorker,
      selectedMint,
      canGenerateSuggestedToken,
      rerunPaymentToken,
      submissionMode,
      paymentAmount,
    }),
  )
  const availableBranches = $derived(repoBranches.map(branch => branch.name))
  const parsedActJobs = $derived(parseActLog(actLogContent))
  const actJobByName = $derived(new Map(parsedActJobs.map(job => [job.name.toLowerCase(), job])))
  const jobGroups = $derived(getJobGroups(workflowJobs))
  const actualCost = $derived(prepaidAmount !== null ? prepaidAmount - (changeAmount ?? 0) : null)

  async function showToast(message: string, type: 'info' | 'success' | 'warning' | 'error' = 'info') {
    if (!bridge) return

    try {
      await bridge.request('ui:toast', {message, type})
    } catch {
      // pass
    }
  }

  function isActiveRunStatus(status: string | undefined): boolean {
    return !!status && ACTIVE_RUN_STATUSES.includes(status as (typeof ACTIVE_RUN_STATUSES)[number])
  }

  async function copyText(value: string | undefined, label: string) {
    if (!value) return

    try {
      await navigator.clipboard.writeText(value)
      await showToast(`${label} copied`, 'success')
    } catch {
      await showToast(`Unable to copy ${label.toLowerCase()}`, 'error')
    }
  }

  function resetDetailArtifacts() {
    workflowJobsLoading = false
    workflowJobsError = null
    workflowJobs = []
    actLogContent = ''
    actLogError = null
    loomStdout = ''
    loomStderr = ''
    loomStdoutUrl = null
    loomStderrUrl = null
    prepaidAmount = null
    changeAmount = null
  }

  function applyDetailSessionState(nextState: ReturnType<typeof createClosedDetailSessionState>) {
    selectedRunId = nextState.selectedRunId
    selectedRunDetail = nextState.selectedRunDetail
    detailError = nextState.detailError
    detailLoading = nextState.detailLoading
    detailRefreshing = false
    if (!nextState.selectedRunDetail) {
      resetDetailArtifacts()
    }
  }

  async function refreshSelectedRun(background = false) {
    if (!bridge || !repo || !selectedRunId) return

    const seq = ++detailSeq
    if (background) {
      detailRefreshing = true
    }

    try {
      const detail = await loadRunDetailController(bridge, repo, selectedRunId)
      if (seq !== detailSeq) return

      applyDetailSessionState(createOpenedDetailSessionState(detail))
      if (detail?.run) {
        workflowRuns = workflowRuns.map(run => (run.id === detail.run.id ? {...run, ...detail.run} : run))
      }
    } catch (err) {
      if (seq !== detailSeq) return
      if (!background) {
        applyDetailSessionState(
          createDetailSessionErrorState(
            selectedRunId,
            friendlyErrorMessage(err instanceof Error ? err.message : String(err)),
          ),
        )
      } else {
        detailRefreshing = false
        console.warn('[pipelines] background refreshSelectedRun failed', err)
      }
    } finally {
      if (seq === detailSeq && background) {
        detailRefreshing = false
      }
    }
  }

  async function refreshRepoMetadata() {
    if (!bridge || !repo) {
      console.log('[pipelines] refreshRepoMetadata skipped: bridge=', !!bridge, 'repo=', !!repo)
      return
    }

    repoMetadataLoading = true
    repoMetadataError = null

    try {
      console.log('[pipelines] refreshRepoMetadata: calling repo:listWorkflows...')
      const metadata = await loadRepoMetadata(bridge)
      console.log('[pipelines] refreshRepoMetadata: got', metadata.workflows.length, 'workflows,', metadata.branches.length, 'branches')
      repoWorkflows = metadata.workflows
      repoBranches = metadata.branches
      defaultBranch = metadata.selectedBranch || metadata.defaultBranch || 'main'
    } catch (err) {
      console.error('[pipelines] refreshRepoMetadata error:', err)
      repoMetadataError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      repoMetadataLoading = false
    }
  }

  async function openRunById(runId: string) {
    if (!bridge || !repo || !runId) return
    const seq = ++detailSeq
    applyDetailSessionState({
      selectedRunId: runId,
      selectedRunDetail: null,
      detailError: null,
      detailLoading: true,
    })

    try {
      const detail = await loadRunDetailController(bridge, repo, runId)
      if (seq !== detailSeq) return
      applyDetailSessionState(createOpenedDetailSessionState(detail))
    } catch (err) {
      if (seq !== detailSeq) return
      applyDetailSessionState(
        createDetailSessionErrorState(
          runId,
          friendlyErrorMessage(err instanceof Error ? err.message : String(err)),
        ),
      )
    }
  }

  async function openRun(run: WorkflowRun) {
    if (!bridge || !repo) return

    const seq = ++detailSeq
    applyDetailSessionState(createOpeningDetailSessionState(run))

    try {
      const detail = await loadRunDetailController(bridge, repo, run.id)
      if (seq !== detailSeq) return
      applyDetailSessionState(createOpenedDetailSessionState(detail))
    } catch (err) {
      if (seq !== detailSeq) return
      applyDetailSessionState(
        createDetailSessionErrorState(
          run.id,
          friendlyErrorMessage(err instanceof Error ? err.message : String(err)),
        ),
      )
    }
  }

  function applySubmissionState(nextState: ReturnType<typeof createSubmissionResetState>) {
    rerunDraft = nextState.rerunDraft
    submissionMode = nextState.submissionMode
    rerunArgsText = nextState.rerunArgsText
    rerunPaymentToken = nextState.rerunPaymentToken
    rerunSecrets = nextState.rerunSecrets
    rerunCommandMode = nextState.rerunCommandMode
    runnerScriptTemplate = nextState.runnerScriptTemplate
    runnerScriptAutoManaged = nextState.runnerScriptAutoManaged
    autoTokenPromptOpen = nextState.autoTokenPromptOpen
    autoTokenPromptKey = nextState.autoTokenPromptKey
    autoTokenDismissedKey = nextState.autoTokenDismissedKey
  }

  function applySubmissionReset() {
    applySubmissionState(createSubmissionResetState())
    maxDuration = 900
  }

  function applyWalletState(nextState: {
    walletAvailable: boolean
    walletTotalBalance: number
    walletBalancesByMint: Record<string, number>
    walletMints: string[]
    selectedMint: string
  }) {
    walletAvailable = nextState.walletAvailable
    walletTotalBalance = nextState.walletTotalBalance
    walletBalancesByMint = nextState.walletBalancesByMint
    walletMints = nextState.walletMints
    selectedMint = nextState.selectedMint
  }

  function applyAutoTokenPromptState(nextState: {autoTokenPromptOpen: boolean; autoTokenPromptKey: string}) {
    autoTokenPromptOpen = nextState.autoTokenPromptOpen
    autoTokenPromptKey = nextState.autoTokenPromptKey
  }

  function closeRun() {
    applyDetailSessionState(createClosedDetailSessionState())
    applySubmissionReset()
  }

  const RUN_HASH_PREFIX = '#run-'

  function readRunIdFromUrl(): string | null {
    try {
      const parentHash = window.parent?.location?.hash
      if (parentHash?.startsWith(RUN_HASH_PREFIX)) {
        return parentHash.slice(RUN_HASH_PREFIX.length) || null
      }
    } catch {
      // cross-origin read blocked — fall through to iframe hash
    }
    if (window.location.hash.startsWith(RUN_HASH_PREFIX)) {
      return window.location.hash.slice(RUN_HASH_PREFIX.length) || null
    }
    return null
  }

  function writeRunIdToUrl(id: string | null) {
    const parentTarget = id ? RUN_HASH_PREFIX + id : '#'
    try {
      if (window.parent && window.parent !== window) {
        // Cross-origin hash-only navigation via string assignment to
        // `location` is permitted by the HTML spec (same-document nav).
        // Reading `location.hash` cross-origin is NOT permitted, so we
        // can't use the property setter — hence this form.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(window.parent as any).location = parentTarget
      }
    } catch {
      // cross-origin write blocked — rely on iframe hash below
    }
    try {
      const baseUrl = window.location.pathname + window.location.search
      history.replaceState(null, '', id ? `${baseUrl}${RUN_HASH_PREFIX}${id}` : baseUrl)
    } catch {
      // ignore
    }
  }

  function applyWorkflowFallback() {
    if (!workflowFallback?.content) return
    try {
      workflowJobs = parseWorkflowJobsFromYaml(workflowFallback.content)
      workflowJobsError = null
      usingWorkflowFallback = true
    } catch (err) {
      workflowJobsError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
    }
  }

  function triggerLabel(event: string | undefined): string {
    switch (event) {
      case 'push':
        return 'Triggered by push'
      case 'pull_request':
        return 'Triggered via pull request'
      case 'schedule':
        return 'Triggered by schedule'
      case 'manual':
      case undefined:
        return 'Triggered manually'
      default:
        return `Triggered via ${event}`
    }
  }

  function profileNameFor(pubkey: string): string {
    void profileTick // re-run when new events (incl. profiles) arrive
    if (!pubkey) return ''
    const event = eventStore.getReplaceable(0, pubkey)
    if (!event) return ''
    return getProfileContent(event)?.display_name || getProfileContent(event)?.name || ''
  }

  function addRerunSecret() {
    rerunSecrets = [...rerunSecrets, {key: '', value: ''}]
  }

  function removeRerunSecret(index: number) {
    rerunSecrets = rerunSecrets.filter((_, currentIndex) => currentIndex !== index)
  }



  async function refreshWorkers() {
    if (!bridge || !repo) return

    loadingWorkers = true
    try {
      const nextState = await refreshWorkersViewModel({
        bridge,
        repo,
        rerunDraft,
      })
      discoveredWorkers = nextState.discoveredWorkers
      rerunDraft = nextState.rerunDraft
    } catch (err) {
      signerError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      loadingWorkers = false
    }
  }

  async function refreshWallet() {
    if (!bridge) return

    walletLoading = true
    walletError = null

    try {
      const nextState = await refreshWalletViewModel({bridge, selectedMint})
      applyWalletState(nextState)
    } catch (err) {
      walletAvailable = false
      walletError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
    } finally {
      walletLoading = false
    }
  }

  // Pick the best-balance mint among the worker-compatible set. Used on the
  // immediate-rerun path where the form's auto-pick effect never mounts.
  async function ensureMintPicked(): Promise<boolean> {
    if (selectedMint && visibleMintOptions.includes(selectedMint)) return true
    if (!walletAvailable || visibleMintOptions.length === 0) {
      await refreshWallet()
    }
    if (visibleMintOptions.length === 0) return false
    const best = [...visibleMintOptions].sort(
      (a, b) => (walletBalancesByMint[b] || 0) - (walletBalancesByMint[a] || 0)
    )[0]
    if (best) selectedMint = best
    return !!selectedMint
  }

  async function generatePaymentToken() {
    if (!bridge) return

    generatingPaymentToken = true
    walletError = null

    try {
      const nextState = await generatePaymentTokenViewModel({
        bridge,
        paymentAmount,
        selectedMint,
        submissionMode,
      })
      rerunPaymentToken = nextState.rerunPaymentToken
      applyWalletState(nextState)
      await showToast('Generated Cashu payment token', 'success')
    } catch (err) {
      walletError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
      await showToast(walletError, 'error')
      autoTokenDismissedKey = ''
    } finally {
      generatingPaymentToken = false
    }
  }

  async function confirmAutoTokenGeneration() {
    autoTokenPromptOpen = false
    autoTokenDismissedKey = autoTokenPromptKey
    await generatePaymentToken()
  }

  function dismissAutoTokenGeneration() {
    autoTokenPromptOpen = false
    autoTokenDismissedKey = autoTokenPromptKey
  }

  function openNewRunForm() {
    if (!repo) return

    const nextState = prepareNewRunSubmissionState(repo)
    if (!nextState) return

    applyDetailSessionState(createClosedDetailSessionState())
    signerError = null
    applySubmissionState(nextState)
    maxDuration = 900

    if (repoWorkflows.length > 0 && nextState.rerunDraft.workflowPath === '') {
      rerunDraft = {...nextState.rerunDraft, workflowPath: repoWorkflows[0].path}
    }

    const nextBranch = defaultBranch || availableBranches[0] || 'main'
    if (rerunDraft && (!rerunDraft.branch || rerunDraft.branch === 'main')) {
      rerunDraft = {...(rerunDraft || nextState.rerunDraft), branch: nextBranch}
    }

    void refreshWorkers()
    void refreshWallet()
    void refreshRepoMetadata()
  }

  function openRerunForm() {
    if (!repo || !selectedRunDetail) return

    const nextState = prepareRerunSubmissionState({repo, runDetail: selectedRunDetail})
    if (!nextState) {
      signerError = 'This run does not include enough loom job metadata to prepare a rerun inside the widget.'
      return
    }

    // Capture worker fields before closing the detail session — that call nulls
    // selectedRunDetail.
    const previousMaxDuration = selectedRunDetail.worker?.maxDuration || 900

    // Close the detail view so the rerun-setup form takes over the main pane
    // instead of stacking on top of the existing run detail.
    applyDetailSessionState(createClosedDetailSessionState())
    signerError = null
    applySubmissionState(nextState)
    maxDuration = previousMaxDuration
    void refreshWorkers()
    void refreshWallet()
  }

  async function rerunImmediately() {
    if (!repo || !selectedRunDetail) return

    const nextState = prepareRerunSubmissionState({repo, runDetail: selectedRunDetail})
    if (!nextState) {
      signerError = 'This run does not include enough loom job metadata to prepare a rerun inside the widget.'
      return
    }

    // Capture values that live on selectedRunDetail before closing the
    // detail session (which nulls it out).
    const previousMaxDuration = selectedRunDetail.worker?.maxDuration || 900

    // Seed the rerun draft + payment state from the previous run, then submit
    // without rendering the form. The in-flight flag suppresses the form view
    // during the async token-generation and submit phases, so the user only
    // sees a lightweight "submitting" placeholder until the new run's detail
    // page takes over (via applyDetailSessionState inside submitRerunRequest).
    immediateRerunInFlight = true
    applyDetailSessionState(createClosedDetailSessionState())
    signerError = null
    applySubmissionState(nextState)
    maxDuration = previousMaxDuration
    void refreshWorkers()

    try {
      // The form's auto-pick effect never mounts on this path, so seed the
      // mint choice here before submitting. Only bails if the wallet has no
      // overlapping mint at all — otherwise any populated mint works.
      const hasMint = await ensureMintPicked()
      if (!hasMint) {
        applySubmissionReset()
        void showToast('No compatible mint available for this worker. Add a wallet balance on a mint the worker accepts, then try again.', 'error')
        return
      }
      await submitRerunRequest()
    } finally {
      immediateRerunInFlight = false
    }
  }

  async function submitRerunRequest() {
    if (!signerPubkey) {
      signerError = 'Not signed in. The host must provide user context.'
      return
    }

    if (!bridge || !repo || !rerunDraft) {
      signerError = 'Missing required context to submit run. Please try refreshing the page.'
      return
    }

    // Every run consumes a fresh single-use Cashu token. The token UI was
    // removed from the form; we always mint a new one at submit time. The
    // wallet bridge surfaces its own confirmation dialog before spending.
    await generatePaymentToken()
    if (!rerunPaymentToken.trim()) {
      // generatePaymentToken already surfaced an error + toast.
      return
    }

    rerunSubmitting = true
    signerError = null

    try {
      const nextState = await submitRunViewModel({
        bridge,
        repo,
        signerPubkey,
        submissionMode,
        rerunCommandMode,
        rerunDraft,
        rerunArgsText,
        rerunPaymentToken,
        runnerScriptTemplate,
        rerunSecrets,
      })

      applySubmissionReset()
      applyDetailSessionState(nextState.detailSessionState)

      await showToast(`${submissionMode === 'new' ? 'Run' : 'Rerun'} submitted: ${nextState.runId.slice(0, 8)}`, 'success')
    } catch (err) {
      signerError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
      await showToast(signerError, 'error')
    } finally {
      rerunSubmitting = false
    }
  }

  async function fetchText(url: string): Promise<string> {
    const response = await fetch(url)
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status}`)
    }
    return response.text()
  }

  function distinct(values: Array<string | undefined>): string[] {
    const seen = new Set<string>()
    for (const v of values) if (v) seen.add(v)
    return [...seen].sort()
  }

  function workflowBasename(path: string): string {
    return path.split('/').pop() || path
  }

  const workflowOptions = $derived(
    distinct(workflowRuns.map(r => r.workflowPath)).map(v => ({
      value: v,
      label: workflowBasename(v),
    })),
  )
  const triggerOptions = $derived(
    distinct(workflowRuns.map(r => r.event)).map(v => ({value: v, label: v})),
  )
  const branchOptions = $derived.by(() => {
    const branches = distinct(workflowRuns.map(r => r.branch))
    const sorted = branches.sort((a, b) => {
      if (a === defaultBranch) return -1
      if (b === defaultBranch) return 1
      return a.localeCompare(b)
    })
    return sorted.map(v => ({
      value: v,
      label: v === defaultBranch ? `${v} (default)` : v,
    }))
  })
  const actorOptions = $derived.by(() => {
    void profileTick
    const pubkeys = distinct(workflowRuns.map(r => r.actor))
    return pubkeys
      .map(pk => ({value: pk, label: profileNameFor(pk) || `${pk.slice(0, 8)}…`}))
      .sort((a, b) => a.label.localeCompare(b.label))
  })
  const statusOptions: Array<{value: string; label: string}> = [
    {value: 'success', label: 'Success'},
    {value: 'failure', label: 'Failure'},
    {value: 'running', label: 'Running'},
    {value: 'in_progress', label: 'In progress'},
    {value: 'queued', label: 'Queued'},
    {value: 'pending', label: 'Pending'},
    {value: 'cancelled', label: 'Cancelled'},
    {value: 'skipped', label: 'Skipped'},
  ]

  const filteredRuns = $derived.by(() => {
    void profileTick
    const now = Date.now()
    const query = searchTerm.trim().toLowerCase()

    return workflowRuns
      .filter(run => {
        if (
          !showStalePending &&
          run.status === 'pending' &&
          now - run.createdAt > STALE_PENDING_MS
        )
          return false

        if (workflowFilter.size > 0 && !workflowFilter.has(run.workflowPath || '')) return false
        if (triggerFilter.size > 0 && !triggerFilter.has(run.event || '')) return false
        if (statusFilter.size > 0 && !statusFilter.has(run.status)) return false
        if (branchFilter.size > 0 && !branchFilter.has(run.branch)) return false
        if (actorFilter.size > 0 && !actorFilter.has(run.actor)) return false

        if (query) {
          const haystack = [
            run.name,
            run.branch,
            run.commitMessage,
            run.commit,
            run.actor,
            run.workflowPath || '',
            profileNameFor(run.actor),
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase()
          if (!haystack.includes(query)) return false
        }

        return true
      })
      .sort((a, b) => b.createdAt - a.createdAt)
  })

  $effect(() => {
    const sub = eventStore.insert$.subscribe(event => {
      if (event.kind === 0) profileTick = (profileTick + 1) % Number.MAX_SAFE_INTEGER
    })
    return () => sub.unsubscribe()
  })

  // Sync selected run <-> URL hash so refresh + share preserves state.
  $effect(() => {
    const initial = readRunIdFromUrl()
    if (initial && !selectedRunId && bridge && repo) {
      void openRunById(initial)
    }
    const onHashChange = () => {
      const next = readRunIdFromUrl()
      if (next === selectedRunId) return
      if (next) void openRunById(next)
      else if (selectedRunId) closeRun()
    }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  })

  $effect(() => {
    if (readRunIdFromUrl() === selectedRunId) return
    writeRunIdToUrl(selectedRunId)
  })

  $effect(() => {
    if (!bridge) return
    void refreshWallet()
  })

  // Set signer pubkey from host-provided user pubkey
  $effect(() => {
    if (!repo?.userPubkey) return
    signerPubkey = repo.userPubkey
  })

  $effect(() => {
    if (!bridge || !repo) return
    void refreshRepoMetadata()
  })

  // Runs list comes from a module-scoped BehaviorSubject keyed by repoAddress.
  // On HMR the subject persists, so remounted subscribers get the current list
  // immediately instead of starting empty.
  $effect(() => {
    if (!repo?.repoAddress) return

    const repoAddress = repo.repoAddress
    const relays = [...new Set([...repo.repoRelays, ...FALLBACK_RELAYS])]
    const trustedAuthors = [...new Set([repo.repoPubkey, ...(repo.maintainers ?? [])])]

    const runsSub = repoRuns$(repoAddress, relays, trustedAuthors).subscribe(runs => {
      workflowRuns = runs
    })

    // Detail merging still needs the raw event stream.
    const detailSub = repoEvents$(repoAddress, relays, trustedAuthors).subscribe(event => {
      const detail = selectedRunDetail
      if (!detail) return
      const updated = mergeEventIntoDetail(detail, event)
      if (updated !== detail) selectedRunDetail = updated
    })

    return () => {
      runsSub.unsubscribe()
      detailSub.unsubscribe()
    }
  })

  // Live duration counter for active runs
  // Re-run when selectedRunId changes (new selection) but read detail with untrack
  $effect(() => {
    if (!selectedRunId) {
      liveDurationSeconds = null
      return
    }

    const detail = untrack(() => selectedRunDetail)
    if (!detail || !isActiveRunStatus(detail.run.status)) {
      liveDurationSeconds = null
      return
    }

    const createdAt = detail.run.createdAt
    liveDurationSeconds = Math.floor((Date.now() - createdAt) / 1000)

    const interval = window.setInterval(() => {
      liveDurationSeconds = Math.floor((Date.now() - createdAt) / 1000)
    }, 1000)

    return () => window.clearInterval(interval)
  })

  $effect(() => {
    if (!rerunDraft || submissionMode !== 'new') return

    if (!rerunDraft.workflowPath && repoWorkflows.length > 0) {
      rerunDraft = {...rerunDraft, workflowPath: repoWorkflows[0].path}
    }

    if (!rerunDraft.branch && defaultBranch) {
      rerunDraft = {...rerunDraft, branch: defaultBranch}
    }
  })

  $effect(() => {
    const nextState = reconcileWalletSelection({
      selectedWorker,
      compatibleMints,
      walletBalancesByMint,
      selectedMint,
      rerunPaymentToken,
      paymentAmount,
    })

    if (nextState.selectedMint !== selectedMint) {
      selectedMint = nextState.selectedMint
    }

    if (nextState.paymentAmount !== paymentAmount) {
      paymentAmount = nextState.paymentAmount
    }
  })

  $effect(() => {
    const nextState = reconcileAutoTokenPrompt({
      autoTokenCandidateKey,
      autoTokenPromptKey,
      autoTokenDismissedKey,
      generatingPaymentToken,
    })

    if (
      nextState.autoTokenPromptOpen !== autoTokenPromptOpen ||
      nextState.autoTokenPromptKey !== autoTokenPromptKey
    ) {
      applyAutoTokenPromptState(nextState)
    }
  })

  $effect(() => {
    if (!rerunDraft || !runnerScriptAutoManaged) return
    if (submissionMode !== 'new' && !(submissionMode === 'rerun' && rerunCommandMode === 'regenerate')) {
      return
    }

    runnerScriptTemplate = buildRunnerScriptTemplate(rerunDraft.workflowPath, selectedWorker, rerunDraft.branch)
  })

  $effect(() => {
    if (!selectedRunDetail) {
      resetDetailArtifacts()
      return
    }

    const run = selectedRunDetail.run
    const paymentToken = eventTagValue(run.loomJobEvent, 'payment')
    const changeToken = eventTagValue(run.loomResultEvent, 'change')
    const logUrl = eventTagValue(run.workflowLogEvent, 'log_url')
    const stdoutUrl = eventTagValue(run.loomResultEvent, 'stdout')
    const stderrUrl = eventTagValue(run.loomResultEvent, 'stderr')

    prepaidAmount = null
    changeAmount = null
    loomStdout = ''
    loomStderr = ''
    loomStdoutUrl = stdoutUrl || null
    loomStderrUrl = stderrUrl || null
    actLogContent = ''
    actLogError = null
    workflowJobs = []
    workflowJobsError = null
    workflowJobsLoading = false

    if (paymentToken) {
      void parseCashuTokenAmount(paymentToken).then(amount => {
        prepaidAmount = amount
      }).catch(() => {
        prepaidAmount = null
      })
    }

    if (changeToken) {
      void parseCashuTokenAmount(changeToken).then(amount => {
        changeAmount = amount
      }).catch(() => {
        changeAmount = null
      })
    }

    if (stdoutUrl) {
      void fetchText(stdoutUrl).then(text => {
        loomStdout = text
      }).catch(err => {
        loomStdout = `Unable to load stdout: ${friendlyErrorMessage(err instanceof Error ? err.message : String(err))}`
      })
    }

    if (stderrUrl) {
      void fetchText(stderrUrl).then(text => {
        loomStderr = text
      }).catch(err => {
        loomStderr = `Unable to load stderr: ${friendlyErrorMessage(err instanceof Error ? err.message : String(err))}`
      })
    }

    if (logUrl) {
      void fetchText(logUrl).then(text => {
        actLogContent = text
      }).catch(err => {
        actLogError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
      })
    }

    workflowFallback = null
    usingWorkflowFallback = false

    if (run.workflowPath) {
      workflowJobsLoading = true
      const definition = repoWorkflows.find(workflow => workflow.path === run.workflowPath)
      if (definition?.content) {
        try {
          workflowJobs = parseWorkflowJobsFromYaml(definition.content)
        } catch (err) {
          workflowJobsError = friendlyErrorMessage(err instanceof Error ? err.message : String(err))
        } finally {
          workflowJobsLoading = false
        }
      } else {
        const basename = run.workflowPath.split('/').pop() || run.workflowPath
        const candidate =
          repoWorkflows.find(w => w.path === run.workflowPath) ||
          repoWorkflows.find(w => (w.path.split('/').pop() || w.path) === basename) ||
          null
        workflowFallback = candidate
        if (repoMetadataLoading) {
          workflowJobsError = 'Waiting for workflow definitions from the host…'
        } else if (repoMetadataError) {
          workflowJobsError = `Can't load workflow ${run.workflowPath}: ${repoMetadataError}`
        } else {
          workflowJobsError =
            `Workflow ${run.workflowPath} is not in the current branch. ` +
            `The commit may have been force-pushed, the file removed, or the run was on a branch that no longer exists.`
        }
        workflowJobsLoading = false
      }
    }
  })

  $effect(() => {
    return setupWidgetLifecycle({
      onBridgeChange: nextBridge => {
        bridge = nextBridge
      },
      onRepoContextChange: nextRepoCtx => {
        repoCtx = nextRepoCtx
      },
      onRepoChange: () => {
        closeRun()
        repoWorkflows = []
        repoBranches = []
      },
      onUnmount: () => {
        detailSeq += 1
        workflowRuns = []
        repoWorkflows = []
        repoBranches = []
        closeRun()
      },
    })
  })
</script>

<div class="min-h-screen w-full bg-background p-4 text-foreground">
  <div class="w-full space-y-4">
    <!-- Tab Switcher -->
    <div class="flex items-center gap-1 border-b border-border">
      <button
        class={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${currentView === 'pipelines' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        onclick={() => (currentView = 'pipelines')}
      >
        Pipelines
      </button>
      <button
        class={`inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${currentView === 'releases' ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
        onclick={() => (currentView = 'releases')}
      >
        <FileCheck class="h-4 w-4" />
        Releases
      </button>
    </div>

    {#if currentView === 'releases'}
      {#if bridge && repo}
        <ReleaseSigningView {bridge} {repo} />
      {:else}
        <div class="rounded-lg border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
          Waiting for repository context…
        </div>
      {/if}
    {:else}
    {#if !selectedRunId && repoMetadataError}
      <div class="rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
        Repo metadata: {repoMetadataError}
      </div>
    {/if}

    <div class="space-y-4">
      {#if immediateRerunInFlight}
      <div class="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
        <RotateCw class="h-4 w-4 animate-spin text-sky-300" />
        <span>Submitting re-run…</span>
      </div>
      {:else if !selectedRunId && rerunDraft}
      <div class="space-y-4">
        <!-- Top bar (matches detail-view shape) -->
        <div class="flex items-start gap-3">
          <button class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onclick={applySubmissionReset} title="Back to runs">
            <ArrowLeft class="h-5 w-5" />
          </button>
          <div class="min-w-0 flex-1">
            <h1 class="min-w-0 truncate text-2xl font-semibold">
              {submissionMode === 'new' ? 'New workflow run' : 'Re-run workflow'}
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
              {submissionMode === 'new'
                ? 'Create a Hive CI run using live workflow and branch data from this repo.'
                : 'Submit another run; payment is minted per run.'}
            </p>
          </div>
        </div>

        <RunSubmissionForm
          title="New workflow run"
          description="Recreated from the original PR flow: workflow selection, worker pricing, wallet-aware mint selection, and generated runner script."
          {submissionMode}
          bind:rerunDraft
          bind:rerunCommandMode
          bind:rerunArgsText
          bind:rerunPaymentToken
          bind:rerunSecrets
          bind:selectedMint
          bind:paymentAmount
          bind:maxDuration
          bind:runnerScriptTemplate
          bind:runnerScriptAutoManaged
          {rerunSubmitting}
          {discoveredWorkers}
          {loadingWorkers}
          {walletAvailable}
          {walletLoading}
          {walletError}
          {walletTotalBalance}
          {walletBalancesByMint}
          {visibleMintOptions}
          {generatingPaymentToken}
          {autoTokenPromptOpen}
          {selectedWorker}
          {compatibleMints}
          {signerError}
          {canGenerateSuggestedToken}
          {availableBranches}
          {defaultBranch}
          availableWorkflows={repoWorkflows}
          suggestedPaymentAmount={suggestedPaymentAmount}
          onRefreshWorkers={() => void refreshWorkers()}
          onRefreshWallet={() => void refreshWallet()}
          onGeneratePaymentToken={() => void generatePaymentToken()}
          onConfirmAutoTokenGeneration={() => void confirmAutoTokenGeneration()}
          onDismissAutoTokenGeneration={dismissAutoTokenGeneration}
          onAddRerunSecret={addRerunSecret}
          onRemoveRerunSecret={removeRerunSecret}
          onSetRerunCommandMode={mode => {
            rerunCommandMode = mode
            if (mode === 'reuse') {
              runnerScriptAutoManaged = false
            } else if (rerunDraft) {
              runnerScriptAutoManaged = true
              runnerScriptTemplate = buildRunnerScriptTemplate(rerunDraft.workflowPath, selectedWorker, rerunDraft.branch)
            }
          }}
          onRegenerateTemplate={() => {
            if (!rerunDraft) return
            runnerScriptAutoManaged = true
            runnerScriptTemplate = buildRunnerScriptTemplate(rerunDraft.workflowPath, selectedWorker, rerunDraft.branch)
          }}
          onSubmit={() => void submitRerunRequest()}
        />
      </div>
      {:else if !selectedRunId}
      <section class="space-y-4">

        <div class="overflow-hidden rounded-lg border border-border bg-card">
          <div class="flex flex-wrap items-center gap-3 border-b border-border bg-card/60 px-3 py-2">
            <button class="inline-flex items-center gap-2 rounded-md border border-green-700 bg-green-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-green-500" onclick={openNewRunForm}>
              <Play class="h-4 w-4" />
              New run
            </button>
            <input
              class="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground"
              bind:value={searchTerm}
              type="text"
              placeholder="Search runs, commits, branches, actors…" />
            <div class="flex items-center gap-1">
              <FilterDropdown
                label="Workflow"
                options={workflowOptions}
                selected={workflowFilter}
                onChange={next => (workflowFilter = next)} />
              <FilterDropdown
                label="Trigger"
                options={triggerOptions}
                selected={triggerFilter}
                onChange={next => (triggerFilter = next)} />
              <FilterDropdown
                label="Status"
                options={statusOptions}
                selected={statusFilter}
                onChange={next => (statusFilter = next)}>
                {#snippet extraBottom()}
                  <label class="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" bind:checked={showStalePending} class="filter-check" />
                    Show stale pending (&gt; 72h)
                  </label>
                {/snippet}
              </FilterDropdown>
              <FilterDropdown
                label="Branch"
                options={branchOptions}
                selected={branchFilter}
                onChange={next => (branchFilter = next)} />
              <FilterDropdown
                label="Triggered by"
                options={actorOptions}
                selected={actorFilter}
                onChange={next => (actorFilter = next)}>
                {#snippet row(option)}
                  <UserDisplay pubkey={option.value} link={false} />
                {/snippet}
              </FilterDropdown>
            </div>
          </div>

          {#if loading}
            <div class="flex items-center justify-center py-16">
              <RotateCw class="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          {:else if error}
            <div class="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
              <AlertCircle class="mb-3 h-8 w-8" />
              <p class="max-w-xl text-sm">{error}</p>
            </div>
          {:else if filteredRuns.length === 0}
            <div class="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <SearchX class="mb-3 h-8 w-8" />
              <p class="text-sm">No pipeline runs found.</p>
              {#if repo}
                <p class="mt-2 max-w-md text-xs">
                  Queried relays: {repo.repoRelays.join(', ') || 'none'}<br/>
                  Repo naddr: {repo.repoNaddr ? repo.repoNaddr.slice(0, 40) + '…' : 'not set'}<br/>
                  Workflows: {repoWorkflows.length} found
                </p>
              {:else}
                <p class="mt-2 text-xs text-yellow-400">Repository context not received from host.</p>
              {/if}
            </div>
          {:else}
            {#each filteredRuns as run, i (run.id)}
              <RunListItem
                {run}
                selected={selectedRunId === run.id}
                divider={i > 0}
                refreshing={detailRefreshing}
                onSelect={() => void openRun(run)} />
            {/each}
          {/if}
        </div>

        <div class="rounded-lg border border-border bg-card p-4">
          <div class="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <div class="text-xs text-muted-foreground">Total runs</div>
              <div class="text-2xl font-bold">{workflowRuns.length}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Success</div>
              <div class="text-2xl font-bold text-green-400">{workflowRuns.filter(run => run.status === 'success').length}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Failed</div>
              <div class="text-2xl font-bold text-red-400">{workflowRuns.filter(run => run.status === 'failure').length}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Active</div>
              <div class="text-2xl font-bold text-yellow-400">{workflowRuns.filter(run => ['running', 'in_progress', 'queued', 'pending'].includes(run.status)).length}</div>
            </div>
          </div>
        </div>
      </section>
      {:else}
      <aside class="space-y-4 rounded-lg border border-border bg-card p-4">
        {#if detailLoading}
          <div class="flex min-h-[320px] items-center justify-center">
            <RotateCw class="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        {:else if detailError}
          <div class="flex min-h-[320px] flex-col items-center justify-center text-center text-muted-foreground">
            <AlertCircle class="mb-3 h-8 w-8" />
            <p class="text-sm">{detailError}</p>
          </div>
        {:else if selectedRunDetail}
          {@const run = selectedRunDetail.run}
          {@const StatusIcon = getStatusIcon(run.status)}
          {@const hiveciEvents = [
            {label: 'Workflow run (5401)', event: run.runEvent},
            {label: 'Workflow result (5402)', event: run.workflowLogEvent},
          ]}
          {@const loomEvents = [
            {label: 'Loom job (5100)', event: run.loomJobEvent},
            {label: 'Loom status (30100)', event: run.loomStatusEvent},
            {label: 'Loom result (5101)', event: run.loomResultEvent},
          ]}
          <div class="space-y-4">
            <!-- Top bar -->
            <div class="flex items-start gap-3">
              <button class="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" onclick={closeRun} title="Back to runs">
                <ArrowLeft class="h-5 w-5" />
              </button>
              <div class="min-w-0 flex-1">
                <div class="flex min-w-0 flex-wrap items-center gap-2">
                  <div class={`shrink-0 ${getStatusColor(run.status)}`}>
                    {#if run.status === 'running' || run.status === 'in_progress'}
                      <RotateCw class="h-5 w-5 animate-spin" />
                    {:else}
                      <StatusIcon class="h-5 w-5" />
                    {/if}
                  </div>
                  <h1 class="min-w-0 truncate text-2xl font-semibold">
                    {run.commitMessage || run.name}
                  </h1>
                  <span class="shrink-0 font-mono text-lg text-muted-foreground">
                    #{shortId(run.id, 7)}
                  </span>
                </div>
                {#if detailRefreshing && isActiveRunStatus(run.status)}
                  <p class="mt-1 text-xs text-sky-300">Refreshing active run…</p>
                {/if}
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <SplitButton onPrimary={() => void rerunImmediately()} disabled={!!rerunDraft || rerunSubmitting}>
                  {#snippet primary()}
                    <Play class="h-4 w-4" />
                    Re-run
                  {/snippet}
                  {#snippet menu(close: () => void)}
                    <button
                      class="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                      onclick={() => { openRerunForm(); close() }}>
                      <span class="font-medium">Re-run with different parameters</span>
                      <span class="text-xs text-muted-foreground">Edit the worker, branch, or runner script before submitting.</span>
                    </button>
                  {/snippet}
                </SplitButton>
                <RunActionsMenu
                  {run}
                  worker={selectedRunDetail.worker}
                  onCopyRunId={() => void copyText(run.id, 'Run ID')}
                  onCopyCommit={() => void copyText(run.commit, 'Commit')} />
              </div>
            </div>

            {#if run.status === 'failure' && !run.workflowLogEvent && run.loomResultEvent}
              <p class="text-xs text-yellow-400">Error (workflow result event missing — status inferred from loom result)</p>
            {/if}

            {#if rerunDraft}
              <div class="rounded-lg border border-border bg-card p-4">
                <div class="mb-3 flex items-center justify-between">
                  <h3 class="text-sm font-semibold">Manual rerun</h3>
                  <button class="rounded-md border border-input px-3 py-1 text-xs hover:bg-accent" onclick={applySubmissionReset}>
                    Cancel
                  </button>
                </div>
                <RunSubmissionForm
                  title="Manual rerun"
                  description="This reuses the prior workflow metadata and loom command, but needs a fresh payment token and any secrets that were previously encrypted."
                  {submissionMode}
                  bind:rerunDraft
                  bind:rerunCommandMode
                  bind:rerunArgsText
                  bind:rerunPaymentToken
                  bind:rerunSecrets
                  bind:selectedMint
                  bind:paymentAmount
                  bind:maxDuration
                  bind:runnerScriptTemplate
                  bind:runnerScriptAutoManaged
                  {rerunSubmitting}
                  {discoveredWorkers}
                  {loadingWorkers}
                  {walletAvailable}
                  {walletLoading}
                  {walletError}
                  {walletTotalBalance}
                  {walletBalancesByMint}
                  {visibleMintOptions}
                  {generatingPaymentToken}
                  {autoTokenPromptOpen}
                  {selectedWorker}
                  {compatibleMints}
                  {signerError}
                  {canGenerateSuggestedToken}
                  {availableBranches}
                  {defaultBranch}
                  availableWorkflows={repoWorkflows}
                  suggestedPaymentAmount={suggestedPaymentAmount}
                  onRefreshWorkers={() => void refreshWorkers()}
                  onRefreshWallet={() => void refreshWallet()}
                  onGeneratePaymentToken={() => void generatePaymentToken()}
                  onConfirmAutoTokenGeneration={() => void confirmAutoTokenGeneration()}
                  onDismissAutoTokenGeneration={dismissAutoTokenGeneration}
                  onAddRerunSecret={addRerunSecret}
                  onRemoveRerunSecret={removeRerunSecret}
                  onSetRerunCommandMode={mode => {
                    rerunCommandMode = mode
                    if (mode === 'reuse') {
                      runnerScriptAutoManaged = false
                    } else if (rerunDraft) {
                      runnerScriptAutoManaged = true
                      runnerScriptTemplate = buildRunnerScriptTemplate(rerunDraft.workflowPath, selectedWorker, rerunDraft.branch)
                    }
                  }}
                  onRegenerateTemplate={() => {
                    if (!rerunDraft) return
                    runnerScriptAutoManaged = true
                    runnerScriptTemplate = buildRunnerScriptTemplate(rerunDraft.workflowPath, selectedWorker, rerunDraft.branch)
                  }}
                  onSubmit={() => void submitRerunRequest()}
                />
              </div>
            {/if}

            <!-- Main 2-col: content + right sidebar -->
            <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
              <!-- Main content -->
              <div class="min-w-0 space-y-4">
                <!-- Metadata strip (same width as content below) -->
                <div class="grid gap-4 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div class="space-y-1">
                    <div class="text-xs text-muted-foreground">{triggerLabel(run.event)}</div>
                    <div class="flex items-center gap-2 text-sm">
                      {#if run.actor}
                        <UserDisplay pubkey={run.actor} />
                      {/if}
                      <span class="text-muted-foreground">·</span>
                      <span title={formatExactTime(run.createdAt)}>{formatTimeAgo(run.createdAt)}</span>
                    </div>
                  </div>
                  <div class="space-y-1">
                    <div class="text-xs text-muted-foreground">Status</div>
                    <span class={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${getStatusBadge(run.status)}`}>
                      {#if run.status === 'running' || run.status === 'in_progress'}
                        <RotateCw class="h-3.5 w-3.5 animate-spin" />
                      {:else}
                        <StatusIcon class="h-3.5 w-3.5" />
                      {/if}
                      {statusLabel(run.status)}
                    </span>
                  </div>
                  <div class="space-y-1">
                    <div class="text-xs text-muted-foreground">Total duration</div>
                    <div class="text-sm font-medium">
                      {isActiveRunStatus(run.status) && liveDurationSeconds !== null
                        ? formatDuration(liveDurationSeconds)
                        : formatDuration(run.duration)}
                    </div>
                  </div>
                  <div class="space-y-1">
                    <div class="text-xs text-muted-foreground">Total cost</div>
                    <div class="text-sm font-medium">
                      {actualCost !== null ? `₿ ${actualCost.toLocaleString()}` : '—'}
                    </div>
                  </div>
                </div>

                {#if usingWorkflowFallback && workflowFallback}
                  <div class="rounded-lg border-2 border-yellow-500/40 bg-yellow-500/10 p-4 text-yellow-200">
                    <div class="flex items-start gap-2 text-sm">
                      <AlertCircle class="mt-0.5 h-4 w-4 shrink-0" />
                      <div class="space-y-1">
                        <div class="font-semibold">Rendering from {workflowFallback.path} on the current branch.</div>
                        <div class="text-xs text-yellow-200/80">
                          This run's original workflow file isn't available. The steps, jobs, and structure below reflect the current-branch version and may not match what actually ran.
                        </div>
                      </div>
                    </div>
                  </div>
                {/if}
                <WorkflowJobs workflowJobs={workflowJobs} {jobGroups} loading={workflowJobsLoading} error={workflowJobsError} {actJobByName} />
                {#if workflowJobsError && workflowFallback && !usingWorkflowFallback}
                  <button
                    class="inline-flex items-center gap-2 rounded-md border border-yellow-500/30 bg-yellow-500/10 px-3 py-1.5 text-xs font-medium text-yellow-200 hover:bg-yellow-500/20"
                    onclick={applyWorkflowFallback}>
                    Try rendering against {workflowFallback.path} from current branch
                  </button>
                {/if}

                {#if actLogError}
                  <div class="rounded-md border border-yellow-500/20 bg-yellow-500/10 p-3 text-xs text-yellow-200">{actLogError}</div>
                {/if}

                <details class="group overflow-hidden rounded-md border border-border bg-card [&>summary::-webkit-details-marker]:hidden">
                  <summary class="flex cursor-pointer select-none list-none items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-accent/40">
                    <span>Raw logs</span>
                    <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div class="divide-y divide-gray-700 border-t border-border">
                    <ConsoleOutput embedded title="Workflow act log" content={actLogContent} url={eventTagValue(run.workflowLogEvent, 'log_url') || null} defaultLines={3} />
                    <div class="grid divide-x divide-gray-700 lg:grid-cols-2">
                      <ConsoleOutput embedded title="stdout (loom)" content={loomStdout} url={loomStdoutUrl} defaultLines={3} />
                      <ConsoleOutput embedded title="stderr (loom)" content={loomStderr} url={loomStderrUrl} defaultLines={3} variant="error" />
                    </div>
                  </div>
                </details>

                <details class="group overflow-hidden rounded-md border border-border bg-card [&>summary::-webkit-details-marker]:hidden">
                  <summary class="flex cursor-pointer select-none list-none items-center justify-between px-4 py-2.5 text-sm font-medium hover:bg-accent/40">
                    <span>Raw event chain</span>
                    <ChevronDown class="h-4 w-4 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div class="border-t border-border p-3">
                    <div class="space-y-3">
                      {#each [...hiveciEvents, ...loomEvents] as block (block.label)}
                        <div class="rounded-md border border-border p-3">
                          <div class="flex items-center justify-between gap-3">
                            <div class="text-sm font-medium">{block.label}</div>
                            {#if block.event}
                              <div class="flex items-center gap-2">
                                <button class="inline-flex items-center gap-1 text-xs text-primary hover:underline" onclick={() => void copyText(block.event?.id, `${block.label} ID`)}>
                                  <Copy class="h-3 w-3" />
                                  Copy
                                </button>
                                <a class="inline-flex items-center gap-1 text-xs text-primary hover:underline" href={publicLinkForRun(block.event.id)} target="_blank" rel="noreferrer">
                                  Open
                                  <ExternalLink class="h-3 w-3" />
                                </a>
                              </div>
                            {/if}
                          </div>
                          <div class="mt-2 text-xs text-muted-foreground">{eventSummary(block.event)}</div>
                          {#if block.event}
                            <div class="mt-2 break-all font-mono text-xs">{block.event.id}</div>
                            {#if eventERefs(block.event).length > 0}
                              <div class="mt-2 text-xs text-muted-foreground">refs: {eventERefs(block.event).join(', ')}</div>
                            {/if}
                            {#if externalUrlForEvent(block.event)}
                              <a class="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline" href={externalUrlForEvent(block.event)} target="_blank" rel="noreferrer">
                                View attached output
                                <ExternalLink class="h-3 w-3" />
                              </a>
                            {/if}
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </div>
                </details>
              </div>

              <RunDetailSidebar
                {run}
                worker={selectedRunDetail.worker}
                {prepaidAmount}
                {changeAmount}
                {actualCost}
                {copyText} />
            </div>
          </div>
        {:else if rerunDraft}
          <div class="space-y-4">
            <div>
              <h3 class="text-lg font-semibold">{submissionMode === 'new' ? 'New workflow run' : 'Manual rerun'}</h3>
              <p class="mt-1 text-sm text-muted-foreground">{submissionMode === 'new' ? 'Create a new Hive CI run using live workflow and branch data from this repo.' : 'Reuse a prior run with a fresh payment token and secrets.'}</p>
            </div>

            <RunSubmissionForm
              title={submissionMode === 'new' ? 'New workflow run' : 'Manual rerun'}
              description={submissionMode === 'new' ? 'Recreated from the original PR flow: workflow selection, worker pricing, wallet-aware mint selection, and generated runner script.' : 'Reuse a previous loom job with real worker discovery, wallet prompting, and regenerated runner script support.'}
              {submissionMode}
              bind:rerunDraft
              bind:rerunCommandMode
              bind:rerunArgsText
              bind:rerunPaymentToken
              bind:rerunSecrets
              bind:selectedMint
              bind:paymentAmount
              bind:maxDuration
              bind:runnerScriptTemplate
              bind:runnerScriptAutoManaged
              {rerunSubmitting}
              {discoveredWorkers}
              {loadingWorkers}
              {walletAvailable}
              {walletLoading}
              {walletError}
              {walletTotalBalance}
              {walletBalancesByMint}
              {visibleMintOptions}
              {generatingPaymentToken}
              {autoTokenPromptOpen}
              {selectedWorker}
              {compatibleMints}
              {signerError}
              {canGenerateSuggestedToken}
              {availableBranches}
              {defaultBranch}
              availableWorkflows={repoWorkflows}
              suggestedPaymentAmount={suggestedPaymentAmount}
              onRefreshWorkers={() => void refreshWorkers()}
              onRefreshWallet={() => void refreshWallet()}
              onGeneratePaymentToken={() => void generatePaymentToken()}
              onConfirmAutoTokenGeneration={() => void confirmAutoTokenGeneration()}
              onDismissAutoTokenGeneration={dismissAutoTokenGeneration}
              onAddRerunSecret={addRerunSecret}
              onRemoveRerunSecret={removeRerunSecret}
              onSetRerunCommandMode={mode => {
                rerunCommandMode = mode
                if (mode === 'reuse') {
                  runnerScriptAutoManaged = false
                } else if (rerunDraft) {
                  runnerScriptAutoManaged = true
                  runnerScriptTemplate = buildRunnerScriptTemplate(rerunDraft.workflowPath, selectedWorker, rerunDraft.branch)
                }
              }}
              onRegenerateTemplate={() => {
                if (!rerunDraft) return
                runnerScriptAutoManaged = true
                runnerScriptTemplate = buildRunnerScriptTemplate(rerunDraft.workflowPath, selectedWorker, rerunDraft.branch)
              }}
              onSubmit={() => void submitRerunRequest()}
            />
          </div>
        {:else}
          <div class="flex min-h-[320px] flex-col items-center justify-center text-center text-muted-foreground">
            <Terminal class="mb-3 h-8 w-8" />
            <p class="text-sm">Select a pipeline run to inspect the Hive CI event chain, parsed jobs, and loom outputs.</p>
          </div>
        {/if}
      </aside>
      {/if}
    </div>
    {/if}
  </div>
</div>
