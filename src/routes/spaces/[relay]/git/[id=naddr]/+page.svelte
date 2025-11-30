<script lang="ts">
  import markdownit from "markdown-it"
  import {Card} from "@nostr-git/ui"
  import {
    CircleAlert,
    GitBranch,
    GitPullRequest,
    Users,
    Globe,
    GitCommit,
    User,
    Link,
    Eye,
    BookOpen,
    Copy,
    Check,
  } from "@lucide/svelte"
  import {fade, fly, slide} from "@lib/transition"
  import Spinner from "@lib/components/Spinner.svelte"
  import {formatDistanceToNow} from "date-fns"
  import {nthEq} from "@welshman/lib"
  import Button from "@lib/components/Button.svelte"
  import {profilesByPubkey} from "@welshman/app"
  import {pushModal} from "@app/util/modal"
  import ResetRepoConfirm from "@app/components/ResetRepoConfirm.svelte"
  import type {LayoutProps} from "./$types.js"
  import {page} from "$app/stores"
  import {pubkey} from "@welshman/app"
  import {decodeRelay} from "@app/core/state"
  import {nip19} from "nostr-tools"
  import {clip, pushToast} from "@app/util/toast"

  let Terminal = $state<any>(null);
  if (__TERMINAL__) {
    import("@nostr-git/ui").then(m => Terminal = m.Terminal);
  }

  let {data}: LayoutProps = $props()
  const {repoClass, repoRelays} = data

  // Progressive loading states - show immediate content right away
  let initialLoading = $state(false)
  let readmeLoading = $state(true)
  let commitLoading = $state(true)
  let lastCommit = $state<any>(null)
  let lastCommitReqSeq = $state(0)
  let _prevRepoKey = $state<string | undefined>(undefined)
  let _prevMain = $state<string | undefined>(undefined)
  let _prevBranchSig = $state<string | undefined>(undefined)
  let copiedUrl = $state<string | null>(null)

  const stats = $derived([
    {
      label: "Branches",
      value: repoClass.branches?.length || 0,
      icon: GitBranch,
      color: "text-blue-600",
    },
    {
      label: "Maintainers",
      value: repoClass.maintainers?.length || 0,
      icon: Users,
      color: "text-green-600",
    },
    {
      label: "Issues",
      value: repoClass.issues?.length || 0,
      icon: CircleAlert,
      color: "text-red-600",
    },
    {
      label: "Patches",
      value: repoClass.patches?.length || 0,
      icon: GitPullRequest,
      color: "text-purple-600",
    },
  ])

  const maintainers = repoClass.maintainers.map(
    m => $profilesByPubkey.get(m) ?? {display_name: truncateHash(m), name: truncateHash(m)},
  )

  function buildDefaultNgitCloneUrl(): string | undefined {
    try {
      const evt: any = (repoClass as any).repoEvent
      const rep: any = (repoClass as any).repo
      const owner = evt?.pubkey
      const name = rep?.name
      if (!owner || !name) return undefined
      const npub = nip19.npubEncode(owner)
      return `nostr://${npub}/${name}`
    } catch {
      return undefined
    }
  }

  function buildDefaultViewRepoUrl(): string | undefined {
    try {
      const evt: any = (repoClass as any).repoEvent
      const rep: any = (repoClass as any).repo
      const owner = evt?.pubkey
      const name = rep?.name
      if (!owner || !name) return undefined
      const npub = nip19.npubEncode(owner)
      return `https://gitworkshop.dev/${npub}/${name}`
    } catch {
      return undefined
    }
  }

  const repoMetadata = $derived({
    name: repoClass.name || "Unknown Repository",
    description: repoClass.description || "",
    repoId: repoClass.key || "",
    maintainers: maintainers || [],
    relays: $repoRelays,
    cloneUrls: (() => {
      // Get clone URLs from repoClass directly
      let urls = [...(repoClass.cloneUrls || [])]
      if (!urls.find(u => u.startsWith("nostr://"))) {
        const def = buildDefaultNgitCloneUrl()
        if (def && !urls.includes(def)) urls.push(def)
      }
      return urls
    })(),
    webUrls: (() => {
      // Get web URLs from repoClass directly
      let urls = [...(repoClass.web || [])]
      if (!urls.find(u => u.startsWith("https://gitworkshop.dev"))) {
        const def = buildDefaultViewRepoUrl()
        if (def && !urls.includes(def)) urls.push(def)
      }
      return urls
    })(),
    mainBranch: repoClass.mainBranch,
    createdAt: repoClass.repoEvent?.created_at
      ? new Date(repoClass.repoEvent.created_at * 1000)
      : null,
    updatedAt: (repoClass as any).repoStateEvent?.created_at
      ? new Date(((repoClass as any).repoStateEvent.created_at as number) * 1000)
      : null,
  })

  // Defaults for Terminal
  const repoCloneUrls = $derived(repoMetadata.cloneUrls || [])
  const defaultRemoteUrl = $derived(repoCloneUrls[0])
  const defaultBranch = $derived(repoMetadata.mainBranch || "")
  const detectedProvider = $derived(
    detectProviderFromUrl(defaultRemoteUrl || repoMetadata.relays?.[0]),
  )
  const defaultToken = $derived(detectedProvider === "grasp" ? $pubkey : undefined)
  const relayUrl = $derived(decodeRelay($page.params.relay))
  const naddr = $derived($page.params.id)
  const repoRefObj = $derived({
    relay: relayUrl,
    naddr,
    npub: $pubkey,
    repoId: repoClass.key,
  })

  // Simple provider detection from URL
  function detectProviderFromUrl(url: string | undefined): string | undefined {
    if (!url) return undefined
    try {
      const u = new URL(url)
      const host = u.hostname
      if (host.includes("github.com")) return "github"
      if (host.includes("gitlab.com")) return "gitlab"
      // Heuristic: ws/wss relay → grasp, but pushes must use HTTP(S) Grasp endpoint
      if (u.protocol === "ws:" || u.protocol === "wss:") return "grasp"
      if (host.includes("ngit.dev") || host.includes("grasp")) return "grasp"
    } catch {}
    return undefined
  }

  let readme = $state<string | undefined>(undefined)
  let renderedReadme = $state<string | undefined>(undefined)
  const md = markdownit({
    html: true,
    linkify: true,
    typographer: true,
  })

  $effect(() => {
    if (repoClass) {
      // Load async data in parallel
      loadRepoInfo()
    }
  })

  // Reactively refresh latest commit when repo updates
  $effect(() => {
    // Touch reactive dependencies so this effect re-runs when repo changes
    const repoKey = repoClass.key
    const main = repoClass.mainBranch
    const branchSig = (repoClass.branches || []).map(b => b.name).join("|")

    // Only refetch if identity actually changed
    const changed =
      repoKey !== _prevRepoKey ||
      main !== _prevMain ||
      branchSig !== _prevBranchSig
    if (!changed) return

    _prevRepoKey = repoKey
    _prevMain = main
    _prevBranchSig = branchSig

    // Debounce/Dedupe: increment sequence and capture
    const seq = ++lastCommitReqSeq
    commitLoading = true
    lastCommit = null
    ;(async () => {
      await loadLastCommit()
      // Only apply result if this is the latest request
      if (seq !== lastCommitReqSeq) return
    })()
  })

  async function loadRepoInfo() {
    // Load README and commit info in parallel for better performance
    const readmePromise = loadReadme()
    const commitPromise = loadLastCommit()

    // Wait for both to complete
    await Promise.allSettled([readmePromise, commitPromise])
  }

  async function loadReadme() {
    try {
      const readmeContent = await repoClass.getFileContent({
        path: "README.md",
        branch: repoClass.mainBranch?.split("/").pop() || "master",
        commit: undefined as any,
      })
      readme = readmeContent.content
      renderedReadme = readme ? md.render(readme) : ""
    } catch (e) {
    } finally {
      readmeLoading = false
    }
  }

  async function loadLastCommit() {
    try {
      // Assume Repo already initialized; avoid triggering repo updates here
      // Build candidate branches to try in order
      const shortMain = repoClass.mainBranch
        ? repoClass.mainBranch.split("/").pop() || repoClass.mainBranch
        : undefined
      const fullMain = repoClass.mainBranch || undefined
      const firstBranch = repoClass.branches?.[0]?.name
      const candidates = Array.from(new Set([shortMain, fullMain, firstBranch].filter(Boolean))) as string[]
      console.debug("LatestCommit candidates", { shortMain, fullMain, firstBranch, candidates })

      // Try a few depths to accommodate shallow clones
      const depths = [5, 10, 25]

      for (const branchName of candidates) {
        for (const depth of depths) {
          try {
            const res = await repoClass.getCommitHistory({ branch: branchName, depth })
            const list = Array.isArray(res) ? res : res?.commits
            console.debug("LatestCommit attempt", { branchName, depth, count: list?.length })
            if (Array.isArray(list) && list.length > 0) {
              lastCommit = list[0]
              return
            }
          } catch (e) {
            console.debug("LatestCommit attempt failed", { branchName, depth, error: String(e) })
          }
        }
      }
      // Final fallback: let Repo resolve the branch internally
      try {
        const res = await repoClass.getCommitHistory({ depth: 25 } as any)
        const list = Array.isArray(res) ? res : res?.commits
        console.debug("LatestCommit final fallback", { count: list?.length })
        if (Array.isArray(list) && list.length > 0) {
          lastCommit = list[0]
          return
        }
      } catch {}
    } catch (e) {
    } finally {
      commitLoading = false
    }
  }

  function formatDate(date: Date | null) {
    if (!date) return "Unknown"
    return formatDistanceToNow(date, {addSuffix: true})
  }

  function truncateHash(hash: string, length = 8) {
    return hash ? hash.substring(0, length) : ""
  }

  async function copyUrl(url: string) {
    try {
      await clip(url)
      copiedUrl = url
      setTimeout(() => {
        copiedUrl = null
      }, 2000)
    } catch (e) {
      console.error("Failed to copy URL", e)
    }
  }
</script>

<svelte:head>
  <title>{repoClass.name}</title>
</svelte:head>

<div class="relative flex flex-col gap-6 py-2">
  {#if initialLoading}
    <div class="flex justify-center py-8">
      <Spinner />
    </div>
  {:else}
    <!-- Stats Grid -->
    <div class="grid grid-cols-2 gap-4 md:grid-cols-4" transition:fade>
      {#each stats as stat}
        <Card class="p-4 transition-shadow hover:shadow-md">
          <div class="flex items-center gap-3">
            <div>
              <p class="text-sm text-muted-foreground">{stat.label}</p>
              <div class="flex items-center gap-3 py-2">
                <stat.icon class="h-5 w-5 {stat.color}" />
                <p class="text-2xl font-semibold">{stat.value}</p>
              </div>
            </div>
          </div>
        </Card>
      {/each}
    </div>

    <!-- Clone URL Section - Prominent Display -->
    {#if repoMetadata.cloneUrls.length > 0}
      <div transition:fade>
        <Card class="p-6">
          <h3 class="mb-3 text-lg font-semibold flex items-center gap-2">
            <GitBranch class="h-5 w-5" />
            Clone Repository
          </h3>
          <div class="space-y-2">
            {#each repoMetadata.cloneUrls as url, index}
              <button
                type="button"
                class="flex w-full items-center gap-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 p-3 transition-all hover:border-gray-300 dark:hover:border-gray-600 hover:bg-gray-100 dark:hover:bg-gray-700/50 active:scale-[0.99] cursor-pointer group"
                title="Click to copy"
                onclick={() => copyUrl(url)}>
                <code class="flex-1 font-mono text-sm overflow-x-auto whitespace-nowrap text-left">{url}</code>
                <div class="flex-shrink-0 p-1 rounded-md transition-colors group-hover:bg-gray-200 dark:group-hover:bg-gray-600">
                  {#if copiedUrl === url}
                    <Check class="h-4 w-4 text-green-600 dark:text-green-400" />
                  {:else}
                    <Copy class="h-4 w-4 text-gray-600 dark:text-gray-400" />
                  {/if}
                </div>
              </button>
            {/each}
          </div>
        </Card>
      </div>
    {/if}

    <div class="grid gap-6 md:grid-cols-2" transition:fly>
      <!-- Repository Details -->
      <Card class="p-6">
        <div class="mb-4 flex items-center justify-between">
          <h3 class="flex items-center gap-2 text-lg font-semibold">
            <GitCommit class="h-5 w-5" />
            Repo Information
          </h3>
          <Button
            onclick={() => {
              pushModal(ResetRepoConfirm, {
                repoClass,
                repoName: repoMetadata.name,
              })
            }}
            class="rounded border border-gray-300 px-3 py-1 text-xs transition-colors hover:bg-gray-50">
            Reset Repo
          </Button>
        </div>
        <div class="grid gap-6 md:grid-cols-1">
          <!-- Git Information -->
          <div class="space-y-3">
            <div class="flex items-center justify-between">
              <span class="text-sm text-muted-foreground">Default Branch</span>
              <span class="rounded px-2 py-1 font-mono text-sm">
                {repoMetadata.mainBranch}
              </span>
            </div>

            {#if commitLoading}
              <div class="border-t pt-3">
                <div class="mb-2 flex items-center justify-between">
                  <span class="text-sm text-muted-foreground">Latest Commit</span>
                  <div class="h-4 w-16 animate-pulse rounded bg-muted"></div>
                </div>
                <div class="h-4 w-3/4 animate-pulse rounded bg-muted"></div>
                <div class="h-4 w-2/3 animate-pulse rounded bg-muted"></div>
                <div class="h-4 w-5/6 animate-pulse rounded bg-muted"></div>
                <div class="h-4 w-1/2 animate-pulse rounded bg-muted"></div>
              </div>
            {:else if lastCommit}
              <div class="border-t pt-3" transition:fade>
                <div class="mb-2 flex items-start justify-between">
                  <span class="text-sm text-muted-foreground">Latest Commit</span>
                  <span class="rounded px-2 py-1 font-mono text-xs">
                    {truncateHash(lastCommit.oid)}
                  </span>
                </div>
                <p class="text-sm">{lastCommit.commit.message}</p>
                <div class="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <User class="h-3 w-3" />
                  <span>{lastCommit.commit.author.name}</span>
                  <span>•</span>
                  <span>{formatDate(new Date(lastCommit.commit.author.timestamp * 1000))}</span>
                </div>
              </div>
            {/if}

            {#if repoClass.branches && repoClass.branches.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground ">Branches</span>
                <div class="flex flex-wrap gap-1">
                  {#each repoClass.branches.slice(0, 5) as branch}
                    <span
                      class="truncate rounded outline outline-1 outline-gray-200 px-2 py-1 text-xs text-white dark:bg-blue-900/30 dark:text-blue-200">
                      {branch.name}
                      {#if branch.isHead}
                        <span class="ml-1">•</span>
                      {/if}
                    </span>
                  {/each}
                  {#if repoClass.branches.length > 5}
                    <span class="px-2 py-1 text-xs text-muted-foreground">
                      +{repoClass.branches.length - 5} more
                    </span>
                  {/if}
                </div>
              </div>
            {/if}
          </div>

          <!-- Nostr Information -->
          <div class="space-y-3">
            {#if repoMetadata.maintainers.length > 0}
              <div>
                <span class="mb-2 block text-sm text-muted-foreground">Maintainers</span>
                <div class="space-y-1">
                  {#each repoMetadata.maintainers as maintainer}
                    <div class="flex items-center gap-2 text-sm">
                      <User class="h-3 w-3" />
                      <span class="font-mono text-xs"
                        >{maintainer?.display_name ?? maintainer?.name}</span>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            <div class="border-t pt-3">
              <span class="mb-2 block text-sm text-muted-foreground">Repo Address</span>
              <button
                type="button"
                class="flex w-full items-start gap-2 text-left text-sm hover:opacity-80"
                title="Click to copy"
                onclick={() => clip(naddr)}>
                <Link class="mt-0.5 h-3 w-3 flex-shrink-0" />
                <span class="break-all font-mono text-xs">{naddr}</span>
              </button>
            </div>

            {#if repoMetadata.relays.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground">Relays</span>
                <div class="space-y-1">
                  {#each repoMetadata.relays.slice(0, 3) as relay}
                    <div class="flex items-center gap-2 text-sm">
                      <Globe class="h-3 w-3" />
                      <span class="truncate">{relay}</span>
                    </div>
                  {/each}
                  {#if repoMetadata.relays.length > 3}
                    <span class="text-xs text-muted-foreground">
                      +{repoMetadata.relays.length - 3} more relays
                    </span>
                  {/if}
                </div>
              </div>
            {/if}

            {#if repoMetadata.cloneUrls.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground">Clone URLs</span>
                <div class="space-y-1">
                  {#each repoMetadata.cloneUrls as url}
                    <button
                      type="button"
                      class="flex w-full items-center gap-2 text-left text-sm hover:opacity-80"
                      title="Click to copy"
                      onclick={() => clip(url)}>
                      <Link class="h-3 w-3" />
                      <span class="truncate font-mono text-xs">{url}</span>
                    </button>
                  {/each}
                </div>
              </div>
            {/if}

            {#if repoMetadata.webUrls.length > 0}
              <div class="border-t pt-3">
                <span class="mb-2 block text-sm text-muted-foreground">Web URLs</span>
                <div class="space-y-1">
                  {#each repoMetadata.webUrls as url}
                    <div class="flex items-center gap-2 text-sm">
                      <Link class="h-3 w-3" />
                      <a href={url} target="_blank" class="truncate font-mono text-xs">{url}</a>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </div>
      </Card>

      <!-- Activity Overview -->
      {#if repoClass.issues.length > 0 || repoClass.patches.length > 0}
        <Card class="p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <Eye class="h-5 w-5" />
            Recent Activity
          </h3>
          <div class="space-y-4">
            {#if repoClass.issues.length > 0}
              <div>
                <h4 class="mb-2 text-sm font-medium text-muted-foreground">Recent Issues</h4>
                <div class="space-y-2">
                  {#each repoClass.issues.slice(0, 3) as issue}
                    <div
                      class="flex items-start gap-3 rounded-lg p-3 outline outline-1 outline-gray-200">
                      <CircleAlert class="mt-0.5 h-4 w-4 text-red-500" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">
                          {issue.tags.find(nthEq(0, "t"))?.[1] || "Untitled Issue"}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {formatDate(new Date(issue.created_at * 1000))}
                        </p>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}

            {#if repoClass.patches.length > 0}
              <div>
                <h4 class="mb-2 text-sm font-medium text-muted-foreground">Recent Patches</h4>
                <div class="space-y-2">
                  {#each repoClass.patches.slice(0, 3) as patch}
                    <div
                      class="flex items-start gap-3 rounded-lg p-3 outline outline-1 outline-gray-200">
                      <GitPullRequest class="mt-0.5 h-4 w-4 text-purple-500" />
                      <div class="min-w-0 flex-1">
                        <p class="truncate text-sm font-medium">
                          {patch.tags.find(nthEq(0, "t"))?.[1] || "Untitled Patch"}
                        </p>
                        <p class="text-xs text-muted-foreground">
                          {formatDate(new Date(patch.created_at * 1000))}
                        </p>
                      </div>
                    </div>
                  {/each}
                </div>
              </div>
            {/if}
          </div>
        </Card>
      {/if}
    </div>
    <div class="flex-1" transition:slide>
      {#if __TERMINAL__ && Terminal}
        <Terminal
          fs={undefined}
          repoRef={repoRefObj}
          repoEvent={repoClass.repoEvent}
        relays={$repoRelays}
        theme="retro"
        height={260}
        initialCwd="/"
        urlAllowlist={[]}
        outputLimit={{bytes: 1_000_000, lines: 10_000, timeMs: 30_000}}
        onCommand={(cmd: string) => console.log(cmd)}
        onOutput={(evt: {stream: string; chunk: string}) => console.log(evt)}
        onExit={(e: {code: number}) => console.log("terminal exit", e.code)}
        onProgress={(evt: any) => console.log("terminal progress", evt)}
        onToast={(evt: {level: "error" | undefined; message: string}) =>
          pushToast({message: evt.message, theme: evt.level})}
        {repoCloneUrls}
        {defaultRemoteUrl}
        {defaultBranch}
        provider={detectedProvider}
        token={defaultToken} />
      {/if}
    </div>

    <!-- README -->
    {#if readmeLoading}
      <div transition:slide>
        <Card class="p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <BookOpen class="h-5 w-5" />
            README
          </h3>
          <div class="space-y-3">
            <div class="h-4 w-3/4 animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-full animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-2/3 animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-5/6 animate-pulse rounded bg-muted"></div>
            <div class="h-4 w-1/2 animate-pulse rounded bg-muted"></div>
          </div>
        </Card>
      </div>
    {:else if renderedReadme}
      <div transition:slide>
        <Card class="p-6">
          <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
            <BookOpen class="h-5 w-5" />
            README
          </h3>
          <div class="prose max-w-2xl bg-white dark:bg-zinc-900" in:fly>
            {@html renderedReadme}
            <style>
              .prose {
                color: theme("colors.zinc.50");
                background: none;
              }
              .dark .prose {
                color: theme("colors.white");
              }
              .prose h1,
              .prose h2,
              .prose h3 {
                font-weight: 600;
                line-height: 1.25;
                color: theme("colors.zinc.50");
                margin-top: 2rem;
                margin-bottom: 1rem;
              }
              .prose h1 {
                font-size: 2rem;
                border-bottom: 1px solid theme("colors.zinc.50");
                padding-bottom: 0.3em;
              }
              .prose h2 {
                font-size: 1.5rem;
                border-bottom: 1px solid theme("colors.zinc.50");
                padding-bottom: 0.2em;
              }
              .prose h3 {
                font-size: 1.25rem;
                padding-bottom: 0.1em;
              }
              .prose ul,
              .prose ol {
                margin: 1em 0;
                padding-left: 2em;
              }
              .prose li {
                margin: 0.3em 0;
              }
              .prose a {
                color: theme("colors.accent");
                text-decoration: underline;
                text-underline-offset: 2px;
                transition: color 0.2s;
              }
              .prose a:hover {
                color: theme("colors.primary");
              }
              .prose code {
                background: theme("colors.zinc.700");
                color: theme("colors.zinc.100");
                border-radius: 4px;
                padding: 0.2em 0.4em;
                font-size: 0.95em;
              }
              .prose pre {
                background: theme("colors.zinc.900");
                color: theme("colors.zinc.100");
                border-radius: 8px;
                padding: 1em;
                margin: 1.5em 0;
                font-size: 1em;
                overflow-x: auto;
              }
              .prose blockquote {
                border-left: 4px solid theme("colors.zinc.300");
                background: theme("colors.zinc.50");
                color: theme("colors.zinc.600");
                padding: 1em 1.5em;
                border-radius: 0.5em;
                margin: 1.5em 0;
                font-style: italic;
              }
              .prose table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 1.5em;
                background: theme("colors.zinc.50");
                border-radius: 0.5em;
                overflow: hidden;
              }
              .prose th,
              .prose td {
                border: 1px solid theme("colors.zinc.200");
                padding: 0.6em 1em;
              }
              .prose th {
                background: theme("colors.zinc.100");
                font-weight: 600;
              }
            </style>
          </div>
        </Card>
      </div>
    {/if}
  {/if}
</div>
