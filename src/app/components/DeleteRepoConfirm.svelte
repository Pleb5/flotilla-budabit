<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {get} from "svelte/store"
  import {preventDefault} from "@lib/html"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import {publish, PublishStatus} from "@welshman/net"
  import {repository, pubkey, signer, tracker} from "@welshman/app"
  import {Address, DELETE, makeEvent, type TrustedEvent} from "@welshman/util"
  import {pushToast} from "@app/util/toast"
  import {clearModals} from "@app/util/modal"
  import {goto} from "$app/navigation"
  import {
    GIT_REPO_ANNOUNCEMENT,
    GIT_REPO_STATE,
    GIT_STACK,
    GIT_MERGE_METADATA,
    GIT_CONFLICT_METADATA,
    GIT_ISSUE,
    GIT_PULL_REQUEST,
    GIT_PULL_REQUEST_UPDATE,
    GIT_STATUS_OPEN,
    GIT_STATUS_APPLIED,
    GIT_STATUS_CLOSED,
    GIT_STATUS_DRAFT,
    parseRepoAnnouncementEvent,
    type RepoAnnouncementEvent,
  } from "@nostr-git/core/events"
  import {fetchRelayInfoResult} from "@nostr-git/core/api"
  import {
    detectVendorFromUrl,
    getGitServiceApiFromUrl,
    isGitVendorEnabled,
    type GitVendor,
  } from "@nostr-git/core/git"
  import {
    tokens as tokensStore,
    tryTokensForHost,
    getTokensForHost,
    type Token,
  } from "@nostr-git/ui"
  import {requireRepoPublicationScope} from "@app/core/repo-publication"
  import {
    buildGraspRepoDeleteRequest,
    buildRepoDeletePlan,
    canDeleteLocalRepoAfterRemoteResults,
    createRetainedRepoDeleteOperation,
    getGraspRepoDeleteTarget,
    getRepoDeleteAddresses,
  } from "@app/util/repo-delete"
  import type {Repo} from "@nostr-git/ui"
  import {inventoryGitDeletion} from "@app/core/git-deletion-inventory"

  type Props = {
    repoClass: Repo
    repoEvent: RepoAnnouncementEvent
    repoName: string
    repoRelays: string[]
    repoAddresses?: string[]
    observedStars?: string[]
    backPath: string
    onClose?: () => void
  }

  const {
    repoClass,
    repoEvent,
    repoName,
    repoRelays,
    repoAddresses = [],
    observedStars = [],
    backPath,
    onClose,
  }: Props = $props()

  type RemoteTarget = {
    id: string
    vendor: GitVendor
    host: string
    owner: string
    repo: string
    url: string
    label: string
    repoPath: string
    supported: boolean
    hasToken: boolean
    graspRelay?: string
  }

  type RemoteDeleteResult = {
    id: string
    label: string
    repoPath: string
    status: "accepted" | "deleted" | "failed" | "skipped"
    detail?: string
  }

  type AccessStatus = "checking" | "ready" | "read-only" | "no-token" | "manual" | "unknown"

  type AccessCheck = {
    status: AccessStatus
    detail?: string
    role?: string
  }

  type ScopeInfo = {
    scopes: string[] | null
    detail?: string
  }

  type DeleteSummary = {
    metadataDeliveriesAttempted: number
    metadataDeliveriesAccepted: number
    metadataFailures: string[]
    relayOutcomes: Array<{unitId: string; relay: string; status: string; detail?: string}>
    deletedEvents: number
    relays: string[]
    kinds: Array<{label: string; count: number}>
    acknowledgedKinds: Array<{label: string; count: number}>
    unconfirmedKinds: Array<{label: string; count: number}>
    remotes: RemoteDeleteResult[]
    localDeleted: boolean
    localError?: string
    rootAcknowledged: boolean
    inventoryComplete: boolean
    partialRelays: string[]
    foreignCount: number
    unsupportedCount: number
    exclusionReasons: Array<{reason: string; count: number}>
    partialRequests: string[]
  }

  const vendorLabels: Record<GitVendor, string> = {
    github: "GitHub",
    gitlab: "GitLab",
    gitea: "Gitea",
    bitbucket: "Bitbucket",
    grasp: "GRASP",
    "grasp-rest": "GRASP",
    generic: "Generic",
  }

  const kindLabels = new Map<number, string>([
    [GIT_REPO_ANNOUNCEMENT, "Repo announcements"],
    [GIT_REPO_STATE, "Repo state"],
    [GIT_STACK, "Stacks"],
    [GIT_MERGE_METADATA, "Merge metadata"],
    [GIT_CONFLICT_METADATA, "Conflict metadata"],
    [GIT_ISSUE, "Issues"],
    [GIT_PULL_REQUEST, "Pull requests"],
    [GIT_PULL_REQUEST_UPDATE, "Pull request updates"],
    [GIT_STATUS_OPEN, "Status (open)"],
    [GIT_STATUS_APPLIED, "Status (merged)"],
    [GIT_STATUS_CLOSED, "Status (closed)"],
    [GIT_STATUS_DRAFT, "Status (draft)"],
  ])

  let confirmText = $state("")
  let tokens = $state<Token[]>([])
  let cloneUrls = $state<string[]>([])
  let selectedRemoteIds = $state<string[]>([])
  let selectionInitialized = $state(false)
  let tokensLoaded = $state(false)
  let isDeleting = $state(false)
  let progress = $state<{completed: number; total: number; label: string} | null>(null)
  let summary = $state<DeleteSummary | null>(null)
  let accessChecks = $state<Record<string, AccessCheck>>({})
  let preflightRunId = 0
  let deleteController: AbortController | null = null

  const waitForTrackerReadback = (
    eventId: string,
    relays: string[],
    signal: AbortSignal,
    timeoutMs = 1_500,
  ) =>
    new Promise<string[]>((resolve, reject) => {
      const expected = new Set(relays)
      const observed = () => relays.filter(relay => tracker.hasRelay(eventId, relay))
      const cleanup = () => {
        clearTimeout(timeout)
        tracker.off?.("add", onAdd)
        tracker.off?.("load", onLoad)
        signal.removeEventListener("abort", onAbort)
      }
      const finish = () => {
        const found = observed()
        if (!found.length) return false
        cleanup()
        resolve(found)
        return true
      }
      const onAdd = (id: string, relay: string) => {
        if (id === eventId && expected.has(relay)) finish()
      }
      const onLoad = () => finish()
      const onAbort = () => {
        cleanup()
        reject(signal.reason || new DOMException("Aborted", "AbortError"))
      }
      const timeout = setTimeout(() => {
        cleanup()
        resolve(observed())
      }, timeoutMs)

      if (finish()) return
      tracker.on("add", onAdd)
      tracker.on("load", onLoad)
      signal.addEventListener("abort", onAbort, {once: true})
    })

  const canDelete = $derived(!!$pubkey && repoEvent?.pubkey === $pubkey)
  const confirmOk = $derived(repoName.trim().length > 0 && confirmText.trim() === repoName)
  const preflightPending = $derived.by(() => {
    if (!remoteTargets.length) return false
    if (!tokensLoaded) return true
    for (const target of remoteTargets) {
      const access = accessChecks[target.id]
      if (!access || access.status === "checking") return true
    }
    return false
  })

  const deleteDisabled = $derived(!confirmOk || !canDelete || isDeleting || preflightPending)

  const back = () => history.back()
  const cancelOrBack = () => {
    if (isDeleting) {
      deleteController?.abort()
      return
    }
    back()
  }

  const parseCloneUrl = (value: string) => {
    const toUrl = (raw: string): URL | null => {
      try {
        return new URL(raw)
      } catch {
        if (raw.startsWith("git@")) {
          const normalized = raw.replace(/^git@([^:]+):(.+)$/, "ssh://$1/$2")
          try {
            return new URL(normalized)
          } catch {
            return null
          }
        }
        if (!raw.includes("://")) {
          try {
            return new URL(`https://${raw}`)
          } catch {
            return null
          }
        }
        return null
      }
    }

    const url = toUrl(value)
    if (!url) return null
    const pathname = url.pathname.replace(/^\/+/, "")
    if (!pathname) return null
    const parts = pathname.split("/").filter(Boolean)
    if (parts.length < 2) return null
    const repoRaw = parts.pop() || ""
    const vendor = detectVendorFromUrl(value)
    const owner = vendor === "gitlab" || vendor === "gitea" ? parts.join("/") : parts.pop() || ""
    const repo = repoRaw.replace(/\.git$/, "")
    if (!owner || !repo) return null
    return {
      vendor,
      host: url.hostname.toLowerCase(),
      owner,
      repo,
      url: value,
    }
  }

  const buildRemoteTargets = (urls: string[], tokenList: Token[]) => {
    const map = new Map<string, RemoteTarget>()
    for (const url of urls) {
      const parsed = parseCloneUrl(url)
      if (!parsed) {
        const id = `unknown:${url}`
        if (!map.has(id)) {
          map.set(id, {
            id,
            vendor: "generic",
            host: "",
            owner: "",
            repo: "",
            url,
            label: "Unknown remote",
            repoPath: url,
            supported: false,
            hasToken: false,
          })
        }
        continue
      }
      if (!isGitVendorEnabled(parsed.vendor)) continue
      const isGrasp = parsed.vendor === "grasp" || parsed.vendor === "grasp-rest"
      const graspTarget = isGrasp
        ? getGraspRepoDeleteTarget({
            cloneUrl: parsed.url,
            ownerPubkey: repoEvent.pubkey,
            identifier: repoName,
            relayHints: repoRelays,
          })
        : null
      const supported = isGrasp ? Boolean(graspTarget) : parsed.vendor !== "generic"
      const matchingTokens = getTokensForHost(tokenList, parsed.host)
      const hasToken = !isGrasp && matchingTokens.length > 0
      const vendorLabel = vendorLabels[parsed.vendor] || "Remote"
      const repoPath = `${parsed.owner}/${parsed.repo}`
      const id = graspTarget
        ? `grasp:${graspTarget.relay}:${repoPath}`
        : `${parsed.vendor}:${parsed.host}:${repoPath}`
      if (map.has(id)) continue
      map.set(id, {
        id,
        vendor: parsed.vendor,
        host: parsed.host,
        owner: parsed.owner,
        repo: parsed.repo,
        url: parsed.url,
        label: `${vendorLabel} (${parsed.host})`,
        repoPath,
        supported,
        hasToken,
        ...(graspTarget ? {graspRelay: graspTarget.relay} : {}),
      })
    }
    return Array.from(map.values())
  }

  const remoteTargets = $derived.by(() => buildRemoteTargets(cloneUrls, tokens))

  const accessLabel = (access: AccessCheck, target: RemoteTarget) => {
    switch (access.status) {
      case "ready":
        return target.graspRelay ? "NIP-09 ready" : "Admin access"
      case "read-only":
        return target.graspRelay ? "Deletion unavailable" : "Read-only"
      case "no-token":
        return "No token"
      case "manual":
        return "Manual only"
      case "unknown":
        return "Unknown access"
      case "checking":
      default:
        return "Checking..."
    }
  }

  const accessTone = (access: AccessCheck) => {
    switch (access.status) {
      case "ready":
        return "text-green-400"
      case "read-only":
      case "no-token":
        return "text-red-400"
      case "unknown":
      case "manual":
        return "text-yellow-400"
      case "checking":
      default:
        return "text-gray-400"
    }
  }

  const canSelectAccess = (access: AccessCheck) =>
    access.status === "ready" || access.status === "unknown"

  const getAccessForTarget = (target: RemoteTarget): AccessCheck => {
    const access = accessChecks[target.id]
    if (access) return access
    if (!tokensLoaded) return {status: "checking"}
    if (target.graspRelay) return {status: "checking"}
    if (!target.supported) {
      return {
        status: "manual",
        detail:
          target.vendor === "grasp" || target.vendor === "grasp-rest"
            ? "GRASP URL does not match this repository"
            : "Remote deletion unsupported",
      }
    }
    if (!target.hasToken) return {status: "no-token", detail: "No token for this host"}
    return {status: "checking"}
  }

  const isAccessDeniedMessage = (message: string) => {
    const text = message.toLowerCase()
    return (
      text.includes("403") ||
      text.includes("401") ||
      text.includes("404") ||
      text.includes("forbidden") ||
      text.includes("unauthorized") ||
      text.includes("not found")
    )
  }

  const describeGitLabAccess = (accessLevel?: number) => {
    if (!accessLevel) return undefined
    if (accessLevel >= 50) return "Owner"
    if (accessLevel >= 40) return "Maintainer"
    if (accessLevel >= 30) return "Developer"
    if (accessLevel >= 20) return "Reporter"
    if (accessLevel >= 10) return "Guest"
    return undefined
  }

  const getGithubApiBase = (host: string) => {
    if (!host || host === "github.com") return "https://api.github.com"
    return `https://${host}/api/v3`
  }

  const fetchGithubScopes = async (token: string, host: string): Promise<ScopeInfo> => {
    try {
      const base = getGithubApiBase(host)
      const response = await fetch(`${base}/user`, {
        headers: {
          Authorization: `token ${token}`,
          Accept: "application/vnd.github+json",
        },
      })

      const scopesHeader = response.headers.get("x-oauth-scopes")
      if (!scopesHeader) {
        return {scopes: null, detail: "Token scopes not available"}
      }
      const scopes = scopesHeader
        .split(",")
        .map(scope => scope.trim())
        .filter(Boolean)
      return {scopes}
    } catch (error) {
      return {
        scopes: null,
        detail: error instanceof Error ? error.message : String(error),
      }
    }
  }

  const evaluateRepoAccess = (
    repo: any,
    vendor: GitVendor,
    currentUser?: string,
    scopeInfo?: ScopeInfo | null,
  ): AccessCheck => {
    const permissions = repo?.permissions || {}
    const ownerLogin = repo?.owner?.login?.toLowerCase?.() || ""
    const userLogin = currentUser?.toLowerCase?.() || ""
    const isOwner = ownerLogin && userLogin && ownerLogin === userLogin

    if (vendor === "github") {
      const hasAdmin = permissions.admin === true
      if (!hasAdmin && !isOwner) {
        return {status: "read-only", detail: "Admin access not granted"}
      }

      if (scopeInfo?.scopes) {
        const hasDeleteScope = scopeInfo.scopes.includes("delete_repo")
        if (!hasDeleteScope) {
          return {status: "read-only", detail: "Token missing delete_repo scope"}
        }
        return {status: "ready", detail: "Admin access + delete_repo scope"}
      }

      return {
        status: "unknown",
        detail: "Admin access detected; token scopes unavailable",
      }
    }

    if (permissions.admin === true) {
      return {status: "ready", detail: "Admin access confirmed", role: permissions.role}
    }

    if (vendor === "gitlab" && typeof permissions.accessLevel === "number") {
      const role = describeGitLabAccess(permissions.accessLevel) || permissions.role
      if (permissions.accessLevel >= 50) {
        return {status: "ready", detail: `${role || "Owner"} access`, role}
      }
      return {
        status: "read-only",
        detail: `${role || "Access"} (admin required)`,
      }
    }

    if (permissions.admin === false) {
      return {status: "read-only", detail: "Admin access not granted"}
    }

    if (isOwner) {
      return {status: "ready", detail: "Owner access confirmed"}
    }

    return {status: "unknown", detail: "Admin access could not be verified"}
  }

  const checkRemoteAccess = async (target: RemoteTarget): Promise<AccessCheck> => {
    if (target.graspRelay) {
      const result = await fetchRelayInfoResult(target.graspRelay)
      if (!result.ok) return {status: "unknown", detail: result.error}
      const relayInfo = result.info
      const supportsGrasp01 =
        Array.isArray(relayInfo.supported_grasps) && relayInfo.supported_grasps.includes("GRASP-01")
      const supportsNip09 =
        Array.isArray(relayInfo.supported_nips) && relayInfo.supported_nips.includes(9)
      if (!supportsGrasp01) {
        return {status: "read-only", detail: "Server does not advertise GRASP-01"}
      }
      if (!supportsNip09) {
        return {status: "read-only", detail: "Server does not advertise NIP-09"}
      }
      return {status: "ready", detail: "GRASP-01 repository deletion is advertised", role: "nip09"}
    }

    const tokensForHost = getTokensForHost(tokens, target.host)
    if (!tokensForHost.length) {
      return {status: "no-token", detail: "No token for this host"}
    }

    let readOnlyDetail = ""
    const errors: string[] = []

    for (const entry of tokensForHost) {
      try {
        const api = getGitServiceApiFromUrl(target.url, entry.token)
        const repo = await api.getRepo(target.owner, target.repo)
        const scopeInfo =
          target.vendor === "github" ? await fetchGithubScopes(entry.token, target.host) : null
        let access = evaluateRepoAccess(repo, target.vendor, undefined, scopeInfo)

        if (access.status === "unknown" || access.status === "read-only") {
          try {
            const user = await api.getCurrentUser()
            access = evaluateRepoAccess(repo, target.vendor, user?.login, scopeInfo)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            errors.push(message)
          }
        }

        if (access.status === "ready") {
          return access
        }

        if (access.status === "read-only") {
          readOnlyDetail = access.detail || "Admin access not granted"
          continue
        }

        if (access.status === "unknown") {
          return access
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (isAccessDeniedMessage(message)) {
          readOnlyDetail = "No access or repository not found"
          continue
        }
        errors.push(message)
      }
    }

    if (readOnlyDetail) {
      return {status: "read-only", detail: readOnlyDetail}
    }

    if (errors.length) {
      return {status: "unknown", detail: errors[0]}
    }

    return {status: "unknown", detail: "Access could not be verified"}
  }

  const runPreflight = async () => {
    const runId = ++preflightRunId
    const targets = remoteTargets
    const initial: Record<string, AccessCheck> = {}

    for (const target of targets) {
      if (target.graspRelay) {
        initial[target.id] = {status: "checking"}
      } else if (!target.supported) {
        initial[target.id] = {
          status: "manual",
          detail:
            target.vendor === "grasp" || target.vendor === "grasp-rest"
              ? "GRASP URL does not match this repository"
              : "Remote deletion unsupported",
        }
      } else if (!target.hasToken) {
        initial[target.id] = {status: "no-token", detail: "No token for this host"}
      } else {
        initial[target.id] = {status: "checking"}
      }
    }

    accessChecks = initial

    const toCheck = targets.filter(
      target => Boolean(target.graspRelay) || (target.supported && target.hasToken),
    )

    await Promise.all(
      toCheck.map(async target => {
        const result = await checkRemoteAccess(target)
        if (runId !== preflightRunId) return
        accessChecks = {...accessChecks, [target.id]: result}
      }),
    )

    if (runId !== preflightRunId) return

    if (!selectionInitialized) {
      selectedRemoteIds = targets
        .filter(target => accessChecks[target.id]?.status === "ready")
        .map(target => target.id)
      selectionInitialized = true
    }

    selectedRemoteIds = selectedRemoteIds.filter(id =>
      canSelectAccess(accessChecks[id] || {status: "unknown"}),
    )
  }

  $effect(() => {
    if (!tokensLoaded || isDeleting) return
    selectionInitialized = false
    if (!remoteTargets.length) {
      accessChecks = {}
      return
    }
    void runPreflight()
  })

  onMount(async () => {
    try {
      const loadedTokens = await tokensStore.waitForInitialization()
      tokens = loadedTokens
    } catch {
      tokens = []
    } finally {
      tokensLoaded = true
    }
  })

  onDestroy(() => {
    deleteController?.abort()
    onClose?.()
  })

  $effect(() => {
    try {
      const parsed = parseRepoAnnouncementEvent(repoEvent)
      const parsedClone = parsed.clone || []
      cloneUrls = parsedClone.length > 0 ? parsedClone : repoClass.clone || []
    } catch {
      cloneUrls = repoClass.clone || []
    }
  })

  const publishDeleteEvent = async (
    event: any,
    relays: string[],
    repoAddress: string,
    signal?: AbortSignal,
    commitLocal = true,
  ) => {
    const publishRelays = requireRepoPublicationScope({event, relays, repoAddress})
    const currentSigner = get(signer)
    if (!currentSigner) throw new Error("No signer available")
    const signSignal = signal
      ? AbortSignal.any([signal, AbortSignal.timeout(30_000)])
      : AbortSignal.timeout(30_000)
    const signedEvent = await currentSigner.sign(event, {signal: signSignal})
    const results = Object.values(
      await publish({event: signedEvent, relays: publishRelays, timeout: 10_000, signal}),
    ) as any[]
    const accepted = results.filter(result => result?.status === PublishStatus.Success)
    if (commitLocal && accepted.length > 0) repository.publish(signedEvent)
    return {
      accepted,
      results,
    }
  }

  const deleteRepo = async () => {
    if (!canDelete) {
      pushToast({theme: "error", message: "Only the repository owner can delete it."})
      return
    }
    if (!confirmOk) {
      pushToast({theme: "error", message: "Please type the repository name to confirm."})
      return
    }
    if (preflightPending) {
      pushToast({theme: "error", message: "Wait for remote access checks to finish."})
      return
    }

    const ownerPubkey = $pubkey!
    const operationTargets = remoteTargets.map(target => ({...target}))
    const operationSelected = new Set(selectedRemoteIds)
    const operationAccess = {...accessChecks}
    const operationTokens = [...tokens]

    isDeleting = true
    deleteController = new AbortController()
    const signal = deleteController.signal
    progress = null
    summary = null

    try {
      const repoAddress = Address.fromEvent(repoEvent).toString()
      const deleteRepoAddresses = getRepoDeleteAddresses(repoAddresses, repoAddress)
      const relays = requireRepoPublicationScope({
        event: repoEvent,
        relays: repoRelays,
        repoAddress,
      })
      const metadataRelays = relays
      const inventory = await inventoryGitDeletion({
        context: {
          rootType: "repository",
          root: repoEvent as TrustedEvent,
          repositoryAddress: repoAddress,
          repositoryAddresses: deleteRepoAddresses.filter(address => address !== repoAddress),
          ownerPubkey,
        },
        relays,
        timeoutMs: 15_000,
        maxEventsPerRequest: 4_000,
        signal,
        owner: `delete:repository:${repoAddress}`,
      })
      const partialRelays = Array.from(
        new Set(
          inventory.requests
            .filter(request => request.transport.outcome !== "eose")
            .map(request => request.relay),
        ),
      )
      const inventoryForeign = inventory.excludedByReason["foreign-author"] || 0
      const inventoryUnsupported = Object.entries(inventory.excludedByReason).reduce(
        (sum, [reason, count]) => sum + (reason === "foreign-author" ? 0 : count || 0),
        0,
      )
      const inventoryBestEffort = inventory.targets.filter(
        target => target.policy === "best-effort",
      ).length
      const relationCounts = new Map<string, number>()
      for (const target of inventory.targets.filter(target => target.policy === "best-effort")) {
        const group = `${target.relation}/kind ${target.targetKind}`
        relationCounts.set(group, (relationCounts.get(group) || 0) + 1)
      }
      const relationSummary =
        Array.from(relationCounts, ([relation, count]) => `${relation}: ${count}`).join(", ") ||
        "none"
      const exclusionSummary =
        Object.entries(inventory.excludedByReason)
          .filter(([, count]) => count)
          .map(([reason, count]) => `${reason}: ${count}`)
          .join(", ") || "none"
      const partialRequests = inventory.requests
        .filter(request => request.transport.outcome !== "eose")
        .map(request => `round ${request.round}/chunk ${request.chunk} at ${request.relay}`)
        .join(", ")
      if (
        !window.confirm(
          `Deletion preview: 1 required repository announcement. Best-effort authored events (${inventoryBestEffort}): ${relationSummary}. Exclusions: ${exclusionSummary}. Inventory is ${inventory.complete ? "complete at EOSE" : `partial: ${partialRequests || "one or more requests"}`}. ${observedStars.length} observed owner star${observedStars.length === 1 ? "" : "s"} will remain unchanged. Physical remotes are handled separately. Continue?`,
        )
      ) {
        throw new Error("Repository deletion cancelled after metadata inventory preview")
      }
      const inventoryError = ""
      const eventsToDelete = inventory.targets.map(target => target.event)
      const classifiedEvents = inventory.targets
        .filter(target => target.policy === "best-effort")
        .map(target => target.event)
      const deletePlan = buildRepoDeletePlan({
        root: repoEvent as TrustedEvent,
        events: eventsToDelete,
        classifiedEvents,
        repoAddresses: deleteRepoAddresses,
      })
      const totalSteps = Math.max(deletePlan.units.length + operationTargets.length, 1)
      let completed = 0

      progress = {completed, total: totalSteps, label: "Sending delete requests..."}

      let metadataDeliveriesAttempted = 0
      let metadataDeliveriesAccepted = 0
      const metadataFailures: string[] = []
      const currentSigner = get(signer)
      if (!currentSigner) throw new Error("No signer available")
      const metadataOperation = createRetainedRepoDeleteOperation({
        plan: deletePlan,
        relays: metadataRelays,
        sign: (unit, operationSignal) =>
          currentSigner.sign(makeEvent(DELETE, {tags: unit.tags, created_at: unit.createdAt}), {
            signal: operationSignal,
          }),
        publish: async (signedEvent, _unit, pendingRelays, operationSignal) => {
          const publishRelays = requireRepoPublicationScope({
            event: signedEvent,
            relays: pendingRelays,
            repoAddress,
          })
          const results = Object.values(
            await publish({
              event: signedEvent,
              relays: publishRelays,
              timeout: 10_000,
              signal: operationSignal,
            }),
          ) as any[]
          completed += 1
          progress = {completed, total: totalSteps, label: "Sending delete requests..."}
          return {
            outcomes: results.map(result => ({
              relay: result?.relay || "unknown relay",
              status:
                result?.status === PublishStatus.Success
                  ? ("accepted" as const)
                  : result?.status === "timeout"
                    ? ("timeout" as const)
                    : ("failed" as const),
              detail: result?.detail,
            })),
          }
        },
        getReadbackRelays: signedEvent => tracker.getRelays(signedEvent.id),
        waitForReadback: (signedEvent, pendingRelays, operationSignal) =>
          waitForTrackerReadback(signedEvent.id, pendingRelays, operationSignal),
        onAcknowledged: signedEvent => {
          if (!repository.getEvent(signedEvent.id)) repository.publish(signedEvent as TrustedEvent)
        },
        onError: (unit, error) => {
          metadataFailures.push(
            `${unit.id}: ${error instanceof Error ? error.message : String(error)}`,
          )
        },
      })

      let metadataOperationResult = await metadataOperation.runBestEffort(signal)

      progress = {completed, total: totalSteps, label: "Deleting remote repositories..."}

      const remoteResults: RemoteDeleteResult[] = []
      for (const target of operationTargets) {
        signal.throwIfAborted()
        const access = operationAccess[target.id] || {status: "unknown"}
        if (!operationSelected.has(target.id)) {
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "skipped",
            detail: "Not selected",
          })
          continue
        }
        if (!canSelectAccess(access)) {
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "skipped",
            detail: access.detail || "Access not available",
          })
          continue
        }
        if (!target.supported) {
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "skipped",
            detail: access.detail || "Manual deletion only",
          })
          continue
        }
        try {
          let successStatus: RemoteDeleteResult["status"] = "deleted"
          let successDetail: string | undefined
          if (target.graspRelay) {
            const targetRelay = requireRepoPublicationScope({
              event: repoEvent,
              relays: [target.graspRelay],
              repoAddress,
            })[0]
            if (!relays.includes(targetRelay)) {
              throw new Error("GRASP relay is not declared by the repository announcement")
            }
            const request = buildGraspRepoDeleteRequest({
              event: repoEvent,
              ownerPubkey,
            })
            const outcome = await publishDeleteEvent(
              makeEvent(DELETE, {tags: request.tags, created_at: request.createdAt}),
              [targetRelay],
              repoAddress,
              signal,
              false,
            )
            const accepted = outcome.accepted[0]
            if (!accepted) {
              const detail = outcome.results
                .map(result => result?.detail || result?.status)
                .filter(Boolean)
                .join("; ")
              throw new Error(detail || "GRASP relay did not accept the deletion request")
            }
            successStatus = "accepted"
            successDetail = accepted.detail
              ? `Relay accepted deletion request: ${accepted.detail}`
              : "Relay accepted deletion request; physical removal was not independently verified"
            await repoClass.workerManager
              .gitNaturalInvalidateInfoRefs({urls: [target.url]})
              .catch(() => {})
          } else {
            await tryTokensForHost(operationTokens, target.host, async token => {
              const workerManager: any = repoClass.workerManager as any
              const operationId = `repository-delete:${crypto.randomUUID()}`
              const cancelRemote = () => {
                void workerManager.cancelOperation?.({
                  operationId,
                  reason: "Repository deletion cancelled by user",
                })
              }
              signal.addEventListener("abort", cancelRemote, {once: true})
              let result: any
              try {
                signal.throwIfAborted()
                result = await workerManager.deleteRemoteRepo({
                  remoteUrl: target.url,
                  token,
                  operationId,
                })
                signal.throwIfAborted()
              } finally {
                signal.removeEventListener("abort", cancelRemote)
              }
              if (!result?.success) {
                throw new Error(result?.error || "Remote deletion failed")
              }
              return result
            })
          }
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: successStatus,
            detail: successDetail,
          })
        } catch (error) {
          if (signal.aborted || (error instanceof Error && error.name === "AbortError")) throw error
          remoteResults.push({
            id: target.id,
            label: target.label,
            repoPath: target.repoPath,
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
          })
        }
        completed += 1
        progress = {completed, total: totalSteps, label: "Deleting remote repositories..."}
      }

      const selectedRemotesSucceeded = remoteResults.every(
        result =>
          !operationSelected.has(result.id) ||
          result.status === "accepted" ||
          result.status === "deleted",
      )
      let rootAcknowledged = false
      if (selectedRemotesSucceeded) {
        metadataOperationResult = await metadataOperation.runRoot(signal)
        rootAcknowledged = metadataOperationResult.rootAcknowledged
      } else {
        metadataFailures.push(
          "Repository announcement preserved because a selected physical remote was not deleted",
        )
      }

      progress = {completed, total: totalSteps, label: "Cleaning up local cache..."}

      let localDeleted = false
      let localError: string | undefined
      const canDeleteLocalRepo = canDeleteLocalRepoAfterRemoteResults({
        inventoryError,
        inventoryAccepted: true,
        rootAcknowledged,
        selectedRemoteIds: operationSelected,
        remoteResults,
      })
      if (!canDeleteLocalRepo) {
        localError = inventoryError
          ? `Local clone preserved because inventory failed: ${inventoryError}`
          : !rootAcknowledged
            ? "Local clone preserved because the repository announcement tombstone is unconfirmed"
            : "Local clone preserved because a selected physical remote operation failed"
      } else {
        try {
          if (repoClass.key) {
            const localResult = await repoClass.workerManager.deleteRepo({repoId: repoClass.key})
            localDeleted = !!localResult?.success
            if (!localDeleted && localResult?.error) {
              localError = localResult.error
            }
          } else {
            localError = "Missing repository id for local cleanup"
          }
        } catch (error) {
          localError = error instanceof Error ? error.message : String(error)
        }
      }

      try {
        repoClass.commitManager?.reset()
        repoClass.branchManager?.reset()
        repoClass.invalidateBranchCache()
        await repoClass.fileManager?.clearCache()
        await repoClass.mergeAnalysisCacheManager?.clear()
        if (repoClass.cacheManager) {
          await repoClass.cacheManager.clear("file_content")
          await repoClass.cacheManager.clear("file_listing")
          await repoClass.cacheManager.clear("file_exists")
          await repoClass.cacheManager.clear("file_history")
        }
      } catch {
        // Cache cleanup is best-effort after deletion.
      }

      const kindCounts = new Map<number, number>()
      for (const event of eventsToDelete) {
        kindCounts.set(event.kind, (kindCounts.get(event.kind) || 0) + 1)
      }

      const kinds = Array.from(kindCounts.entries())
        .map(([kind, count]) => ({label: kindLabels.get(kind) || `Kind ${kind}`, count}))
        .sort((a, b) => b.count - a.count)
      const summarizeUnits = (acknowledged: boolean) => {
        const counts = new Map<number, number>()
        for (const unit of deletePlan.units) {
          if (metadataOperationResult.acknowledged.has(unit.id) !== acknowledged) continue
          for (const target of unit.targets) {
            counts.set(target.kind, (counts.get(target.kind) || 0) + 1)
          }
        }
        return Array.from(counts, ([kind, count]) => ({
          label: kindLabels.get(kind) || `Kind ${kind}`,
          count,
        })).sort((left, right) => right.count - left.count)
      }
      const getRelayOutcomes = () =>
        metadataOperationResult.units.flatMap(unit =>
          unit.outcomes.map(outcome => ({unitId: unit.unitId, ...outcome})),
        )
      const relayOutcomes = getRelayOutcomes()
      metadataDeliveriesAttempted = relayOutcomes.filter(
        outcome => outcome.status !== "readback",
      ).length
      metadataDeliveriesAccepted = relayOutcomes.filter(outcome =>
        ["accepted", "readback"].includes(outcome.status),
      ).length
      metadataFailures.splice(
        0,
        metadataFailures.length,
        ...relayOutcomes
          .filter(outcome => !["accepted", "readback"].includes(outcome.status))
          .map(
            outcome => `${outcome.unitId} · ${outcome.relay}: ${outcome.detail || outcome.status}`,
          ),
      )

      summary = {
        metadataDeliveriesAttempted,
        metadataDeliveriesAccepted,
        metadataFailures,
        relayOutcomes,
        deletedEvents: eventsToDelete.length,
        relays: metadataRelays,
        kinds,
        acknowledgedKinds: summarizeUnits(true),
        unconfirmedKinds: summarizeUnits(false),
        remotes: remoteResults,
        localDeleted,
        localError,
        rootAcknowledged,
        inventoryComplete: inventory.complete,
        partialRelays,
        foreignCount: inventoryForeign,
        unsupportedCount: inventoryUnsupported,
        exclusionReasons: Object.entries(inventory.excludedByReason)
          .filter((entry): entry is [string, number] => Boolean(entry[1]))
          .map(([reason, count]) => ({reason, count})),
        partialRequests: inventory.requests
          .filter(request => request.transport.outcome !== "eose")
          .map(
            request =>
              `Round ${request.round}, chunk ${request.chunk}, ${request.relay}: ${request.transport.outcome}`,
          ),
      }
      if (selectedRemotesSucceeded && !metadataOperationResult.complete) {
        pushToast({
          theme: "warning",
          timeout: 0,
          message: "One or more repository metadata deletion units remain unconfirmed.",
          action: {
            message: "Retry metadata",
            onclick: async () => {
              try {
                const retried = await metadataOperation.retry()
                metadataOperationResult = retried
                if (summary) {
                  const retriedOutcomes = getRelayOutcomes()
                  summary = {
                    ...summary,
                    rootAcknowledged: retried.rootAcknowledged,
                    acknowledgedKinds: summarizeUnits(true),
                    unconfirmedKinds: summarizeUnits(false),
                    relayOutcomes: retriedOutcomes,
                    metadataDeliveriesAttempted: retriedOutcomes.filter(
                      outcome => outcome.status !== "readback",
                    ).length,
                    metadataDeliveriesAccepted: retriedOutcomes.filter(outcome =>
                      ["accepted", "readback"].includes(outcome.status),
                    ).length,
                    metadataFailures: retriedOutcomes
                      .filter(outcome => !["accepted", "readback"].includes(outcome.status))
                      .map(
                        outcome =>
                          `${outcome.unitId} · ${outcome.relay}: ${outcome.detail || outcome.status}`,
                      ),
                  }
                }
                pushToast({
                  theme: retried.complete ? "success" : "warning",
                  message: retried.complete
                    ? "Repository metadata deletion requests acknowledged. The preserved local clone was not removed automatically."
                    : "Some repository metadata deletion requests remain unconfirmed.",
                })
              } catch (error) {
                pushToast({
                  theme: "error",
                  message: error instanceof Error ? error.message : "Metadata retry failed",
                })
              }
            },
          },
        })
      }
    } catch (error) {
      const cancelled = signal.aborted || (error instanceof Error && error.name === "AbortError")
      pushToast(
        cancelled
          ? {message: "Repository deletion cancelled. Already acknowledged requests were retained."}
          : {
              theme: "error",
              message: `Failed to delete repository: ${error instanceof Error ? error.message : String(error)}`,
            },
      )
    } finally {
      deleteController = null
      isDeleting = false
    }
  }

  const finish = async () => {
    clearModals()
    await goto(backPath || "/git")
  }
</script>

<form class="column min-w-0 gap-4 overflow-x-hidden" onsubmit={preventDefault(deleteRepo)}>
  <ModalHeader>
    {#snippet title()}
      Delete repository
    {/snippet}
    {#snippet info()}
      Deletion may be partial and cannot be undone
    {/snippet}
  </ModalHeader>

  {#if summary}
    <div class="space-y-3 text-sm">
      <div>
        <div class="font-medium">Nostr deletion requests</div>
        <div class="text-gray-400">
          {summary.deletedEvents} events targeted, {summary.metadataDeliveriesAccepted} relay confirmations
          across {summary.metadataDeliveriesAttempted} publish deliveries
        </div>
        <div class="text-gray-400">
          Metadata relays: {summary.relays.join(", ") || "none"}
        </div>
        <div class={summary.inventoryComplete ? "text-green-400" : "text-yellow-400"}>
          {summary.inventoryComplete
            ? "Metadata inventory completed at EOSE"
            : `Partial metadata inventory${summary.partialRelays.length ? `: ${summary.partialRelays.join(", ")}` : ""}`}
        </div>
        <div class={summary.rootAcknowledged ? "text-green-400" : "text-red-400"}>
          Repository announcement: {summary.rootAcknowledged
            ? "deletion request acknowledged"
            : "preserved or unconfirmed"}
        </div>
        {#if summary.foreignCount > 0 || summary.unsupportedCount > 0}
          <div class="text-xs text-gray-400">
            Bounded exclusions: {summary.foreignCount} foreign, {summary.unsupportedCount}
            unsupported. These events were not targeted.
          </div>
          {#each summary.exclusionReasons as exclusion}
            <div class="text-xs text-gray-400">
              {exclusion.reason}: {exclusion.count}
            </div>
          {/each}
        {/if}
        {#each summary.partialRequests as request}
          <div class="text-xs text-yellow-400">{request}</div>
        {/each}
        {#if summary.metadataFailures.length > 0}
          <div class="mt-1 grid gap-1 text-xs text-red-400">
            {#each summary.metadataFailures as failure}
              <div class="truncate" title={failure}>{failure}</div>
            {/each}
          </div>
        {/if}
        {#if summary.relayOutcomes.length > 0}
          <div class="mt-2 text-xs font-medium uppercase tracking-wide text-gray-400">
            Per-relay outcomes
          </div>
          <div class="mt-1 grid gap-1 text-xs text-gray-400">
            {#each summary.relayOutcomes as outcome}
              <div>{outcome.unitId} · {outcome.relay}: {outcome.status}</div>
            {/each}
          </div>
        {/if}
        {#if summary.kinds.length > 0}
          <div class="mt-2 text-xs font-medium uppercase tracking-wide text-gray-400">Targeted</div>
          <div class="mt-2 grid gap-1">
            {#each summary.kinds as item}
              <div class="flex items-center justify-between">
                <span>{item.label}</span>
                <span class="text-gray-400">{item.count}</span>
              </div>
            {/each}
          </div>
        {/if}
        {#if summary.acknowledgedKinds.length > 0}
          <div class="mt-2 text-xs font-medium uppercase tracking-wide text-green-400">
            Acknowledged
          </div>
          {#each summary.acknowledgedKinds as item}
            <div class="flex items-center justify-between">
              <span>{item.label}</span><span class="text-gray-400">{item.count}</span>
            </div>
          {/each}
        {/if}
        {#if summary.unconfirmedKinds.length > 0}
          <div class="mt-2 text-xs font-medium uppercase tracking-wide text-yellow-400">
            Unconfirmed
          </div>
          {#each summary.unconfirmedKinds as item}
            <div class="flex items-center justify-between">
              <span>{item.label}</span><span class="text-gray-400">{item.count}</span>
            </div>
          {/each}
        {/if}
      </div>

      <div>
        <div class="font-medium">Remote hosts</div>
        {#if summary.remotes.length === 0}
          <div class="text-gray-400">No remote deletions requested</div>
        {:else}
          <div class="mt-2 grid gap-1">
            {#each summary.remotes as remote}
              <div class="flex min-w-0 items-center justify-between gap-3">
                <span class="min-w-0 truncate" title={`${remote.label} · ${remote.repoPath}`}
                  >{remote.label} · {remote.repoPath}</span>
                {#if remote.status === "deleted"}
                  <span class="shrink-0 whitespace-nowrap text-green-400">Deleted</span>
                {:else if remote.status === "accepted"}
                  <span class="shrink-0 whitespace-nowrap text-green-400">Request accepted</span>
                {:else if remote.status === "failed"}
                  <span class="shrink-0 whitespace-nowrap text-red-400">Failed</span>
                {:else}
                  <span class="shrink-0 whitespace-nowrap text-gray-400">Skipped</span>
                {/if}
              </div>
              {#if remote.detail}
                <div class="truncate text-xs text-gray-400" title={remote.detail}>
                  {remote.detail}
                </div>
              {/if}
            {/each}
          </div>
        {/if}
      </div>

      <div>
        <div class="font-medium">Local repository</div>
        {#if summary.localDeleted}
          <div class="text-green-400">Local clone deleted</div>
        {:else}
          <div class="text-red-400">Local clone not deleted</div>
          {#if summary.localError}
            <div class="text-xs text-gray-400">{summary.localError}</div>
          {/if}
        {/if}
      </div>
    </div>
  {:else}
    <p class="text-sm text-gray-300">
      Budabit will inventory and request deletion of the repository announcement and supported
      metadata you authored. Foreign events, nested legacy replies, repository stars, shared
      patches, and unsafe addressable metadata are not targeted. Selected remote hosts may also
      delete hosted code and orphaned events. The announcement is requested last, and the local
      clone is removed only after the required steps succeed.
    </p>

    <div class="text-sm">
      <div class="font-medium">Repository stars left unchanged</div>
      <div class="text-gray-400">
        {observedStars.length} owner star{observedStars.length === 1 ? "" : "s"} observed across current
        and recorded renamed coordinates.
      </div>
    </div>

    <div class="space-y-3">
      <div>
        <div class="text-sm font-medium">Remote hosts to delete code from</div>
        {#if remoteTargets.length === 0}
          <div class="text-sm text-gray-400">
            No remote code hosts were found. Budabit will still request deletion of supported Nostr
            events and, if those requests succeed, remove the local clone.
          </div>
        {:else}
          <div class="text-xs text-gray-400">
            Owner signatures are used for GRASP hosts; admin access is required for traditional Git
            hosts. Access checks run before you can confirm deletion.
          </div>
          <div class="mt-2 grid gap-2">
            {#each remoteTargets as target}
              {@const access = getAccessForTarget(target)}
              <label class="flex min-w-0 items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  value={target.id}
                  bind:group={selectedRemoteIds}
                  disabled={isDeleting || !canSelectAccess(access)}
                  class="mt-1" />
                <div class="min-w-0 flex-1">
                  <div class="flex min-w-0 items-center justify-between gap-3">
                    <span class="min-w-0 truncate" title={target.label}>{target.label}</span>
                    <span class={`${accessTone(access)} shrink-0 whitespace-nowrap`}
                      >{accessLabel(access, target)}</span>
                  </div>
                  <div class="truncate text-xs text-gray-400" title={target.repoPath}>
                    {target.repoPath}
                  </div>
                  {#if access.detail}
                    <div class="truncate text-xs text-gray-400" title={access.detail}>
                      {access.detail}
                    </div>
                  {/if}
                </div>
              </label>
            {/each}
          </div>
          {#if preflightPending}
            <div class="mt-2 text-xs text-gray-400">Checking remote access…</div>
          {:else}
            <div class="mt-2 text-xs text-gray-400">
              Hosts marked Read-only, No token, or Manual will be skipped. Unknown access can still
              be selected but may fail.
            </div>
          {/if}
        {/if}
      </div>

      <div>
        <div class="text-sm font-medium">Confirm deletion</div>
        <p class="text-xs text-gray-400">
          Type the repository name <strong>{repoName}</strong> to confirm.
        </p>
        <label class="input input-bordered mt-2 flex w-full items-center gap-2">
          <input bind:value={confirmText} class="grow" type="text" disabled={isDeleting} />
        </label>
        <p class="mt-2 text-xs text-gray-400">Note: not all relays honor deletion requests.</p>
      </div>

      {#if progress}
        <div class="space-y-2">
          <div class="text-sm text-gray-300">{progress.label}</div>
          <progress
            class="progress progress-primary w-full"
            value={(progress.completed / Math.max(progress.total, 1)) * 100}
            max="100"></progress>
        </div>
      {/if}
    </div>
  {/if}

  <ModalFooter>
    {#if summary}
      <Button class="btn btn-primary" onclick={finish}>
        Done
        <Icon icon={AltArrowRight} />
      </Button>
    {:else}
      <Button class="btn btn-link" onclick={cancelOrBack}>
        <Icon icon={AltArrowLeft} />
        {isDeleting ? "Cancel deletion" : "Go back"}
      </Button>
      <Button type="submit" class="btn btn-error" disabled={deleteDisabled}>
        <Spinner loading={isDeleting}>Delete repository</Spinner>
        <Icon icon={AltArrowRight} />
      </Button>
    {/if}
  </ModalFooter>
</form>
