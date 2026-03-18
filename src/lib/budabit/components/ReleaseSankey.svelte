<script lang="ts">
  import {sankey, sankeyLinkHorizontal, sankeyLeft} from "d3-sankey"
  import {displayProfileByPubkey} from "@welshman/app"
  import type {TrustedEvent} from "@welshman/util"
  import type {ArtifactGroup, ReleaseArtifact} from "@lib/budabit/releases"

  interface Props {
    group: ArtifactGroup
    workflowRuns: Map<string, TrustedEvent>
    workerNames: Map<string, string>
    ephemeralToWorker: Map<string, string>
    selectedArtifacts: Set<string>
    onToggleArtifact: (eventId: string) => void
    onSelectGroup: (group: ArtifactGroup) => void
    truncateHash: (hash: string) => string
    copyToClipboard: (text: string) => void
  }

  let {
    group,
    workflowRuns,
    workerNames,
    ephemeralToWorker,
    selectedArtifacts,
    onToggleArtifact,
    onSelectGroup,
    truncateHash,
    copyToClipboard,
  }: Props = $props()

  function displayName(pubkey: string): string {
    if (!pubkey) return "unknown"
    try {
      return displayProfileByPubkey(pubkey)
    } catch {
      return pubkey.slice(0, 8) + "…"
    }
  }

  // ── Sankey data derivation ──

  interface SankeyNode {
    id: string
    name: string
    layer: number
    type: "maintainer" | "worker" | "key" | "hash"
    color: string
    sub?: string
    detail?: string
  }

  interface SankeyLink {
    source: number
    target: number
    value: number
    consensus?: "unanimous" | "majority" | "disagree"
  }

  const consensusStatus = $derived.by((): "unanimous" | "majority" | "split" => {
    if (group.isUnanimous) return "unanimous"
    if (!group.consensusHash) return "split"
    const top = group.hashCounts.get(group.consensusHash)?.length ?? 0
    if (top / group.totalCount > 0.5) return "majority"
    return "split"
  })

  const badgeClass = $derived(
    consensusStatus === "unanimous"
      ? "bg-green-500/10 text-green-500"
      : consensusStatus === "majority"
        ? "bg-yellow-500/10 text-yellow-500"
        : "bg-red-500/10 text-red-500",
  )

  const sankeyLayout = $derived.by(() => {
    // Collect all artifacts in this group
    const allArtifacts: ReleaseArtifact[] = []
    for (const arts of group.hashCounts.values()) {
      allArtifacts.push(...arts)
    }

    // Resolve actual worker identity from ephemeral keys
    function resolveWorkerId(ephPubkey: string): string {
      return ephemeralToWorker.get(ephPubkey) || ephPubkey
    }

    function resolveWorkerName(ephPubkey: string): string {
      const adName = workerNames.get(ephPubkey)
      if (adName) return adName
      const actualPk = ephemeralToWorker.get(ephPubkey)
      if (actualPk) return actualPk.slice(0, 8) + "…"
      return ephPubkey.slice(0, 8) + "…"
    }

    // Collect unique entities
    const maintainerIds = new Set<string>()
    const workerIds = new Map<string, string>() // actualWorkerPk → display name
    const signingKeys = new Set<string>() // ephemeral pubkeys

    for (const art of allArtifacts) {
      maintainerIds.add(art.triggeredBy || "unknown")
      const wId = resolveWorkerId(art.ephemeralPubkey)
      if (!workerIds.has(wId)) workerIds.set(wId, resolveWorkerName(art.ephemeralPubkey))
      signingKeys.add(art.ephemeralPubkey)
    }

    // Build nodes — 4 layers: Maintainers → Workers → Signing Keys → Hashes
    const nodes: SankeyNode[] = []
    const nodeIndex = new Map<string, number>()

    // Layer 0: Maintainers
    for (const mId of maintainerIds) {
      nodeIndex.set(`m:${mId}`, nodes.length)
      nodes.push({id: `m:${mId}`, name: displayName(mId), layer: 0, type: "maintainer", color: "#a371f7"})
    }

    // Layer 1: Workers (grouped by actual worker pubkey)
    for (const [wId, wName] of workerIds) {
      nodeIndex.set(`w:${wId}`, nodes.length)
      nodes.push({id: `w:${wId}`, name: wName, layer: 1, type: "worker", color: "#58a6ff"})
    }

    // Layer 2: Signing keys (ephemeral pubkeys)
    for (const sk of signingKeys) {
      nodeIndex.set(`k:${sk}`, nodes.length)
      nodes.push({id: `k:${sk}`, name: sk.slice(0, 8) + "…", layer: 2, type: "key", color: "#768390"})
    }

    // Layer 3: Hashes
    const mHash = group.consensusHash
    for (const [hash, arts] of group.hashCounts) {
      const status = group.isUnanimous ? "unanimous" : hash === mHash ? "majority" : "disagree"
      const color = status === "unanimous" ? "#3fb950" : status === "majority" ? "#d29922" : "#f85149"
      nodeIndex.set(`h:${hash}`, nodes.length)
      nodes.push({
        id: `h:${hash}`, name: truncateHash(hash), layer: 3, type: "hash", color,
        sub: `${arts.length}/${group.totalCount}`, detail: hash,
      })
    }

    // Build links with accumulated values so band widths are proportional
    const linkMap = new Map<string, SankeyLink & {sKey: string; tKey: string}>()
    const addLink = (sKey: string, tKey: string, consensus?: "unanimous" | "majority" | "disagree") => {
      const sIdx = nodeIndex.get(sKey)
      const tIdx = nodeIndex.get(tKey)
      if (sIdx === undefined || tIdx === undefined) return
      const k = `${sIdx}:${tIdx}`
      const existing = linkMap.get(k)
      if (existing) {
        existing.value += 1
      } else {
        linkMap.set(k, {source: sIdx, target: tIdx, value: 1, consensus, sKey, tKey})
      }
    }

    for (const art of allArtifacts) {
      const mId = art.triggeredBy || "unknown"
      const wId = resolveWorkerId(art.ephemeralPubkey)
      const status = group.isUnanimous ? "unanimous" : art.hash === mHash ? "majority" : "disagree"

      addLink(`m:${mId}`, `w:${wId}`)                              // Maintainer → Worker
      addLink(`w:${wId}`, `k:${art.ephemeralPubkey}`)              // Worker → Signing Key
      addLink(`k:${art.ephemeralPubkey}`, `h:${art.hash}`, status) // Signing Key → Hash
    }

    const links: SankeyLink[] = [...linkMap.values()].map(({sKey, tKey, ...l}) => l)

    if (nodes.length === 0 || links.length === 0) return null

    // Sizing — generous vertical space so labels don't overlap
    const maxNodesInLayer = Math.max(maintainerIds.size, workerIds.size, signingKeys.size, group.hashCounts.size)
    const height = Math.max(120, maxNodesInLayer * 56 + 64)
    const width = 900
    const margin = {top: 32, right: 160, bottom: 16, left: 16}

    const sankeyGen = sankey<SankeyNode, SankeyLink>()
      .nodeId((d: any) => d.index)
      .nodeWidth(12)
      .nodePadding(28)
      .nodeAlign(sankeyLeft)
      .extent([
        [margin.left, margin.top],
        [width - margin.right, height - margin.bottom],
      ])

    const result = sankeyGen({
      nodes: nodes.map(n => ({...n})),
      links: links.map(l => ({...l})),
    })

    return {
      nodes: result.nodes,
      links: result.links,
      width,
      height,
      margin,
      pathGen: sankeyLinkHorizontal(),
    }
  })

  // Column positions for labels
  const columnLabels = $derived.by(() => {
    if (!sankeyLayout) return []
    const columns = ["Maintainers", "Workers", "Signing Keys", "Hashes"]
    const positions: {label: string; x: number}[] = []
    for (let layer = 0; layer < 4; layer++) {
      const layerNodes = sankeyLayout.nodes.filter((n: any) => n.layer === layer)
      if (layerNodes.length > 0) {
        positions.push({
          label: columns[layer],
          x: (layerNodes[0] as any).x0 + 6,
        })
      }
    }
    return positions
  })

  function linkColor(consensus?: string) {
    if (consensus === "unanimous") return "#3fb950"
    if (consensus === "majority") return "#d29922"
    if (consensus === "disagree") return "#f85149"
    return "#8b949e"
  }

  // Tooltip state
  let tooltipHtml = $state("")
  let tooltipX = $state(0)
  let tooltipY = $state(0)
  let tooltipVisible = $state(false)

  function showTooltip(event: MouseEvent, html: string) {
    tooltipHtml = html
    tooltipX = event.clientX + 14
    tooltipY = event.clientY - 14
    tooltipVisible = true
  }

  function moveTooltip(event: MouseEvent) {
    tooltipX = event.clientX + 14
    tooltipY = event.clientY - 14
  }

  function hideTooltip() {
    tooltipVisible = false
  }

  // Expanded detail state
  let showDetail = $state(false)
</script>

<div class="rounded-lg border border-border bg-card">
  <!-- Header -->
  <div class="flex items-center gap-3 p-4">
    <!-- Consensus indicator -->
    <div class="flex-shrink-0">
      {#if consensusStatus === "unanimous"}
        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-green-500/15 text-green-500 text-sm">&#10003;</span>
      {:else if consensusStatus === "majority"}
        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-yellow-500/15 text-yellow-500 text-sm">&#9888;</span>
      {:else}
        <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-red-500/15 text-red-500 text-sm">&#10007;</span>
      {/if}
    </div>

    <!-- Filename -->
    <div class="min-w-0 flex-1">
      <span class="font-mono text-sm font-semibold">
        {#each Object.entries(group.labels) as [, val]}
          {val}
        {/each}
      </span>
    </div>

    <!-- Consensus badge -->
    <span class="flex-shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide {badgeClass}">
      {#if consensusStatus === "unanimous"}
        {group.totalCount}/{group.totalCount} unanimous
      {:else if consensusStatus === "majority"}
        {group.consensusHash ? (group.hashCounts.get(group.consensusHash)?.length ?? 0) : 0}/{group.totalCount} majority
      {:else}
        {group.hashCounts.size} different hashes
      {/if}
    </span>

    <!-- Select / Sign button -->
    {#if consensusStatus !== "split"}
      <button
        class="flex-shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-accent"
        onclick={() => onSelectGroup(group)}>
        Select
      </button>
    {/if}

    <!-- Detail toggle -->
    <button
      class="flex-shrink-0 text-xs text-muted-foreground hover:text-foreground"
      onclick={() => (showDetail = !showDetail)}>
      {showDetail ? "Hide detail" : "Detail"}
    </button>
  </div>

  <!-- Sankey diagram -->
  {#if sankeyLayout}
    <div class="relative overflow-x-auto border-t border-border bg-background/50">
      <svg
        width="100%"
        height={sankeyLayout.height}
        viewBox="0 0 {sankeyLayout.width} {sankeyLayout.height}"
        preserveAspectRatio="xMidYMid meet"
        class="mx-auto block">

        <!-- Column labels -->
        {#each columnLabels as col}
          <text
            x={col.x}
            y={20}
            text-anchor="start"
            fill="currentColor"
            class="fill-muted-foreground/60 text-[9px] font-semibold uppercase tracking-wider">
            {col.label}
          </text>
        {/each}

        <!-- Links -->
        <g>
          {#each sankeyLayout.links as link}
            <path
              d={sankeyLayout.pathGen(link as any)}
              stroke={linkColor(link.consensus)}
              stroke-width={Math.max(3, (link as any).width ?? 3)}
              fill="none"
              opacity="0.28"
              class="transition-opacity duration-150 hover:!opacity-65"
              role="presentation"
              onmouseenter={e => showTooltip(e, `<b>${(link.source as any).name}</b> → <b>${(link.target as any).name}</b><br><span style="color:#8b949e">${link.consensus ?? "trust delegation"}</span>`)}
              onmousemove={moveTooltip}
              onmouseleave={hideTooltip} />
          {/each}
        </g>

        <!-- Nodes -->
        <g>
          {#each sankeyLayout.nodes as node}
            {@const n = node as any}
            {@const nodeH = Math.max(6, n.y1 - n.y0)}
            {@const midY = n.y0 + nodeH / 2}
            <g>
              <rect
                x={n.x0}
                y={n.y0}
                width={n.x1 - n.x0}
                height={nodeH}
                rx="3"
                fill={n.color}
                class="cursor-pointer transition-opacity duration-150 hover:opacity-80"
                role="button"
                tabindex="-1"
                onmouseenter={e => {
                  let detail = `<b>${n.name}</b>`
                  if (n.type === "hash" && n.detail) detail += `<br><span style="color:#8b949e;font-family:monospace;font-size:11px">${n.detail}</span>`
                  if (n.sub) detail += `<br><span style="color:#8b949e">${n.sub}</span>`
                  showTooltip(e, detail)
                }}
                onmousemove={moveTooltip}
                onmouseleave={hideTooltip} />

              <!-- Label: right of node for all layers -->
              <text
                x={n.x1 + 6}
                y={midY}
                dy="0.35em"
                text-anchor="start"
                fill="currentColor"
                class="pointer-events-none fill-foreground text-[10px]"
                font-weight={n.type === "maintainer" || n.type === "hash" ? "600" : "400"}>
                {n.name}{#if n.sub} <tspan class="fill-muted-foreground" font-weight="400">({n.sub})</tspan>{/if}
              </text>
            </g>
          {/each}
        </g>
      </svg>

      <!-- Tooltip -->
      {#if tooltipVisible}
        <div
          class="pointer-events-none fixed z-50 max-w-xs rounded-md border border-border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-lg"
          style="left:{tooltipX}px;top:{tooltipY}px">
          {@html tooltipHtml}
        </div>
      {/if}
    </div>
  {/if}

  <!-- Expanded detail: individual builds -->
  {#if showDetail}
    <div class="border-t border-border">
      {#each [...group.hashCounts.entries()] as [hash, arts] (hash)}
        <div class="px-4 py-3">
          <div class="mb-2 flex items-center gap-2 text-xs">
            <span class="font-mono text-muted-foreground">{truncateHash(hash)}</span>
            <button onclick={() => copyToClipboard(hash)} class="hover:text-foreground">
              <svg class="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"></path></svg>
            </button>
            <span class="text-muted-foreground">&mdash; {arts.length} build(s)</span>
            {#if hash === group.consensusHash && group.isUnanimous}
              <span class="rounded-full bg-green-500/10 px-2 py-0.5 text-green-600">unanimous</span>
            {:else if hash === group.consensusHash}
              <span class="rounded-full bg-yellow-500/10 px-2 py-0.5 text-yellow-600">majority</span>
            {:else}
              <span class="rounded-full bg-red-500/10 px-2 py-0.5 text-red-600">minority</span>
            {/if}
          </div>

          <div class="space-y-2">
            {#each arts as artifact (artifact.event.id)}
              <div class="flex items-start gap-3 rounded-md bg-muted/30 p-3 text-xs">
                <input
                  type="checkbox"
                  checked={selectedArtifacts.has(artifact.event.id)}
                  onchange={() => onToggleArtifact(artifact.event.id)}
                  class="mt-0.5 flex-shrink-0" />
                <div class="min-w-0 flex-1 space-y-1">
                  <div class="flex flex-wrap gap-3 text-muted-foreground">
                    <span>
                      <span class="font-medium text-foreground">Worker:</span>
                      <span>{workerNames.get(artifact.ephemeralPubkey) || (ephemeralToWorker.get(artifact.ephemeralPubkey) || artifact.ephemeralPubkey).slice(0, 12) + "…"}</span>
                    </span>
                    {#if artifact.triggeredBy}
                      <span>
                        <span class="font-medium text-foreground">Triggered by:</span>
                        <span>{displayName(artifact.triggeredBy)}</span>
                      </span>
                    {/if}
                    {#if artifact.workflow}
                      <span>
                        <span class="font-medium text-foreground">Workflow:</span>
                        {artifact.workflow}
                      </span>
                    {/if}
                    {#if artifact.branch}
                      <span>
                        <span class="font-medium text-foreground">Branch:</span>
                        {artifact.branch}
                      </span>
                    {/if}
                  </div>
                  {#if artifact.tags.url}
                    <div class="truncate text-muted-foreground">
                      <span class="font-medium text-foreground">URL:</span>
                      <a href={artifact.tags.url} target="_blank" rel="noopener noreferrer" class="hover:underline">{artifact.tags.url}</a>
                    </div>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>
