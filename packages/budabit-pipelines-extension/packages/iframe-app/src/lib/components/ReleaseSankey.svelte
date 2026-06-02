<script lang="ts">
  import type { ReleaseArtifact, ArtifactGroup } from '../releases';

  interface Props {
    artifacts: ReleaseArtifact[];
    groups: ArtifactGroup[];
    workerNames: Map<string, string>;
    ephemeralToWorker: Map<string, string>;
  }

  let { artifacts, groups, workerNames, ephemeralToWorker }: Props = $props();

  // ── Layout constants ────────────────────────────────────────────
  const width = 900;
  const layerX = [40, 270, 530, 740];
  const nodeWidth = 16;
  const nodePadding = 12;
  const topPadding = 40;

  // ── Consensus colors ────────────────────────────────────────────
  const consensusColor = (isUnanimous: boolean, hashCount: number) => {
    if (isUnanimous) return '#22c55e'; // green
    if (hashCount === 1) return '#ef4444'; // red - split
    return '#eab308'; // yellow - majority
  };

  // ── Build layers from data ──────────────────────────────────────
  interface SankeyNode {
    id: string;
    label: string;
    layer: number;
    x: number;
    y: number;
    height: number;
    color: string;
  }

  interface SankeyLink {
    source: SankeyNode;
    target: SankeyNode;
    value: number;
    color: string;
  }

  const layout = $derived.by(() => {
    if (artifacts.length === 0) return { nodes: [], links: [], height: 200 };

    // Layer 0: Maintainers (triggered-by)
    const maintainerSet = new Set<string>();
    // Layer 1: Workers
    const workerSet = new Set<string>();
    // Layer 2: Signing keys (ephemeral pubkeys)
    const signingKeySet = new Set<string>();
    // Layer 3: Hashes
    const hashSet = new Set<string>();

    // Connections
    const maintainerToWorker = new Map<string, Set<string>>();
    const workerToKey = new Map<string, Set<string>>();
    const keyToHash = new Map<string, Set<string>>();

    for (const a of artifacts) {
      const maintainer = a.triggeredBy || 'unknown';
      const workerPubkey = ephemeralToWorker.get(a.ephemeralPubkey) || a.ephemeralPubkey;
      const signingKey = a.ephemeralPubkey;
      const hash = a.hash;

      maintainerSet.add(maintainer);
      workerSet.add(workerPubkey);
      signingKeySet.add(signingKey);
      hashSet.add(hash);

      if (!maintainerToWorker.has(maintainer)) maintainerToWorker.set(maintainer, new Set());
      maintainerToWorker.get(maintainer)!.add(workerPubkey);

      if (!workerToKey.has(workerPubkey)) workerToKey.set(workerPubkey, new Set());
      workerToKey.get(workerPubkey)!.add(signingKey);

      if (!keyToHash.has(signingKey)) keyToHash.set(signingKey, new Set());
      keyToHash.get(signingKey)!.add(hash);
    }

    // Build nodes per layer
    const nodeMap = new Map<string, SankeyNode>();
    const nodes: SankeyNode[] = [];
    const links: SankeyLink[] = [];

    const buildLayer = (
      items: Set<string>,
      layer: number,
      labelFn: (id: string) => string,
      color: string
    ) => {
      let y = topPadding;
      for (const id of items) {
        const nodeHeight = Math.max(24, 20);
        const node: SankeyNode = {
          id: `${layer}-${id}`,
          label: labelFn(id),
          layer,
          x: layerX[layer],
          y,
          height: nodeHeight,
          color,
        };
        nodeMap.set(node.id, node);
        nodes.push(node);
        y += nodeHeight + nodePadding;
      }
    };

    const shortKey = (key: string) => key.length > 12 ? `${key.slice(0, 6)}…${key.slice(-6)}` : key;

    buildLayer(maintainerSet, 0, (id) => shortKey(id), '#8b5cf6');
    buildLayer(workerSet, 1, (id) => workerNames.get(id) || shortKey(id), '#3b82f6');
    buildLayer(signingKeySet, 2, (id) => shortKey(id), '#f59e0b');
    buildLayer(hashSet, 3, (id) => shortKey(id), '#22c55e');

    // Build links
    for (const [maintainer, workers] of maintainerToWorker) {
      for (const worker of workers) {
        const src = nodeMap.get(`0-${maintainer}`);
        const tgt = nodeMap.get(`1-${worker}`);
        if (src && tgt) links.push({ source: src, target: tgt, value: 1, color: 'rgba(139,92,246,0.25)' });
      }
    }
    for (const [worker, keys] of workerToKey) {
      for (const key of keys) {
        const src = nodeMap.get(`1-${worker}`);
        const tgt = nodeMap.get(`2-${key}`);
        if (src && tgt) links.push({ source: src, target: tgt, value: 1, color: 'rgba(59,130,246,0.25)' });
      }
    }
    for (const [key, hashes] of keyToHash) {
      for (const hash of hashes) {
        const src = nodeMap.get(`2-${key}`);
        const tgt = nodeMap.get(`3-${hash}`);
        if (src && tgt) {
          // Color based on consensus
          const group = groups.find((g) => g.consensusHash === hash);
          const linkColor = group?.isUnanimous
            ? 'rgba(34,197,94,0.3)'
            : 'rgba(239,68,68,0.3)';
          links.push({ source: src, target: tgt, value: 1, color: linkColor });
        }
      }
    }

    const maxY = Math.max(...nodes.map((n) => n.y + n.height), 200);
    return { nodes, links, height: maxY + topPadding };
  });

  function linkPath(link: SankeyLink): string {
    const x0 = link.source.x + nodeWidth;
    const y0 = link.source.y + link.source.height / 2;
    const x1 = link.target.x;
    const y1 = link.target.y + link.target.height / 2;
    const mx = (x0 + x1) / 2;
    return `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1}`;
  }

  const layerLabels = ['Maintainers', 'Workers', 'Signing Keys', 'Hashes'];
</script>

{#if artifacts.length === 0}
  <div class="rounded-lg border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
    No artifact data to visualize.
  </div>
{:else}
  <div class="overflow-x-auto rounded-lg border border-border bg-card/50 p-4">
    <svg viewBox={`0 0 ${width} ${layout.height}`} class="w-full" style="min-width: 700px;">
      <!-- Layer labels -->
      {#each layerLabels as label, i}
        <text
          x={layerX[i] + nodeWidth / 2}
          y={16}
          text-anchor="middle"
          class="fill-muted-foreground text-[11px] font-medium"
        >{label}</text>
      {/each}

      <!-- Links -->
      {#each layout.links as link}
        <path
          d={linkPath(link)}
          fill="none"
          stroke={link.color}
          stroke-width="8"
          opacity="0.6"
        >
          <title>{link.source.label} → {link.target.label}</title>
        </path>
      {/each}

      <!-- Nodes -->
      {#each layout.nodes as node}
        <g>
          <rect
            x={node.x}
            y={node.y}
            width={nodeWidth}
            height={node.height}
            rx="3"
            fill={node.color}
            opacity="0.85"
          >
            <title>{node.label}</title>
          </rect>
          <text
            x={node.layer < 3 ? node.x + nodeWidth + 6 : node.x - 6}
            y={node.y + node.height / 2 + 4}
            text-anchor={node.layer < 3 ? 'start' : 'end'}
            class="fill-foreground text-[10px]"
          >{node.label}</text>
        </g>
      {/each}
    </svg>
  </div>
{/if}
