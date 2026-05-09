<script lang="ts">
  import { onMount, onDestroy } from "svelte";
  import { Terminal } from "@xterm/xterm";
  import { FitAddon } from "@xterm/addon-fit";
  import { nip19 } from "nostr-tools";
  // Import xterm's CSS so the internal helper textarea is hidden and styling is applied
  import "@xterm/xterm/css/xterm.css";
  import { WorkerManager } from "../git/WorkerManager";
  import { parseRepoId } from "@nostr-git/core/utils";
  import { parseRepoAnnouncementEvent } from "@nostr-git/core/events";
  import { tokens as tokensStore } from "../../stores/tokens.js";
  import { tryTokensForHost, getTokensForHost } from "../../utils/tokenHelpers.js";
  // Instantiate worker via URL like core git-worker client does
  // Lazy import xterm only on mount to avoid SSR issues
  type Stream = "stdout" | "stderr";

  interface FSLike {
    stat(path: string): Promise<{ type: "file" | "dir"; size: number } | null>;
    readFile(path: string, encoding?: "utf8" | "arraybuffer"): Promise<string | Uint8Array>;
    writeFile(path: string, data: string | Uint8Array): Promise<void>;
    readdir(path: string): Promise<string[]>;
    mkdir(path: string): Promise<void>;
    rm(path: string, opts?: { recursive?: boolean }): Promise<void>;
    mv(src: string, dst: string): Promise<void>;
    cp(src: string, dst: string): Promise<void>;
    touch(path: string): Promise<void>;
  }

  interface TerminalProps {
    repoRef: { relay: string; naddr: string; npub: string; repoId: string };
    repoEvent?: import("@nostr-git/core/events").RepoAnnouncementEvent;
    fs?: FSLike;
    relays: string[];
    theme?: "retro" | "dark" | "light" | Record<string, string>;
    height?: string | number;
    initialCwd?: string;
    urlAllowlist?: string[];
    outputLimit?: { bytes: number; lines: number; timeMs: number };
    onCommand?: (cmd: string) => void;
    onOutput?: (evt: { stream: Stream; chunk: string }) => void;
    onExit?: (evt: { code: number }) => void;
    onProgress?: (evt: any) => void;
    onToast?: (evt: { level: "info" | "warn" | "error"; message: string }) => void;
    // Optional repo defaults for CLI convenience
    repoCloneUrls?: string[];
    defaultRemoteUrl?: string;
    defaultBranch?: string;
    provider?: string;
    token?: string;
  }

  const {
    repoRef,
    fs,
    theme = "retro",
    height = 320,
    initialCwd = "/",
    urlAllowlist = [],
    outputLimit = { bytes: 1_000_000, lines: 10_000, timeMs: 30_000 },
    onCommand,
    onOutput,
    onExit,
    onProgress,
    onToast,
    repoCloneUrls,
    defaultRemoteUrl,
    defaultBranch,
    repoEvent,
    provider: defaultProvider,
    token: defaultToken,
  }: TerminalProps = $props();

  let containerEl: HTMLDivElement;
  let term: Terminal;
  let fitAddon: FitAddon;
  let worker: Worker | null = null;
  let wm: WorkerManager | null = null;

  let runningId: string | null = null;
  let cwd = $state("/");
  const history: string[] = [];
  let historyIdx = -1;
  // Track the branch the terminal operates on; initialized from defaultBranch prop
  let currentBranch = $state<string | undefined>(undefined);

  // Initialize and sync with prop changes
  $effect(() => {
    cwd = initialCwd ?? "/";
  });

  $effect(() => {
    currentBranch = defaultBranch;
  });

  // Toolbar actions
  function doClear() {
    term?.clear();
    onOutput?.({ stream: "stdout", chunk: "" });
  }

  function printPrompt() {
    term?.write(`\r\n${promptText()}`);
  }

  function promptText(): string {
    const branch = currentBranch ? ` [${currentBranch}]` : "";
    return `${cwd}${branch} $ `;
  }

  function printWelcome() {
    const art = ["  Flotilla-Budabit", ""].join("\n");
    const help = [
      "  Type 'help' to list available commands.",
      "  Ctrl+C to cancel • Ctrl+L to clear",
      "",
    ].join("\n");
    termWrite("stdout", `\r\n${art}\n${help}`);
  }

  function printHelp(topic?: string) {
    const lines: string[] = [];
    const showFS = !topic || topic.toLowerCase() === "fs";
    const showGit = !topic || topic.toLowerCase() === "git";
    lines.push("");
    lines.push("Available commands:");
    if (showFS) {
      lines.push("  FS:");
      lines.push("   - ls [path]              list directory contents");
      lines.push("   - cd <path>              change directory");
      lines.push("   - pwd                    print current directory");
      lines.push("   - cat <file>             print file contents");
      lines.push("   - mkdir <dir>            create directory");
      lines.push("   - rm [-r] <path>         remove file or directory");
      lines.push("   - cp <src> <dst>         copy file or directory");
      lines.push("   - mv <src> <dst>         move/rename file or directory");
      lines.push("   - touch <file>           create empty file");
      lines.push("");
    }
    if (showGit) {
      lines.push("  Git:");
      lines.push("   - git status             show working tree status");
      lines.push("   - git log [--oneline]    show commit history");
      lines.push("   - git fetch              download objects and refs");
      lines.push("   - git pull               fetch and merge (or rebase)");
      lines.push("   - git push               push current branch to remote");
      lines.push("   - git branch             list branches");
      lines.push("   - git checkout <name>    switch branch");
      lines.push("   - git switch <name>      switch branch");
      lines.push("   - git add <paths>        stage changes");
      lines.push("   - git diff               show changes");
      lines.push("   - git show <obj>         show object details");
      lines.push("");
    }
    lines.push("Tips: type 'help fs' or 'help git' for a shorter list.");
    termWrite("stdout", lines.join("\n"));
  }

  function termWrite(stream: Stream, text: string) {
    term?.write(text.replace(/\n/g, "\r\n"));
    onOutput?.({ stream, chunk: text });
  }

  // ---------------- FS Bridge ----------------
  // Provide a default in-memory FS if no fs prop was supplied
  type Stat = { type: "file" | "dir"; size: number } | null;
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  const vfsDirs = new Set<string>(["/"]);
  const vfsFiles = new Map<string, Uint8Array>();

  function normPath(p: string): string {
    if (!p) return "/";
    // collapse // and resolve .. and . segments very simply
    const parts = p.split("/");
    const out: string[] = [];
    for (const seg of parts) {
      if (!seg || seg === ".") continue;
      if (seg === "..") {
        out.pop();
        continue;
      }
      out.push(seg);
    }
    return "/" + out.join("/");
  }
  function parentDir(p: string): string {
    const n = normPath(p);
    const i = n.lastIndexOf("/");
    return i <= 0 ? "/" : n.slice(0, i);
  }
  async function repoExistsDir(path: string): Promise<boolean> {
    if (!repoEvent) return false;
    const mgr = await ensureWM();
    try {
      const rel = path === "/" ? undefined : path.replace(/^\//, "");
      const list = await mgr.listRepoFilesFromEvent({
        repoEvent,
        branch: currentBranch,
        path: rel,
        repoKey: repoRef?.repoId,
      });
      return Array.isArray(list);
    } catch {
      return false;
    }
  }
  async function repoExistsFile(path: string): Promise<boolean> {
    if (!repoEvent) return false;
    const mgr = await ensureWM();
    try {
      const rel = path.replace(/^\//, "");
      return await mgr.fileExistsAtCommit({
        repoEvent,
        branch: currentBranch,
        path: rel,
        repoKey: repoRef?.repoId,
      });
    } catch {
      return false;
    }
  }
  async function repoRead(
    path: string,
    encoding?: "utf8" | "arraybuffer"
  ): Promise<string | Uint8Array> {
    const mgr = await ensureWM();
    const rel = path.replace(/^\//, "");
    const res = await mgr.getRepoFileContentFromEvent({
      repoEvent: repoEvent!,
      branch: currentBranch,
      path: rel,
      repoKey: repoRef?.repoId,
    });
    const text = typeof res === "string" ? res : String(res?.text ?? "");
    if (encoding === "utf8" || !encoding) return text;
    return textEncoder.encode(text);
  }

  const defaultFS: FSLike = {
    async stat(path: string): Promise<Stat> {
      const n = normPath(path);
      if (vfsDirs.has(n)) return { type: "dir", size: 0 };
      const f = vfsFiles.get(n);
      if (f) return { type: "file", size: f.byteLength };
      // Fallback to repo-backed read-only view
      if (repoEvent) {
        if (await repoExistsDir(n)) return { type: "dir", size: 0 };
        if (await repoExistsFile(n)) {
          // Size unknown without fetching; omit or estimate via text length
          return { type: "file", size: 0 };
        }
      }
      return null;
    },
    async readFile(path: string, encoding?: "utf8" | "arraybuffer"): Promise<string | Uint8Array> {
      const n = normPath(path);
      const data = vfsFiles.get(n);
      if (data) {
        if (encoding === "utf8") return textDecoder.decode(data);
        return data;
      }
      if (repoEvent && (await repoExistsFile(n))) {
        return await repoRead(n, encoding);
      }
      throw new Error("ENOENT");
    },
    async writeFile(path: string, data: string | Uint8Array): Promise<void> {
      const n = normPath(path);
      const dir = parentDir(n);
      if (!vfsDirs.has(dir)) throw new Error("ENOENT: parent directory");
      const buf = typeof data === "string" ? textEncoder.encode(data) : new Uint8Array(data);
      vfsFiles.set(n, buf);
    },
    async readdir(path: string): Promise<string[]> {
      const n = normPath(path);
      const seen = new Set<string>();
      if (vfsDirs.has(n)) {
        // Overlay dirs/files
        const prefix = n === "/" ? "/" : n + "/";
        for (const d of vfsDirs)
          if (d.startsWith(prefix) && d !== n) {
            const rest = d.slice(prefix.length);
            if (rest) seen.add(rest.split("/")[0]!);
          }
        for (const f of vfsFiles.keys())
          if (f.startsWith(prefix)) {
            const rest = f.slice(prefix.length);
            if (rest) seen.add(rest.split("/")[0]!);
          }
      }
      // Merge repo directory listing if available
      if (repoEvent) {
        try {
          const mgr = await ensureWM();
          const rel = n === "/" ? undefined : n.replace(/^\//, "");
          const list = await mgr.listRepoFilesFromEvent({
            repoEvent,
            branch: defaultBranch,
            path: rel,
            repoKey: repoRef?.repoId,
          });
          if (Array.isArray(list))
            for (const entry of list as any[]) {
              const name = typeof entry === "string" ? entry : (entry?.name ?? String(entry));
              if (name) seen.add(String(name));
            }
        } catch (e: any) {
          if (seen.size === 0) {
            throw new Error(e?.message || String(e) || "repo listing failed");
          }
        }
      }
      if (!vfsDirs.has(n) && !(repoEvent && (await repoExistsDir(n)))) throw new Error("ENOTDIR");
      return Array.from(seen.values()).sort();
    },
    async mkdir(path: string): Promise<void> {
      const n = normPath(path);
      const dir = parentDir(n);
      if (!vfsDirs.has(dir)) throw new Error("ENOENT: parent directory");
      vfsDirs.add(n);
    },
    async rm(path: string, opts?: { recursive?: boolean }): Promise<void> {
      const n = normPath(path);
      if (vfsFiles.has(n)) {
        vfsFiles.delete(n);
        return;
      }
      if (vfsDirs.has(n)) {
        const hasChildren =
          Array.from(vfsDirs).some((d) => d !== n && d.startsWith(n + "/")) ||
          Array.from(vfsFiles.keys()).some((f) => f.startsWith(n === "/" ? "/" : n + "/"));
        if (hasChildren && !opts?.recursive) throw new Error("ENOTEMPTY");
        // delete subtree
        for (const d of Array.from(vfsDirs))
          if (d === n || d.startsWith(n + "/")) vfsDirs.delete(d);
        for (const f of Array.from(vfsFiles.keys()))
          if (f === n || f.startsWith(n + "/")) vfsFiles.delete(f);
        return;
      }
      throw new Error("ENOENT");
    },
    async mv(src: string, dst: string): Promise<void> {
      const s = normPath(src),
        d = normPath(dst);
      // file
      if (vfsFiles.has(s)) {
        const dir = parentDir(d);
        if (!vfsDirs.has(dir)) throw new Error("ENOENT: parent directory");
        vfsFiles.set(d, vfsFiles.get(s)!);
        vfsFiles.delete(s);
        return;
      }
      // dir
      if (vfsDirs.has(s)) {
        const dir = parentDir(d);
        if (!vfsDirs.has(dir)) throw new Error("ENOENT: parent directory");
        vfsDirs.add(d);
        for (const dd of Array.from(vfsDirs)) {
          if (dd === s || dd.startsWith(s + "/")) {
            const rest = dd.slice(s.length);
            vfsDirs.add(normPath(d + rest));
            vfsDirs.delete(dd);
          }
        }
        for (const ff of Array.from(vfsFiles.keys())) {
          if (ff === s || ff.startsWith(s + "/")) {
            const rest = ff.slice(s.length);
            vfsFiles.set(normPath(d + rest), vfsFiles.get(ff)!);
            vfsFiles.delete(ff);
          }
        }
        return;
      }
      throw new Error("ENOENT");
    },
    async cp(src: string, dst: string): Promise<void> {
      const s = normPath(src),
        d = normPath(dst);
      if (vfsFiles.has(s)) {
        const dir = parentDir(d);
        if (!vfsDirs.has(dir)) throw new Error("ENOENT: parent directory");
        const buf = vfsFiles.get(s)!;
        vfsFiles.set(d, new Uint8Array(buf));
        return;
      }
      if (vfsDirs.has(s)) {
        const dir = parentDir(d);
        if (!vfsDirs.has(dir)) throw new Error("ENOENT: parent directory");
        vfsDirs.add(d);
        for (const dd of Array.from(vfsDirs)) {
          if (dd === s || dd.startsWith(s + "/")) {
            const rest = dd.slice(s.length);
            vfsDirs.add(normPath(d + rest));
          }
        }
        for (const ff of Array.from(vfsFiles.keys())) {
          if (ff === s || ff.startsWith(s + "/")) {
            const rest = ff.slice(s.length);
            const buf = vfsFiles.get(ff)!;
            vfsFiles.set(normPath(d + rest), new Uint8Array(buf));
          }
        }
        return;
      }
      throw new Error("ENOENT");
    },
    async touch(path: string): Promise<void> {
      const n = normPath(path);
      const dir = parentDir(n);
      if (!vfsDirs.has(dir)) throw new Error("ENOENT: parent directory");
      if (!vfsFiles.has(n)) vfsFiles.set(n, new Uint8Array());
    },
  };

  function getFS(): FSLike {
    return fs || defaultFS;
  }

  // Ensure data sent back to the terminal worker is structured-cloneable
  function toSerializable<T>(val: T): T {
    try {
      // Drop functions, Proxies, and non-serializable fields
      return JSON.parse(JSON.stringify(val));
    } catch {
      return val;
    }
  }

  async function ensureWM() {
    if (!wm) wm = new WorkerManager((evt) => onProgress?.(evt));
    if (!wm.isReady) await wm.initialize();
    return wm;
  }

  // Resolve the canonical repoId used by the worker filesystem (owner:name)
  function getCanonicalRepoId(): string {
    try {
      const ownerRaw = repoEvent?.pubkey;
      const name = repoEvent ? parseRepoAnnouncementEvent(repoEvent).name : undefined;
      if (ownerRaw && name) {
        const owner =
          defaultProvider === "grasp" && !ownerRaw.startsWith("npub1")
            ? nip19.npubEncode(ownerRaw)
            : ownerRaw;
        return parseRepoId(`${owner}:${name}`);
      }
    } catch (error) {
      void error;
    }
    return repoRef?.repoId;
  }

  async function handleGitRpc(op: string, params: any): Promise<any> {
    console.log("[Terminal] handleGitRpc called:", { op, params });
    const mgr = await ensureWM();
    console.log("[Terminal] WorkerManager ready:", mgr);

    if (op === "git.status") {
      try {
        const repoId = getCanonicalRepoId();
        const branch = params?.branch ?? currentBranch;
        console.log("[Terminal] git.status params:", { repoId, branch });
        if (!repoId) return { text: "error: git status requires repoId\n" };

        console.log("[Terminal] Calling mgr.getStatus...");
        const res = await mgr.getStatus({ repoId, branch });
        console.log("[Terminal] mgr.getStatus result:", res);

        if (res?.success === false) {
          return { text: `error: status failed: ${res?.error || "unknown"}\n` };
        }
        const out =
          res?.text ||
          [`On branch ${res?.branch || branch || ""}`, ""]
            .concat((res?.files || []).map((f: any) => `${f.status}\t${f.path}`))
            .join("\n");
        return { text: out.endsWith("\n") ? out : out + "\n" };
      } catch (e: any) {
        console.error("[Terminal] git.status error:", e);
        return { text: `error: status exception: ${e?.message || String(e)}\n` };
      }
    }
    if (op === "git.log") {
      const depth = params.depth ?? 50;
      const branch = params.branch ?? currentBranch;
      const oneline: boolean = !!params.oneline;
      const hist = await mgr.getCommitHistory({ repoId: getCanonicalRepoId(), branch, depth });
      if (!hist || hist.success === false) {
        throw new Error(hist?.error || "log unavailable");
      }
      const commits: any[] = hist.commits || hist.items || [];
      const fmt = (c: any) => {
        const sha = (c.oid || c.sha || "").toString();
        const short = sha ? sha.substring(0, 7) : "";
        const msg = (c.message || c.msg || "").split("\n")[0];
        const author = c.author?.name || c.author || "";
        const date = c.author?.timestamp
          ? new Date(c.author.timestamp * 1000)
          : c.date
            ? new Date(c.date)
            : null;
        if (oneline) return `${short} ${msg}`;
        return [
          `commit ${sha}`,
          author ? `Author: ${author}` : undefined,
          date ? `Date:   ${date.toISOString()}` : undefined,
          "",
          `    ${msg}`,
          "",
        ]
          .filter(Boolean)
          .join("\n");
      };
      const text = commits.map(fmt).join(oneline ? "\n" : "\n");
      return { text: text.endsWith("\n") ? text : text + "\n" };
    }
    if (op === "git.show") {
      const { object } = params || {};
      const repoId = getCanonicalRepoId();
      if (!repoId || !object) return { text: "error: git show requires an object id\n" };
      try {
        const det = await mgr.getCommitDetails({
          repoId,
          commitId: object,
          branch: params.branch ?? currentBranch,
        });
        if (!det?.success) return { text: `error: show failed: ${det?.error || "unknown"}\n` };
        const meta = det.meta || {};
        const header = [
          `commit ${meta.sha || object}`,
          meta.author
            ? `Author: ${meta.author}${meta.email ? " <" + meta.email + ">" : ""}`
            : undefined,
          meta.date ? `Date:   ${new Date(meta.date).toISOString()}` : undefined,
          "",
          ...(meta.message
            ? String(meta.message)
                .split("\n")
                .map((l: string) => `    ${l}`)
            : []),
          "",
        ]
          .filter(Boolean)
          .join("\n");
        const files = det.changes || [];
        const body = files
          .map((f: any) => {
            const hunks = (f.diffHunks || []).flatMap((h: any) => h.patches || []);
            const lines = hunks.map((p: any) => `${p.type}${p.line}`);
            const hdr = `diff -- ${f.path}`;
            return [hdr, ...lines, ""].join("\n");
          })
          .join("");
        const out = header + (body ? body : "");
        return { text: out.endsWith("\n") ? out : out + "\n" };
      } catch (e: any) {
        return { text: `error: show exception: ${e?.message || String(e)}\n` };
      }
    }
    if (op === "git.add") {
      // Staging is not yet supported in worker API. Return a friendly message.
      return { text: "warning: staging (git add) is not yet supported in this terminal\n" };
    }
    if (op === "git.commit") {
      const message = params?.message || "";
      const msg = message ? ` (${message})` : "";
      return { text: `warning: git commit${msg} is not yet supported in this terminal\n` };
    }
    if (op === "git.diff") {
      // Phase 1: show diff for the latest commit vs parent (HEAD)
      try {
        const repoId = getCanonicalRepoId();
        const branch = params?.branch ?? currentBranch;
        const hist = await (await ensureWM()).getCommitHistory({ repoId, branch, depth: 2 });
        const commits: any[] = hist?.commits || hist?.items || [];
        if (!commits.length) return { text: "warning: no commits to diff\n" };
        const head = String(commits[0]?.oid || commits[0]?.sha || "");
        if (!head) return { text: "warning: cannot resolve HEAD\n" };
        const det = await (await ensureWM()).getCommitDetails({ repoId, commitId: head, branch });
        if (!det?.success) return { text: `error: diff failed: ${det?.error || "unknown"}\n` };
        const files = det.changes || [];
        const body = files
          .map((f: any) => {
            const hunks = (f.diffHunks || []).flatMap((h: any) => h.patches || []);
            const lines = hunks.map((p: any) => `${p.type}${p.line}`);
            const hdr = `diff -- ${f.path}`;
            return [hdr, ...lines, ""].join("\n");
          })
          .join("");
        const out = body || "no changes\n";
        return { text: out.endsWith("\n") ? out : out + "\n" };
      } catch (e: any) {
        return { text: `error: diff exception: ${e?.message || String(e)}\n` };
      }
    }
    if (op === "git.push") {
      const { repoId, remoteUrl: ru, branch, provider, token, cloneUrls } = params || {};
      const remoteCandidates = Array.from(
        new Set(
          [
            ...(ru ? [ru] : []),
            ...(!ru && defaultRemoteUrl ? [defaultRemoteUrl] : []),
            ...(!ru && !defaultRemoteUrl && Array.isArray(cloneUrls) ? cloneUrls : []),
            ...(!ru && !defaultRemoteUrl && Array.isArray(repoCloneUrls) ? repoCloneUrls : []),
          ]
            .map((value) => String(value || "").trim())
            .filter(Boolean)
        )
      );
      const useProvider = provider ?? defaultProvider;
      const useBranch = branch ?? currentBranch;
      if (!repoId || remoteCandidates.length === 0) {
        return { text: "error: git push requires repoId and remoteUrl (or cloneUrls[])\n" };
      }

      const pushToRemote = async (remoteUrl: string) => {
        // Extract hostname for token matching
        let hostname: string;
        try {
          if (remoteUrl.startsWith("git@")) {
            const match = remoteUrl.match(/git@([^:]+):/);
            hostname = match ? match[1] : "";
          } else {
            const urlObj = new URL(remoteUrl);
            hostname = urlObj.hostname;
          }
        } catch {
          hostname = "";
        }

        const tokens = await tokensStore.waitForInitialization();
        const matchingTokens = getTokensForHost(tokens, hostname);

        if (token) {
          return await mgr.safePushToRemote({
            repoId,
            remoteUrl,
            branch: useBranch,
            provider: useProvider,
            token,
            allowForce: false,
            preflight: {
              blockIfUncommitted: true,
              requireUpToDate: true,
              blockIfShallow: true,
            },
          });
        }

        if (matchingTokens.length > 0) {
          return await tryTokensForHost(tokens, hostname, async (resolvedToken: string) => {
            return await mgr.safePushToRemote({
              repoId,
              remoteUrl,
              branch: useBranch,
              provider: useProvider,
              token: resolvedToken,
              allowForce: false,
              preflight: {
                blockIfUncommitted: true,
                requireUpToDate: true,
                blockIfShallow: true,
              },
            });
          });
        }

        if (defaultToken) {
          return await mgr.safePushToRemote({
            repoId,
            remoteUrl,
            branch: useBranch,
            provider: useProvider,
            token: defaultToken,
            allowForce: false,
            preflight: {
              blockIfUncommitted: true,
              requireUpToDate: true,
              blockIfShallow: true,
            },
          });
        }

        return await mgr.safePushToRemote({
          repoId,
          remoteUrl,
          branch: useBranch,
          provider: useProvider,
          allowForce: false,
          preflight: {
            blockIfUncommitted: true,
            requireUpToDate: true,
            blockIfShallow: true,
          },
        });
      };

      try {
        const errors: string[] = [];

        for (const remoteUrl of remoteCandidates) {
          const pushResult = await pushToRemote(remoteUrl);

          if (pushResult?.success) {
            const b = pushResult.branch || useBranch || "";
            return { text: `Pushed ${b} to ${remoteUrl}\n` };
          }

          if (pushResult?.requiresConfirmation) {
            errors.push(
              `${remoteUrl}: ${pushResult?.warning || "force push requires confirmation"}`
            );
            continue;
          }

          const reason = pushResult?.reason ? ` (${pushResult.reason})` : "";
          if (pushResult?.reason === "workflow_scope_missing") {
            errors.push(
              `${remoteUrl}: ${pushResult?.error || "workflow scope missing"}. GitHub requires workflow token scope for .github/workflows changes.`
            );
            continue;
          }

          errors.push(`${remoteUrl}: ${pushResult?.error || `push blocked${reason}`}`);
        }

        return {
          text:
            `error: push failed for all ${remoteCandidates.length} remote candidates\n` +
            errors.map((entry) => `- ${entry}`).join("\n") +
            "\n",
        };
      } catch (e: any) {
        return { text: `error: push exception: ${e?.message || String(e)}\n` };
      }
    }
    if (op === "git.pull") {
      const { repoId, cloneUrls, branch } = params || {};
      const urls =
        Array.isArray(cloneUrls) && cloneUrls.length > 0 ? cloneUrls : repoCloneUrls || [];
      if (!repoId || urls.length === 0) {
        return { text: "error: git pull requires repoId and cloneUrls[]\n" };
      }
      try {
        const res = await mgr.syncWithRemote({
          repoId,
          cloneUrls: urls,
          branch: branch ?? currentBranch,
        });
        if (res?.success) {
          const b = res.branch || branch || currentBranch || "";
          const head = res.headCommit ? ` (${res.headCommit})` : "";
          return { text: `Updated local ${b} to remote HEAD${head}\n` };
        }
        return { text: `error: pull failed: ${res?.error || "unknown error"}\n` };
      } catch (e: any) {
        const msg = e?.message || String(e);
        if (msg && msg.includes("Proxy object could not be cloned")) {
          // Comlink tried to transfer a non-serializable/proxied result. Provide a friendly message.
          return {
            text: "warning: git pull is not available in this terminal yet (worker returned a non-transferable value). Use the UI Pull action instead.\n",
          };
        }
        return { text: `error: pull exception: ${msg}\n` };
      }
    }
    if (op === "git.branch") {
      // List branches using repoEvent if available
      if (!repoEvent) {
        return { text: "error: branch listing requires repoEvent in this terminal\n" };
      }
      try {
        const res = await mgr.listBranchesFromEvent({ repoEvent });
        const branches: string[] = Array.isArray(res)
          ? res.map((b: any) => (typeof b === "string" ? b : (b?.name ?? String(b))))
          : Array.isArray(res?.branches)
            ? res.branches
            : [];
        if (!branches.length) return { text: "no branches found\n" };
        const lines = branches.map((b) => (b === currentBranch ? `* ${b}` : `  ${b}`));
        return { text: lines.join("\n") + "\n" };
      } catch (e: any) {
        return { text: `error: branch: ${e?.message || String(e)}\n` };
      }
    }
    if (op === "git.checkout") {
      const repoId = params?.repoId;
      const branch = params?.branch as string | undefined;
      if (!repoId || !branch) return { text: "error: checkout requires repoId and branch\n" };
      try {
        // Optionally verify branch exists if repoEvent present
        if (repoEvent) {
          try {
            const res = await mgr.listBranchesFromEvent({ repoEvent });
            const branches: string[] = Array.isArray(res)
              ? res.map((b: any) => (typeof b === "string" ? b : (b?.name ?? String(b))))
              : Array.isArray(res?.branches)
                ? res.branches
                : [];
            if (branches.length && !branches.includes(branch)) {
              return { text: `error: branch '${branch}' not found\n` };
            }
          } catch (error) {
            void error;
          }
        }
        // Sync to the target branch to ensure local state, if clone URLs available
        if (Array.isArray(repoCloneUrls) && repoCloneUrls.length > 0) {
          try {
            await mgr.syncWithRemote({ repoId, cloneUrls: repoCloneUrls, branch });
          } catch (error) {
            void error;
          }
        }
        currentBranch = branch;
        return { text: `Switched to branch '${branch}'\n` };
      } catch (e: any) {
        return { text: `error: checkout: ${e?.message || String(e)}\n` };
      }
    }
    throw new Error(`Unknown git op: ${op}`);
  }

  async function ensureWorker() {
    if (worker) return;

    const isDev = (import.meta as any)?.env?.DEV ?? false;
    const base =
      (import.meta as any)?.env?.BASE_URL ??
      (document.querySelector("base")?.getAttribute("href") || "/");
    const normalizedBase = String(base).endsWith("/") ? String(base).slice(0, -1) : String(base);

    // Always use URL constructor for proper Vite handling
    const workerUrl = isDev
      ? new URL("./worker/cli.ts", import.meta.url)
      : new URL(`${normalizedBase || ""}/_app/lib/terminal/worker/cli.js`, window.location.origin);

    console.debug("[terminal] creating worker at", workerUrl.toString());

    try {
      const w = new Worker(workerUrl, { type: "module" });

      // Strict handshake: wait for explicit "ready" message from worker
      const ok = await new Promise<boolean>((resolve) => {
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        }, 2000); // wait up to 2s for ready
        const onError = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(false);
        };
        const onMsg = (ev: MessageEvent) => {
          if (settled) return;
          if (ev?.data?.type === "ready") {
            settled = true;
            clearTimeout(timer);
            w.removeEventListener("message", onMsg as any);
            resolve(true);
          }
        };
        w.addEventListener("error", onError, { once: true });
        w.addEventListener("messageerror", onError as any, { once: true });
        w.addEventListener("message", onMsg as any);
      });

      if (!ok) {
        console.debug("[terminal] worker boot failed for", workerUrl);
        w.terminate();
        throw new Error(`Terminal worker failed to initialize: ${workerUrl}`);
      }

      worker = w;
    } catch (e) {
      console.error("[terminal] failed to initialize worker", e);
      throw e;
    }

    // Initial handshake
    worker.postMessage({ type: "config", repoRef, urlAllowlist, outputLimit });

    // Surface worker-level errors to the terminal and console for diagnosis
    worker.addEventListener("error", (e: ErrorEvent) => {
      console.error("[terminal-worker:error]", e);
      termWrite("stderr", `[worker] ${e.message}\n`);
    });
    worker.addEventListener("messageerror", (e: MessageEvent) => {
      console.error("[terminal-worker:messageerror]", e);
      termWrite("stderr", `[worker] message error\n`);
    });

    // Stream FS/Git/stdio responses
    worker.onmessage = async (ev: MessageEvent) => {
      const msg = ev.data;
      switch (msg.type) {
        case "stdout":
          termWrite("stdout", msg.data);
          break;
        case "stderr":
          termWrite("stderr", msg.data);
          break;
        case "exit":
          console.debug("[terminal] exit", msg);
          runningId = null;
          onExit?.({ code: msg.code });
          printPrompt();
          break;
        case "progress":
          onProgress?.(msg);
          break;
        case "toast":
          onToast?.(msg);
          break;
        case "fs": {
          const { op, id, args } = msg;
          try {
            const f = getFS();
            let result: any;
            if (op === "stat") result = await f.stat(args[0]);
            else if (op === "readFile") result = await f.readFile(args[0], args[1]);
            else if (op === "writeFile") {
              await f.writeFile(args[0], args[1]);
              result = true;
            } else if (op === "readdir") result = await f.readdir(args[0]);
            else if (op === "mkdir") {
              await f.mkdir(args[0]);
              result = true;
            } else if (op === "rm") {
              await f.rm(args[0], args[1]);
              result = true;
            } else if (op === "mv") {
              await f.mv(args[0], args[1]);
              result = true;
            } else if (op === "cp") {
              await f.cp(args[0], args[1]);
              result = true;
            } else if (op === "touch") {
              await f.touch(args[0]);
              result = true;
            } else throw new Error("unsupported fs op");
            const safe = toSerializable(result);
            worker?.postMessage({ type: "fs:result", id, ok: true, result: safe });
          } catch (e: any) {
            worker?.postMessage({
              type: "fs:result",
              id,
              ok: false,
              error: e?.message || String(e),
            });
          }
          break;
        }
        case "git": {
          console.debug("[terminal] git request", msg);
          const { op, id, params } = msg;
          try {
            const result = await handleGitRpc(op, params);
            const safe = toSerializable(result);
            console.debug("[terminal] git result ok", { op, id, result: safe });
            worker?.postMessage({ type: "git:result", id, ok: true, result: safe });
          } catch (e: any) {
            console.debug("[terminal] git result error", {
              op,
              id,
              error: e?.message || String(e),
            });
            worker?.postMessage({
              type: "git:result",
              id,
              ok: false,
              error: e?.message || String(e),
            });
          }
          break;
        }
        // Duplicate FS handler removed; unified handler below uses getFS() overlay
        case "cwd":
          cwd = msg.path;
          break;
      }
    };
  }

  async function initXterm() {
    fitAddon = new FitAddon();
    term = new Terminal({
      fontFamily:
        'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 12,
      convertEol: true,
      cursorBlink: true,
      theme:
        (theme ?? "dark") === "retro"
          ? {
              background: "#001b00",
              foreground: "#00ff66",
              cursor: "#00ff66",
              selectionBackground: "#003300",
            }
          : (theme ?? "dark") === "dark"
            ? undefined
            : undefined,
    });
    term.loadAddon(fitAddon);
    term.open(containerEl);
    fitAddon.fit();

    // Keyboard handling (Ctrl+C, Ctrl+L, history)
    term.onKey(({ key, domEvent }: any) => {
      // Ctrl+L: clear screen
      if (domEvent.ctrlKey && (domEvent.key === "l" || domEvent.key === "L")) {
        domEvent.preventDefault();
        doClear();
        printPrompt();
        return;
      }
      // Up/Down for history
      if (domEvent.key === "ArrowUp") {
        domEvent.preventDefault();
        if (history.length > 0) {
          historyIdx = historyIdx <= 0 ? history.length - 1 : historyIdx - 1;
          // naive redraw
          term.write(`\r\n`);
          const cmd = history[historyIdx] || "";
          termWrite("stdout", `${promptText()}${cmd}`);
          inputBuffer = cmd;
        }
        return;
      }
      if (domEvent.key === "ArrowDown") {
        domEvent.preventDefault();
        if (history.length > 0) {
          historyIdx = historyIdx >= history.length - 1 ? 0 : historyIdx + 1;
          term.write(`\r\n`);
          const cmd = history[historyIdx] || "";
          termWrite("stdout", `${promptText()}${cmd}`);
          inputBuffer = cmd;
        }
        return;
      }
      // Default: push data
      const data = key;
      // Ctrl+C
      if (domEvent.ctrlKey && (domEvent.key === "c" || domEvent.key === "C")) {
        domEvent.preventDefault();
        abort();
        printPrompt();
        inputBuffer = "";
        return;
      }
      // Handle Backspace
      if (domEvent.key === "Backspace" || data === "\x7f") {
        domEvent.preventDefault();
        if (inputBuffer.length > 0) {
          // erase last char visually and from buffer
          inputBuffer = inputBuffer.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }
      // Enter triggers command execution (do not echo '\r')
      if (data === "\r") {
        const line = inputBuffer.replace(/\r/g, "").trim();
        inputBuffer = "";
        // move to next line before command output begins
        term.write("\r\n");
        if (line.length) {
          history.push(line);
          if (history.length > 500) history.shift();
          historyIdx = -1;
          void runCommand(line);
        } else {
          printPrompt();
        }
        return;
      }
      // Echo printable characters and append to buffer
      if (data && data !== "\n") {
        inputBuffer += data;
        term.write(data);
      }
    });

    printWelcome();
    printPrompt();
    window.addEventListener("resize", () => fitAddon?.fit());
  }

  let inputBuffer = "";

  function makeId(): string {
    const g: any = globalThis as any;
    const rnd = () => Math.random().toString(36).slice(2);
    if (g?.crypto && typeof g.crypto.randomUUID === "function") {
      try {
        return g.crypto.randomUUID();
      } catch (error) {
        void error;
      }
    }
    return `${Date.now().toString(36)}-${rnd()}-${rnd()}`;
  }

  export async function runCommand(cmd: string): Promise<number> {
    const tokens = tokenize(cmd);
    const primary = tokens[0]?.toLowerCase();
    if (!primary) {
      printPrompt();
      return 0;
    }
    // Built-in client commands
    if (primary === "help" || primary === "?") {
      printHelp(tokens[1]);
      printPrompt();
      return 0;
    }
    if (primary === "clear" || primary === "cls") {
      doClear();
      printPrompt();
      return 0;
    }
    await ensureWorker();
    onCommand?.(cmd);
    const id = makeId();
    runningId = id;
    worker!.postMessage({ type: "run", id, cwd, argv: tokens });
    return 0;
  }

  export function abort() {
    if (runningId) {
      worker?.postMessage({ type: "abort", id: runningId });
    } else {
      termWrite("stdout", "^C");
    }
  }

  export function focus() {
    term?.focus?.();
  }
  export function clear() {
    doClear();
  }

  // Optional helper used by feed-bridge to print hints inline
  export function printHint(text: string) {
    termWrite("stdout", `\r\n[feed] ${text}\n`);
    printPrompt();
  }

  function tokenize(s: string): string[] {
    // Very simple tokenizer with quoted strings
    const out: string[] = [];
    let cur = "";
    let q: '"' | "'" | null = null;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (q) {
        if (c === q) {
          q = null;
          continue;
        }
        cur += c;
        continue;
      }
      if (c === '"' || c === "'") {
        q = c as any;
        continue;
      }
      if (/\s/.test(c)) {
        if (cur) {
          out.push(cur);
          cur = "";
        }
        continue;
      }
      cur += c;
    }
    if (cur) out.push(cur);
    return out;
  }

  onMount(async () => {
    await initXterm();
    await ensureWorker();
  });

  onDestroy(() => {
    worker?.terminate();
    worker = null;
  });
</script>

<div
  class="w-full border rounded-md overflow-hidden bg-background px-1 pt-1 pb-0.5 box-border"
  style={`height: ${typeof (height ?? 320) === "number" ? (height ?? 320) + "px" : (height ?? 320)}`}
>
  <div bind:this={containerEl} class="w-full h-full"></div>
</div>
