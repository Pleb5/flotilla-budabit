<script lang="ts">
  import { page } from '$app/stores';
  import { ChevronDown, ChevronRight, FileText, FilePlus, FileMinus, FileX } from '@lucide/svelte';
  import { CommitHeader, SplitDiff } from '@nostr-git/ui';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();
  
  // Extract data from page load
  const { commitMeta, changes, repoClass } = data;

  // --- Avatar resolution (Gravatar) ---
  // Lightweight MD5 implementation for Gravatar hashing
  // Source adapted from blueimp/JavaScript-MD5 (MIT), trimmed for our usage
  function md5cycle(x: number[], k: number[]) {
    let [a, b, c, d] = x;
    a = ff(a, b, c, d, k[0], 7, -680876936);
    d = ff(d, a, b, c, k[1], 12, -389564586);
    c = ff(c, d, a, b, k[2], 17, 606105819);
    b = ff(b, c, d, a, k[3], 22, -1044525330);
    a = ff(a, b, c, d, k[4], 7, -176418897);
    d = ff(d, a, b, c, k[5], 12, 1200080426);
    c = ff(c, d, a, b, k[6], 17, -1473231341);
    b = ff(b, c, d, a, k[7], 22, -45705983);
    a = ff(a, b, c, d, k[8], 7, 1770035416);
    d = ff(d, a, b, c, k[9], 12, -1958414417);
    c = ff(c, d, a, b, k[10], 17, -42063);
    b = ff(b, c, d, a, k[11], 22, -1990404162);
    a = ff(a, b, c, d, k[12], 7, 1804603682);
    d = ff(d, a, b, c, k[13], 12, -40341101);
    c = ff(c, d, a, b, k[14], 17, -1502002290);
    b = ff(b, c, d, a, k[15], 22, 1236535329);

    a = gg(a, b, c, d, k[1], 5, -165796510);
    d = gg(d, a, b, c, k[6], 9, -1069501632);
    c = gg(c, d, a, b, k[11], 14, 643717713);
    b = gg(b, c, d, a, k[0], 20, -373897302);
    a = gg(a, b, c, d, k[5], 5, -701558691);
    d = gg(d, a, b, c, k[10], 9, 38016083);
    c = gg(c, d, a, b, k[15], 14, -660478335);
    b = gg(b, c, d, a, k[4], 20, -405537848);
    a = gg(a, b, c, d, k[9], 5, 568446438);
    d = gg(d, a, b, c, k[14], 9, -1019803690);
    c = gg(c, d, a, b, k[3], 14, -187363961);
    b = gg(b, c, d, a, k[8], 20, 1163531501);
    a = gg(a, b, c, d, k[13], 5, -1444681467);
    d = gg(d, a, b, c, k[2], 9, -51403784);
    c = gg(c, d, a, b, k[7], 14, 1735328473);
    b = gg(b, c, d, a, k[12], 20, -1926607734);

    a = hh(a, b, c, d, k[5], 4, -378558);
    d = hh(d, a, b, c, k[8], 11, -2022574463);
    c = hh(c, d, a, b, k[11], 16, 1839030562);
    b = hh(b, c, d, a, k[14], 23, -35309556);
    a = hh(a, b, c, d, k[1], 4, -1530992060);
    d = hh(d, a, b, c, k[4], 11, 1272893353);
    c = hh(c, d, a, b, k[7], 16, -155497632);
    b = hh(b, c, d, a, k[10], 23, -1094730640);
    a = hh(a, b, c, d, k[13], 4, 681279174);
    d = hh(d, a, b, c, k[0], 11, -358537222);
    c = hh(c, d, a, b, k[3], 16, -722521979);
    b = hh(b, c, d, a, k[6], 23, 76029189);
    a = hh(a, b, c, d, k[9], 4, -640364487);
    d = hh(d, a, b, c, k[12], 11, -421815835);
    c = hh(c, d, a, b, k[15], 16, 530742520);
    b = hh(b, c, d, a, k[2], 23, -995338651);

    a = ii(a, b, c, d, k[0], 6, -198630844);
    d = ii(d, a, b, c, k[7], 10, 1126891415);
    c = ii(c, d, a, b, k[14], 15, -1416354905);
    b = ii(b, c, d, a, k[5], 21, -57434055);
    a = ii(a, b, c, d, k[12], 6, 1700485571);
    d = ii(d, a, b, c, k[3], 10, -1894986606);
    c = ii(c, d, a, b, k[10], 15, -1051523);
    b = ii(b, c, d, a, k[1], 21, -2054922799);
    a = ii(a, b, c, d, k[8], 6, 1873313359);
    d = ii(d, a, b, c, k[15], 10, -30611744);
    c = ii(c, d, a, b, k[6], 15, -1560198380);
    b = ii(b, c, d, a, k[13], 21, 1309151649);
    a = ii(a, b, c, d, k[4], 6, -145523070);
    d = ii(d, a, b, c, k[11], 10, -1120210379);
    c = ii(c, d, a, b, k[2], 15, 718787259);
    b = ii(b, c, d, a, k[9], 21, -343485551);

    x[0] = (x[0] + a) | 0;
    x[1] = (x[1] + b) | 0;
    x[2] = (x[2] + c) | 0;
    x[3] = (x[3] + d) | 0;
  }
  function cmn(q: number, a: number, b: number, x: number, s: number, t: number) {
    a = (a + q + x + t) | 0;
    return (((a << s) | (a >>> (32 - s))) + b) | 0;
  }
  function ff(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & c) | (~b & d), a, b, x, s, t);
  }
  function gg(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn((b & d) | (c & ~d), a, b, x, s, t);
  }
  function hh(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(b ^ c ^ d, a, b, x, s, t);
  }
  function ii(a: number, b: number, c: number, d: number, x: number, s: number, t: number) {
    return cmn(c ^ (b | ~d), a, b, x, s, t);
  }
  function md51(s: string) {
    const n = s.length;
    const state = [1732584193, -271733879, -1732584194, 271733878];
    let i: number;
    for (i = 64; i <= n; i += 64) md5cycle(state, md5blk(s.substring(i - 64, i)));
    s = s.substring(i - 64);
    const tail = new Array(16).fill(0);
    for (i = 0; i < s.length; i++) tail[i >> 2] |= s.charCodeAt(i) << ((i % 4) << 3);
    tail[(i >> 2)] |= 0x80 << ((i % 4) << 3);
    if (i > 55) {
      md5cycle(state, tail);
      for (i = 0; i < 16; i++) tail[i] = 0;
    }
    tail[14] = n * 8;
    md5cycle(state, tail);
    return state;
  }
  function md5blk(s: string) {
    const md5blks = new Array(16);
    for (let i = 0; i < 16; i++) {
      md5blks[i] =
        s.charCodeAt(i * 4) +
        (s.charCodeAt(i * 4 + 1) << 8) +
        (s.charCodeAt(i * 4 + 2) << 16) +
        (s.charCodeAt(i * 4 + 3) << 24);
    }
    return md5blks;
  }
  function rhex(n: number) {
    const s = '0123456789abcdef';
    let j, out = '';
    for (j = 0; j < 4; j++) out += s.charAt((n >> (j * 8 + 4)) & 0x0f) + s.charAt((n >> (j * 8)) & 0x0f);
    return out;
  }
  function hex(x: number[]) {
    for (let i = 0; i < x.length; i++) x[i] = (x[i] >>> 0);
    return x.map(rhex).join('');
  }
  function md5(str: string) {
    return hex(md51(unescape(encodeURIComponent(str))));
  }
  const gravatarUrl = (email?: string, size = 48) => {
    if (!email) return undefined;
    const hash = md5(email.trim().toLowerCase());
    return `https://www.gravatar.com/avatar/${hash}?d=identicon&s=${size}`;
  };

  // State for collapsible file panels
  let expandedFiles = $state<Set<string>>(new Set());

  // Toggle file expansion
  const toggleFile = (filepath: string) => {
    if (expandedFiles.has(filepath)) {
      expandedFiles.delete(filepath);
    } else {
      expandedFiles.add(filepath);
    }
    expandedFiles = new Set(expandedFiles); // Trigger reactivity
  };

  // Get file status icon and styling
  const getFileStatusIcon = (status: string) => {
    switch (status) {
      case 'added':
        return { icon: FilePlus, class: 'text-green-600' };
      case 'deleted':
        return { icon: FileMinus, class: 'text-red-600' };
      case 'modified':
        return { icon: FileText, class: 'text-blue-600' };
      case 'renamed':
        return { icon: FileX, class: 'text-yellow-600' };
      default:
        return { icon: FileText, class: 'text-muted-foreground' };
    }
  };

  // Get file status badge styling
  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'added':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'deleted':
        return 'bg-red-100 text-red-800 border-red-200';
      case 'modified':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'renamed':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  // Calculate diff stats for each file
  const getFileStats = (hunks: any[]) => {
    let additions = 0;
    let deletions = 0;
    
    for (const hunk of hunks) {
      for (const patch of hunk.patches) {
        // Accept both SplitDiff ('+', '-') and parse-diff ('add','del','normal') styles
        const t = patch.type;
        if (t === '+' || t === 'add') additions++;
        else if (t === '-' || t === 'del') deletions++;
      }
    }
    
    return { additions, deletions };
  };

  // Calculate total diff stats
  const totalStats = $derived(() => {
    let totalAdditions = 0;
    let totalDeletions = 0;
    
    for (const change of changes) {
      const stats = getFileStats(change.diffHunks);
      totalAdditions += stats.additions;
      totalDeletions += stats.deletions;
    }
    
    return { totalAdditions, totalDeletions };
  });

  // Normalize hunks for SplitDiff to ensure patch.type is one of '+', '-', ' '
  const normalizeHunks = (hunks: any[]) => {
    if (!Array.isArray(hunks)) return [];
    return hunks.map((h) => ({
      oldStart: h.oldStart,
      oldLines: h.oldLines,
      newStart: h.newStart,
      newLines: h.newLines,
      patches: (h.patches || []).map((p: any) => ({
        line: p.line,
        type: p.type === 'add' ? '+' : p.type === 'del' ? '-' : (p.type === ' ' || p.type === '+' || p.type === '-' ? p.type : ' '),
      })),
    }));
  };

  // Expand all files by default if there are few changes
  $effect(() => {
    if (changes.length <= 5) {
      expandedFiles = new Set(changes.map(change => change.path));
    }
  });
</script>

<svelte:head>
  <title>Commit {commitMeta.sha.slice(0, 7)} · {repoClass.repoEvent?.content ? JSON.parse(repoClass.repoEvent.content).name : 'Repository'}</title>
</svelte:head>

<div class="min-h-screen bg-background">
  <!-- Commit Header -->
  <CommitHeader
    sha={commitMeta.sha}
    author={commitMeta.author}
    email={commitMeta.email}
    date={commitMeta.date}
    message={commitMeta.message}
    parents={commitMeta.parents}
    avatarUrl={gravatarUrl(commitMeta.email)}
    displayName={commitMeta.author}
  />

  <!-- Diff Summary -->
  <div class="border-b border-border bg-card px-6 py-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-4">
        <h2 class="text-lg font-semibold text-foreground">
          {changes.length} {changes.length === 1 ? 'file' : 'files'} changed
        </h2>
        <div class="flex items-center gap-3 text-sm text-muted-foreground">
          <div class="rounded-lg border bg-muted/20 px-2 py-1 text-center">
            <span class="text-green-600">+{totalStats().totalAdditions}</span>
          </div>
          <div class="rounded-lg border bg-muted/20 px-2 py-1 text-center">
            <span class="text-red-600">-{totalStats().totalDeletions}</span>
          </div>
        </div>
      </div>
      
      <!-- Expand/Collapse All -->
      <div class="flex items-center gap-2">
        <button
          onclick={() => {
            expandedFiles = new Set(changes.map(change => change.path));
          }}
          class="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Expand all
        </button>
        <span class="text-muted-foreground">|</span>
        <button
          onclick={() => {
            expandedFiles = new Set();
          }}
          class="text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          Collapse all
        </button>
      </div>
    </div>
  </div>

  <!-- File Changes -->
  <div class="divide-y divide-border">
    {#each changes as change (change.path)}
      {@const isExpanded = expandedFiles.has(change.path)}
      {@const statusInfo = getFileStatusIcon(change.status)}
      {@const stats = getFileStats(change.diffHunks)}
      
      <div class="bg-background">
        <!-- File Header -->
        <button
          onclick={() => toggleFile(change.path)}
          class="w-full px-6 py-4 text-left hover:bg-muted/50 transition-colors focus:outline-none focus:bg-muted/50"
        >
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <!-- Expand/Collapse Icon -->
              {#if isExpanded}
                <ChevronDown class="h-4 w-4 text-muted-foreground" />
              {:else}
                <ChevronRight class="h-4 w-4 text-muted-foreground" />
              {/if}
              
              <!-- File Status Icon -->
              {#if statusInfo.icon}
                {@const IconComponent = statusInfo.icon}
                <IconComponent class="h-4 w-4 {statusInfo.class}" />
              {/if}
              
              <!-- File Path -->
              <span class="font-mono text-sm text-foreground">{change.path}</span>
              
              <!-- Status Badge -->
              <span class="rounded-full border px-2 py-0.5 text-xs font-medium {getStatusBadgeClass(change.status)}">
                {change.status}
              </span>
            </div>
            
            <!-- File Stats -->
            <div class="flex items-center gap-2 text-sm text-muted-foreground">
              {#if stats.additions > 0}
                <span class="text-green-600">+{stats.additions}</span>
              {/if}
              {#if stats.deletions > 0}
                <span class="text-red-600">-{stats.deletions}</span>
              {/if}
            </div>
          </div>
        </button>

        <!-- File Diff Content -->
        {#if isExpanded}
          <div class="px-6 pb-6">
            <SplitDiff hunks={normalizeHunks(change.diffHunks)} filepath={change.path} />
          </div>
        {/if}
      </div>
    {/each}
  </div>

  <!-- Empty State -->
  {#if changes.length === 0}
    <div class="px-6 py-12 text-center">
      <FileText class="mx-auto h-12 w-12 text-muted-foreground" />
      <h3 class="mt-4 text-lg font-medium text-foreground">No file changes</h3>
      <p class="mt-2 text-sm text-muted-foreground">
        This commit doesn't contain any file changes.
      </p>
    </div>
  {/if}
</div>

<style>
  /* Ensure proper font rendering for code */
  .font-mono {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  }
</style>
