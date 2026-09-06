import type { NostrEvent } from "@nostr-git/core";
import { createGitCommentEvent, createIssueEvent, createStatusEvent } from "@nostr-git/core/events";

/** Conservative browser lane. These are hard bounds, not progress estimates. */
export const INITIAL_IMPORT_LIMITS = Object.freeze({
  responseBytes: 2 * 1024 * 1024,
  eventBytes: 32 * 1024,
  historyBytes: 8 * 1024 * 1024,
  events: 1000,
  sourceItems: 5000,
  pages: 200,
  perPage: 30,
  refs: 100,
  gitKiB: 50 * 1024,
  requestMs: 30_000,
});

export type ImportEventTemplate = Pick<NostrEvent, "kind" | "created_at" | "content" | "tags">;
export interface InitialImportSource {
  url: string;
  owner: string;
  name: string;
  id: number;
  description: string;
  defaultBranch: string;
  sizeKiB: number;
  openIssues: number;
}
export interface GitHubImportItem {
  id: number;
  number?: number;
  title?: string;
  body?: string | null;
  state?: string;
  pull_request?: unknown;
  created_at: string;
  updated_at: string;
  closed_at?: string | null;
  user: { login: string } | null;
  closed_by?: { login: string } | null;
  labels?: Array<{ name: string } | string>;
}

export function parseInitialImportUrl(
  value: string
): Pick<InitialImportSource, "url" | "owner" | "name"> {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter a public https://github.com/owner/repository URL");
  }
  const parts = url.pathname
    .replace(/\/$/, "")
    .replace(/\.git$/, "")
    .split("/")
    .filter(Boolean);
  if (
    url.protocol !== "https:" ||
    url.host !== "github.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    parts.length !== 2 ||
    parts.some((p) => !/^[\w.-]+$/.test(p))
  ) {
    throw new Error(
      "Initial import supports public GitHub repository URLs only, without credentials or query parameters"
    );
  }
  return { url: `https://github.com/${parts.join("/")}`, owner: parts[0], name: parts[1] };
}

/** Fetch and body consumption share a deadline; never call response.json() before the byte cap. */
export async function readImportJson(
  url: string,
  signal: AbortSignal,
  token = "",
  fetcher: typeof fetch = fetch,
  maxBytes = INITIAL_IMPORT_LIMITS.responseBytes
): Promise<unknown> {
  signal.throwIfAborted();
  const controller = new AbortController();
  const stop = () => controller.abort();
  signal.addEventListener("abort", stop, { once: true });
  const timer = setTimeout(stop, INITIAL_IMPORT_LIMITS.requestMs);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let response: Response | undefined;
  try {
    const target = new URL(url);
    if (target.origin !== "https://api.github.com" || target.username || target.password)
      throw new Error("Unsupported source API origin");
    response = await fetcher(url, {
      signal: controller.signal,
      redirect: "error",
      credentials: "omit",
      headers: {
        Accept: "application/vnd.github+json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(
        response.status === 403 || response.status === 429
          ? "GitHub access/rate limit reached. Stop and resume later, or supply a read-only GitHub token."
          : `GitHub source request failed (HTTP ${response.status}). Check the public repository URL.`
      );
    }
    if (Number(response.headers.get("content-length")) > maxBytes || !response.body)
      throw new Error("GitHub response exceeds the browser import limit");
    reader = response.body.getReader();
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    while (true) {
      controller.signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) throw new Error("GitHub response exceeds the browser import limit");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } catch (error) {
    signal.throwIfAborted();
    if (controller.signal.aborted) throw new Error("GitHub request timed out; resume later");
    if (error instanceof Error && /^(GitHub |Unsupported source API)/.test(error.message))
      throw error;
    // Never echo fetch/provider exception messages: they can contain credentials.
    throw new Error("Could not read the public GitHub source. Check access and try again.");
  } finally {
    if (reader) {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    } else await response?.body?.cancel().catch(() => {});
    clearTimeout(timer);
    signal.removeEventListener("abort", stop);
  }
}

export async function inspectInitialImportSource(
  value: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch
): Promise<InitialImportSource> {
  const parsed = parseInitialImportUrl(value);
  // Always inspect anonymously. A token must never turn a private repository into a public import.
  const repo = (await readImportJson(
    `https://api.github.com/repos/${parsed.owner}/${parsed.name}`,
    signal,
    "",
    fetcher
  )) as Record<string, unknown>;
  if (!repo || repo.private !== false || (repo.visibility && repo.visibility !== "public"))
    throw new Error("Only public repositories can be imported");
  if (
    !Number.isSafeInteger(repo.id) ||
    Number(repo.id) <= 0 ||
    typeof repo.default_branch !== "string" ||
    !Number.isFinite(repo.size) ||
    Number(repo.size) <= 0
  )
    throw new Error("Source must be a nonempty public Git repository");
  if (Number(repo.size) > INITIAL_IMPORT_LIMITS.gitKiB)
    throw new Error(
      "Source exceeds the 50 MiB browser Git import limit; use a native Git migration"
    );
  if (String(repo.full_name).toLowerCase() !== `${parsed.owner}/${parsed.name}`.toLowerCase())
    throw new Error("Source repository moved; use its current GitHub URL");
  return {
    ...parsed,
    id: Number(repo.id),
    description: String(repo.description || "").slice(0, 2000),
    defaultBranch: repo.default_branch,
    sizeKiB: Number(repo.size),
    openIssues: Number(repo.open_issues_count) || 0,
  };
}

/** One page at a time. Callers await delivery before requesting another page. */
export async function* initialImportPages(
  source: InitialImportSource,
  kind: "issues" | "comments",
  signal: AbortSignal,
  options: { issueNumber?: number; token?: string; fetcher?: typeof fetch; maxPages?: number } = {}
): AsyncGenerator<GitHubImportItem[]> {
  const path = kind === "issues" ? "issues" : `issues/${options.issueNumber}/comments`;
  if (kind === "comments" && !Number.isSafeInteger(options.issueNumber))
    throw new Error("Invalid issue number");
  let previousLastId = 0;
  for (let page = 1; page <= (options.maxPages ?? INITIAL_IMPORT_LIMITS.pages); page++) {
    signal.throwIfAborted();
    const query = `per_page=${INITIAL_IMPORT_LIMITS.perPage}&page=${page}&state=all&sort=created&direction=asc`;
    const items = (await readImportJson(
      `https://api.github.com/repos/${source.owner}/${source.name}/${path}?${query}`,
      signal,
      options.token,
      options.fetcher
    )) as GitHubImportItem[];
    if (!Array.isArray(items) || items.length > INITIAL_IMPORT_LIMITS.perPage)
      throw new Error("GitHub returned an invalid import page");
    if (!items.length) return;
    for (const item of items) {
      if (
        !Number.isSafeInteger(item.id) ||
        item.id <= 0 ||
        !Number.isFinite(Date.parse(item.created_at)) ||
        !Number.isFinite(Date.parse(item.updated_at))
      )
        throw new Error("GitHub returned invalid source identity or dates");
    }
    const lastId = items[items.length - 1].id;
    if (lastId === previousLastId)
      throw new Error("GitHub repeated an import page; stopped before accumulating data");
    previousLastId = lastId;
    yield items;
    if (items.length < INITIAL_IMPORT_LIMITS.perPage) return;
  }
  throw new Error("Source exceeds the browser import page limit");
}

export function initialImportSourceKey(
  source: InitialImportSource,
  type: "issue" | "status" | "comment",
  id: number
): string {
  return `github:github.com:${source.id}:${type}:${id}`;
}

export function initialImportTemplate(params: {
  source: InitialImportSource;
  item: GitHubImportItem;
  type: "issue" | "status" | "comment";
  repoAddress: string;
  ownerPubkey: string;
  createdAt: number;
  rootId?: string;
  issueNumber?: number;
}): ImportEventTemplate {
  const { source, item, type, repoAddress, ownerPubkey, createdAt, rootId } = params;
  const number = type === "comment" ? params.issueNumber : item.number;
  if (!Number.isSafeInteger(number) || Number(number) <= 0)
    throw new Error("Invalid source issue number");
  const sourceUrl = `${source.url}/issues/${number}${type === "comment" ? `#issuecomment-${item.id}` : ""}`;
  const login =
    (type === "status" && item.state === "closed" ? item.closed_by?.login : item.user?.login) ||
    "unknown";
  const originalDate = type === "status" ? item.closed_at || item.created_at : item.created_at;
  const tags: string[][] = [
    ["imported", ""],
    ["proxy", sourceUrl, "github"],
    ["source-key", initialImportSourceKey(source, type, item.id)],
    [
      "source-author",
      login,
      login === "unknown" ? "" : `https://github.com/${encodeURIComponent(login)}`,
    ],
    ["original_date", String(Math.floor(Date.parse(originalDate) / 1000))],
    ["original_updated_at", String(Math.floor(Date.parse(item.updated_at) / 1000))],
  ];
  let base: ImportEventTemplate;
  if (type === "issue") {
    base = createIssueEvent({
      content: item.body || "",
      repoAddr: repoAddress,
      subject: item.title || "Untitled issue",
      labels: (item.labels || []).map((l) => (typeof l === "string" ? l : l.name)),
      created_at: createdAt,
    });
  } else if (type === "status") {
    if (!rootId || !["open", "closed"].includes(item.state || ""))
      throw new Error("Invalid imported issue status");
    base = createStatusEvent({
      kind: item.state === "closed" ? 1632 : 1630,
      content: "",
      recipients: [ownerPubkey],
      rootId,
      repoAddr: repoAddress,
      created_at: createdAt,
    });
  } else {
    if (!rootId) throw new Error("Imported comment requires its delivered root");
    base = createGitCommentEvent({
      content: item.body || "",
      root: { id: rootId, kind: 1621, pubkey: ownerPubkey },
      repoRefs: [repoAddress],
      authorPubkey: ownerPubkey,
      created_at: createdAt,
    });
  }
  const template = {
    kind: base.kind,
    content: base.content,
    created_at: createdAt,
    tags: [...base.tags, ...tags],
  };
  if (
    new TextEncoder().encode(JSON.stringify(template)).byteLength >
    INITIAL_IMPORT_LIMITS.eventBytes - 512
  ) {
    throw new Error(
      "An imported event exceeds the 32 KiB limit; history was stopped, not truncated"
    );
  }
  return template;
}
