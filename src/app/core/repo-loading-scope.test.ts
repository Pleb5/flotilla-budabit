import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")
const dense = (source: string) => source.replace(/\s+/g, "")

describe("authoritative repository loading scope", () => {
  it("uses route hints only for kind 30617 discovery", () => {
    const routeLoad = dense(readProjectFile("../../routes/git/[id=naddr]/+layout.ts"))
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))

    expect(routeLoad).toContain("constannouncementDiscoveryRelays=normalizeRepoRelays(")
    expect(routeLoad).not.toContain("refreshPubkeyOutboxRelays")
    expect(layout).toContain("getRepoScopedRelays(re,{pubkey:repoPubkey,identifier:repoName})")
    expect(layout).toContain('owner:"repo-foreground:announcement-refresh"')
    expect(layout).not.toContain("issuePrStatusLoad")
    expect(layout).not.toContain("flushPendingRepoAddressLoads")
    expect(layout).not.toContain("repoInitialLoads")
  })

  it("does not pass naddr hints into child repository activity loading", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte",
      "../../routes/git/[id=naddr]/prs/[prid]/+page.svelte",
    ]) {
      const source = readProjectFile(path)

      expect(source).toContain("REPO_RELAYS_KEY")
      expect(source).not.toContain("naddrRelays")
    }

    const testRoute = readProjectFile("../../routes/git/[id=naddr]/test/+page.svelte")
    expect(testRoute).toContain("REPO_RELAYS_KEY")
    expect(testRoute).not.toContain("($page.data as any)?.url")
    expect(testRoute).not.toContain("wss://relay.budabit.club")
  })

  it("delegates exact detail resolution to the layout without UI deadlines or diagnostics", () => {
    const issueDetail = dense(
      readProjectFile("../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte"),
    )
    const prDetail = dense(readProjectFile("../../routes/git/[id=naddr]/prs/[prid]/+page.svelte"))
    const issueResolution = issueDetail.slice(
      issueDetail.indexOf("letissueResolution"),
      issueDetail.indexOf("//Filterhelpersusedwhenrefreshinglabels"),
    )

    expect(issueDetail).toContain('constissueId=$derived($page.params.issueid??"")')
    expect(issueResolution).toContain(
      "repoRootHistory.ensureRoot(currentIssueId,controller.signal,retry)",
    )
    expect(issueResolution).toContain("controller.abort()")
    expect(issueResolution).toContain("voidissueEvent")
    expect(issueDetail).not.toContain("ISSUE_RESOLVE_TIMEOUT_MS")
    expect(issueDetail).not.toContain("makeLoader")
    expect(issueDetail).not.toContain("RepoCore.buildRepoSubscriptions")
    expect(issueDetail).not.toContain("RepositoryRelaysUnavailable")
    expect(issueDetail).not.toContain("issueResolutionNonce")
    expect(issueDetail).not.toContain("announcementLiveCoveragePartial")

    expect(prDetail).toContain("repoRootHistory.ensureRoot(currentPrId,controller.signal,retry)")
    expect(prDetail).toContain("controller.abort()")
    expect(prDetail).not.toContain("LOAD_TIMEOUT_MS")
    expect(prDetail).not.toContain("makeLoader")
    expect(prDetail).not.toContain("deriveEvent(prId)")
    expect(prDetail).not.toContain("RepositoryRelaysUnavailable")
    expect(prDetail).not.toContain("prResolutionNonce")
    expect(prDetail).not.toContain("announcementLiveCoveragePartial")
  })

  it("keeps child lists and PRView free of initial repository activity ownership", () => {
    const issueList = readProjectFile("../../routes/git/[id=naddr]/issues/+page.svelte")
    const prList = readProjectFile("../../routes/git/[id=naddr]/prs/+page.svelte")
    const prView = readProjectFile("../components/PRView.svelte")
    const initialPrView = prView.slice(
      prView.indexOf("// PR-specific status and comments"),
      prView.indexOf("const prEffectiveTipOid"),
    )

    expect(issueList).not.toContain("makeFeed")
    expect(prList).not.toContain("makeFeed")
    expect(issueList).not.toContain("// Prefetch recent issue edit events")
    expect(initialPrView).not.toContain("load({")
  })

  it("derives issue and pull request list states from route-owned history", () => {
    for (const path of [
      "../../routes/git/[id=naddr]/issues/+page.svelte",
      "../../routes/git/[id=naddr]/prs/+page.svelte",
    ]) {
      const source = dense(readProjectFile(path))

      expect(source).not.toContain("LIST_RESOLVE_TIMEOUT_MS")
      expect(source).toContain("getRepoRootListPresentation")
      expect(source).toContain("$repoRootHistory")
      expect(source).toContain("$repoAnnouncementStatusStore")
      expect(source).toContain("$repoCacheHydrationFailedStore")
      expect(source).not.toContain("$repoLiveCoveragePartialStore")
      expect(source).not.toContain("retryRootHistory()")
      expect(source).toContain('aria-live="polite"')
    }
  })

  it("partitions owned repository state loads without Git relay fallback", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))
    const ownedStateLoad = layout.slice(
      layout.indexOf("constmyRepoStateLoadScopes"),
      layout.indexOf("constbuildRepoBranchUpdate"),
    )

    expect(ownedStateLoad).toContain("getOwnedRepoStateLoadScopes(latestMyRepos,$pubkey)")
    expect(ownedStateLoad).toContain("getOwnedRepoStateLoadPlans(latestMyRepos,$pubkey)")
    expect(ownedStateLoad).toContain("for(constplanofplans)")
    expect(ownedStateLoad).toContain('"#d":plan.repoIds')
    expect(ownedStateLoad).toContain("load({relays:[plan.relay],filters:[filter]})")
    expect(ownedStateLoad).not.toContain("GIT_RELAYS")
  })

  it("uses stable per-relay live lanes without root-set dependencies", () => {
    const source = readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte")
    const layout = dense(source)

    expect(layout).toContain("buildRepoStableLiveFilters")
    expect(layout).toContain(
      "exactThreadIds.flatMap(rootId=>buildRepoExactThreadLiveFilters(rootId))",
    )
    expect(layout).toContain("registerRepoLiveOwnership(address,relay)")
    expect(layout).toContain('owner:"repo-foreground:stable"')
    expect(layout).toContain('owner:"repo-foreground:announcement"')
    expect(layout).toContain('owner:"repo-foreground:exact-thread"')
    expect(layout).toContain('gapFillQueue.findIndex(task=>task.priority==="foreground")')
    expect(layout).toContain('loadRootGaps([rootId],"foreground")')
    expect(layout).toContain('priority==="foreground"&&task?.state==="queued"')
    expect(layout).toContain(
      '$repoRootHistoryState.status==="idle"||$repoRootHistoryState.status==="loading"||$repoAnnouncementStatus==="loading"',
    )
    expect(layout).toContain("subscribe:repoRootHistoryState.subscribe")
    expect(layout).toContain("relays:activityRelays")
    expect(layout).toContain("relays:announcementRelays")
    expect(layout).toContain("batchRepoLiveRelays(relays)")
    expect(layout).toContain("rotation.cursor=(rotation.cursor+1)%batches.length")
    expect(layout).toContain("REPO_LIVE_RELAY_ROTATION_MS")
    expect(layout).toContain("initialReplayLimit:1")
    expect(layout).toContain("initialReplayLimit:DEFAULT_REPO_ROOT_PAGE_SIZE")
    expect(layout).toContain("...$discoveredAnnouncementRelays")
    expect(layout).not.toContain("repoLiveSubscriptionFiltersKey")
    expect(layout).not.toContain("buildRepoLiveFilters({addresses,rootIds,viewer})")
  })

  it("keeps relay failure diagnostics internal to repository loading", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))
    const pages = [
      readProjectFile("../../routes/git/[id=naddr]/issues/+page.svelte"),
      readProjectFile("../../routes/git/[id=naddr]/issues/[issueid]/+page.svelte"),
      readProjectFile("../../routes/git/[id=naddr]/prs/+page.svelte"),
      readProjectFile("../../routes/git/[id=naddr]/prs/[prid]/+page.svelte"),
    ]

    expect(layout).toContain("failedRelayRequests:repoFailedRelayRequests")
    expect(layout).toContain("retryFailedRelays")
    for (const page of pages) {
      expect(page).not.toContain("RepoRelayFailureNotice")
      expect(page).not.toContain("Some relays did not respond")
      expect(page).not.toContain("Repository relays are unavailable")
    }
  })

  it("aborts list and repository layout finite work on route teardown", () => {
    const list = dense(readProjectFile("../../routes/git/+page.svelte"))
    const listLayout = dense(readProjectFile("../../routes/git/+layout.svelte"))
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))

    expect(list).toContain("constgitPageLoadController=newAbortController()")
    expect(list).toContain("gitPageLoadController.abort()")
    expect(list).toContain("loadaswelshmanLoad,requestaswelshmanRequest,typeLoadOptions")
    expect(listLayout).toContain('constisRepositoryList=$page.route.id==="/git"')
    expect(listLayout).toContain("repoListPreloadController?.abort()")
    expect(layout).toContain("constlayoutLoadController=newAbortController()")
    expect(layout).toContain("layoutLoadController.abort()")
    expect(layout).toContain("repoRootHistoryController?.abort()")
    expect(layout).toContain("retryCacheHydration:hydrateRepoActivityCache")
    expect(layout).toContain("cacheHydrationPending:repoCacheHydrationPending")
    expect(layout).toContain('owner:"repo-foreground:announcement-refresh"')
    expect(layout).toContain("priority:RELAY_REQUEST_PRIORITY.foreground")
    expect(layout).toContain("relays:announcementRelays")
    expect(layout).toContain("relays:activityRelays")
    expect(layout).not.toContain('label={issuesCount>0?`Issues(${issuesCount})`:"Issues"}')
    expect(layout).not.toContain('label={prsCount>0?`PRs(${prsCount})`:"PRs"}')
    expect(layout).toContain("disposeActiveRepo(routeRepoClass)")
  })

  it("hydrates list cache without broad announcement coverage", () => {
    const layout = dense(readProjectFile("../../routes/git/+layout.svelte"))
    const preload = dense(readProjectFile("./repo-list-preload.ts"))
    const page = dense(readProjectFile("../../routes/git/+page.svelte"))
    const rootLayout = dense(readProjectFile("../../routes/+layout.svelte"))

    expect(layout).toContain("preloadRepositoryList({signal:controller.signal")
    expect(layout).toContain("if(!isRepositoryList||repoListPreloadStarted)return")
    expect(layout).toContain("repoListHydrationReady.set(true)")
    expect(preload).toContain("REPO_LIST_HYDRATION_BUDGET_MS")
    expect(preload).toContain("Promise.race([hydrationAttempt,budget])")
    expect(preload).not.toContain("GIT_REPO_ANNOUNCEMENT")
    expect(preload).not.toContain("welshmanRequest")
    expect(preload).toContain("repositoryCache.hydrateEligibleAnnouncements(signal)")
    expect(page).not.toContain("if(!$repoListHydrationReadyStore){personalRepoLoadRequestId")
    expect(page).not.toContain("if(!$repoListHydrationReadyStore)returnundefined")
    expect(page).toContain("return!$repoListHydrationReadyStore||!personalRepoAnnouncementsSettled")
    expect(page).toContain(
      "return!$repoListHydrationReadyStore||!communityRepoAnnouncementsSettled",
    )
    expect(page).toContain('if(!$pubkey||activeMode!=="personal"||activeTab!=="bookmarks")')
    expect(page).toContain('getInitialGitCommunityPointer()?"community":getInitialGitMode()')
    expect(rootLayout).toContain('["/explore","/git"].includes($page.route.id||"")')
  })

  it("keeps discovery search membership separate from canonical announcements", () => {
    const page = dense(readProjectFile("../../routes/git/+page.svelte"))
    const discovered = page.slice(
      page.indexOf("constmatchedDiscoveredSearchRepos"),
      page.indexOf("constcanContinueRepoDiscovery"),
    )

    expect(discovered).toContain("discoveredSearchRepoPool.filter")
    expect(discovered).not.toContain("$repoAnnouncements")
  })

  it("uses explicit rendered-page scope for repository sources and enrichment", () => {
    const page = dense(readProjectFile("../../routes/git/+page.svelte"))
    const model = dense(readProjectFile("./repo-list-card-model.ts"))

    expect(page).toContain("limit:repoResultsVisibleLimit")
    expect(page).toContain("repoStarAddresses.slice(0,repoResultsVisibleLimit)")
    expect(page).toContain("accountSearchVisibleRepos.slice(0,repoResultsVisibleLimit)")
    expect(page).toContain("JSON.stringify([repoCardsSourceContext,repoResultsVisibleLimit])")
    expect(page).toContain("hasRenderedRepoCardsForCurrentContext?sortedRepoCardModels:[]")
    expect(page).toContain(".filter(model=>model.maintainers.length>0)")
    expect(page).toContain("loadBudabitProfileBatch(owners,controller.signal)")
    expect(page).toContain("loadBudabitProfileBatch(secondary,controller.signal)")
    const verificationTargets = page.slice(
      page.indexOf("constrepoCardVerificationTargets"),
      page.indexOf("letrepoCardVerifiedMaintainersByAddress"),
    )
    expect(verificationTargets).not.toContain("GIT_RELAYS")
    expect(verificationTargets).not.toContain("REPO_LIST_MAX_RELAYS")
    expect(page).toContain("repoCardStarHydratedScopes.get(address)!==relayScope")
    expect(page).toContain("...getRelaysFromList($userRelayList)")
    expect(page).toContain('result.completion==="partial"')
    expect(page).toContain("scheduleRepoCardEvidenceRetry(key)")
    expect(page).toContain("repoAddresses:addresses")
    expect(page).toContain("renderedScope:repoCollectionRenderedScopeKey")
    expect(page).toContain("if(!$pubkey||!repoCollectionRenderedScopeKey)")
    expect(page).toContain("repoCardsByContext.size>REPO_CARDS_CONTEXT_CACHE_LIMIT")
    expect(page).toContain("repoResultsVisibleLimit+=REPO_SEARCH_PAGE_SIZE")
    expect(page).not.toContain("IntersectionObserver")
    expect(model).toContain("createRepoListCardProjector")
    expect(model).toContain("while(cache.size>Math.max(1,maxEntries))")
  })

  it("keeps repository cards mounted while an ordinary search result is recomputed", () => {
    const page = dense(readProjectFile("../../routes/git/+page.svelte"))

    expect(page).toContain("constrepoCardsContext=$derived.by(()=>")
    expect(page).toContain("JSON.stringify([repoCardsScopeContext,trimmedActiveRepoSearchQuery])")
    expect(page).toContain(
      "renderedRepoCardsScopeContext===repoCardsScopeContext&&sortedRepoCards.length>0",
    )
    expect(page).toContain("{:elseifhasRenderedRepoCardsForCurrentScope}")
    expect(page).toContain("aria-busy={repoSearchUpdating}")
    expect(page).toContain("isolated:true")
    expect(page).not.toContain("preloadData(")
    expect(page).not.toContain("onpointerenter={g.first")
    expect(page).not.toContain("onfocus={g.first")
  })

  it("starts route activity without waiting for repository cache hydration", () => {
    const layout = dense(readProjectFile("../../routes/git/[id=naddr]/RepoSession.svelte"))
    const mountHydration = layout.slice(
      layout.indexOf("onMount(()=>{repoActivityHydrationReady.set(true)"),
      layout.indexOf("constrepoStatusKinds"),
    )
    const cacheHydration = layout.slice(
      layout.indexOf("consthydrateRepoActivityCache"),
      layout.indexOf("constdeferUntilRepoActivityHydrated"),
    )

    expect(cacheHydration).toContain("accessRepositoryCache(getStore(repoAddressStore))")
    expect(cacheHydration).toContain("repoCacheHydrationPending.set(true)")
    expect(cacheHydration).toContain("repoCacheHydrationFailed.set(true)")
    expect(cacheHydration).not.toContain("if(result.timedOut){repoCacheHydrationFailed.set(true)")
    expect(mountHydration.indexOf("repoActivityHydrationReady.set(true)")).toBeLessThan(
      mountHydration.indexOf("hydrateRepoActivityCache"),
    )
    expect(layout).toContain("receiveRepositoryCacheEvent(event,relay,getStore(repoAddressStore))")
    expect(layout).toContain("mapRepoRelayWork(announcementDiscoveryRelays.filter")
  })

  it("does not initialize repository extensions without relay authority", () => {
    const extensionPage = readProjectFile(
      "../../routes/git/[id=naddr]/extensions/[extId]/+page.svelte",
    )

    expect(extensionPage).toContain("REPO_RELAYS_KEY")
    expect(extensionPage).toContain("hasRepoRelayAuthority")
    expect(extensionPage).toContain("Repository Relays Unavailable")
    expect(extensionPage).not.toContain("@welshman/router")
    expect(extensionPage).not.toContain("wss://relay.budabit.club/")
    expect(extensionPage).not.toContain("wss://nos.lol/")
  })
})
