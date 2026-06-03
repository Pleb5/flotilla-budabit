import { nip19 } from "nostr-tools";

export interface GraspRepoExistsResult {
  exists: boolean;
  htmlUrl?: string;
}

interface CheckGraspRepoExistsParams {
  relayUrl: string;
  userPubkey: string;
  owner: string;
  repoName: string;
}

function toNpub(pubkeyOrNpub: string): string {
  if (pubkeyOrNpub.startsWith("npub1")) return pubkeyOrNpub;
  return nip19.npubEncode(pubkeyOrNpub.toLowerCase());
}

function toHttpBase(relayUrl: string): string {
  const normalized = relayUrl.trim();
  if (normalized.startsWith("wss://")) return `https://${normalized.slice(6)}`;
  if (normalized.startsWith("ws://")) return `http://${normalized.slice(5)}`;
  return normalized;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

const FALLBACK_GIT_CORS_PROXY = "https://corsproxy.budabit.club";
const GIT_CORS_PROXY_STORAGE_KEY = "budabit/git/corsProxy";

function normalizeCorsProxy(value: string): string {
  const trimmed = (value || "").trim();
  if (!trimmed) return "";
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  return withScheme.replace(/\/+$/, "");
}

function resolveCorsProxyUrl(): string {
  const envDefault = normalizeCorsProxy(
    (import.meta as any)?.env?.VITE_GIT_DEFAULT_CORS_PROXY || ""
  );
  if (typeof window === "undefined" || !window.localStorage) {
    return envDefault || FALLBACK_GIT_CORS_PROXY;
  }

  const fromStorage = normalizeCorsProxy(
    window.localStorage.getItem(GIT_CORS_PROXY_STORAGE_KEY) || ""
  );
  return fromStorage || envDefault || FALLBACK_GIT_CORS_PROXY;
}

function toCorsProxyRequestUrl(url: string, corsProxy: string): string {
  return `${corsProxy}/${url.replace(/^https?:\/\//i, "")}`;
}

function isLikelyCorsOrNetworkFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /failed to fetch|network|cors|access-control|cross-origin|abort|timed?\s*out|timeout/i.test(
    message
  );
}

const SMART_HTTP_PROBE_TIMEOUT_MS = 3500;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SMART_HTTP_PROBE_TIMEOUT_MS);
  try {
    return await fetch(url, { method: "GET", signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function probeSmartHttp(url: string): Promise<Response | null> {
  try {
    return await fetchWithTimeout(url);
  } catch (error) {
    if (!isLikelyCorsOrNetworkFailure(error)) throw error;
  }

  const corsProxy = resolveCorsProxyUrl();
  const proxiedUrl = toCorsProxyRequestUrl(url, corsProxy);
  return fetchWithTimeout(proxiedUrl);
}

export function isNotFoundError(error: unknown): boolean {
  const anyError = error as any;
  const message = error instanceof Error ? error.message : String(error || "");
  const normalizedMessage = message.toLowerCase();
  const code = String(anyError?.code || "");
  const statusCode = anyError?.statusCode ?? anyError?.status ?? anyError?.context?.statusCode;

  return (
    statusCode === 404 ||
    code === "REPO_NOT_FOUND" ||
    normalizedMessage.includes("404") ||
    normalizedMessage.includes("not found") ||
    normalizedMessage.includes("repository not found")
  );
}

export async function checkGraspRepoExists({
  relayUrl,
  userPubkey: _userPubkey,
  owner,
  repoName,
}: CheckGraspRepoExistsParams): Promise<GraspRepoExistsResult> {
  const ownerNpub = toNpub(owner);
  const httpBase = trimTrailingSlash(toHttpBase(relayUrl));
  const url = `${httpBase}/${ownerNpub}/${repoName}.git/info/refs?service=git-upload-pack`;

  try {
    const response = await probeSmartHttp(url);
    if (!response) return { exists: false };
    if (response.ok) return { exists: true, htmlUrl: `${httpBase}/${ownerNpub}/${repoName}` };
    if (response.status === 404) return { exists: false };

    throw new Error(`Smart HTTP probe failed with status ${response.status}`);
  } catch (error) {
    if (isNotFoundError(error)) return { exists: false };
    throw new Error(
      `Failed to verify GRASP repository availability via Smart HTTP: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

export async function checkGraspReceivePackReady({
  relayUrl,
  owner,
  repoName,
}: Omit<CheckGraspRepoExistsParams, "userPubkey">): Promise<boolean> {
  const ownerNpub = toNpub(owner);
  const httpBase = trimTrailingSlash(toHttpBase(relayUrl));
  const cacheBust = Date.now();
  const url = `${httpBase}/${ownerNpub}/${repoName}.git/info/refs?service=git-receive-pack&_ts=${cacheBust}`;

  try {
    const response = await probeSmartHttp(url);
    if (!response) return false;

    return response.ok;
  } catch {
    return false;
  }
}
