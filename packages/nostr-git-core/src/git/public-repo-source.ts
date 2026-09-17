import {detectVendorFromUrl, gitUrlToHttp, registerGitHost} from "./vendor-providers.js"
import {getGitApiBaseUrl} from "./provider-factory.js"

export type PublicRepoProvider = "github" | "gitlab" | "gitea" | "forgejo"
export const PUBLIC_REPO_PROVIDERS = "GitHub, GitLab, Gitea, and Codeberg / Forgejo"
export const PUBLIC_SOURCE_LIMITS = {responseBytes: 2 * 1024 * 1024, requestMs: 15_000} as const

export interface PublicRepoSource {
  provider: PublicRepoProvider
  host: string
  owner: string
  name: string
  id: string
  url: string
  cloneUrl: string
  displayName: string
  description: string
  defaultBranch: string
  topics: string[]
  empty: boolean
  /** Admission estimate only; actual Git transfer still needs transport limits. */
  sizeKiB?: number
}

export class PublicRepoSourceError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = "PublicRepoSourceError"
  }
}

export function parsePublicRepoUrl(value: string, providerHint?: PublicRepoProvider) {
  const url = gitUrlToHttp(value)
  if (!url || url.protocol !== "https:" || !url.hostname.includes("."))
    throw new PublicRepoSourceError("Enter a public HTTPS repository URL, for example https://github.com/owner/repository")
  if (url.username || url.password || url.search || url.hash)
    throw new PublicRepoSourceError("Use a repository URL without credentials, query parameters or fragments")
  const detected = detectVendorFromUrl(url.href)
  if (detected === "bitbucket")
    throw new PublicRepoSourceError(`Bitbucket imports are not supported. Supported providers: ${PUBLIC_REPO_PROVIDERS}`)
  if (detected === "grasp" || detected === "grasp-rest")
    throw new PublicRepoSourceError("This is a Nostr/GRASP repository. Open it in Budabit and use the repository fork workflow instead")
  const provider = detected === "generic" ? providerHint : detected as PublicRepoProvider
  let parts: string[]
  try {
    parts = url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "").slice(1).split("/").map(decodeURIComponent)
  } catch {
    throw new PublicRepoSourceError("The repository URL contains invalid escaping")
  }
  if (parts.length < 2 || (provider && provider !== "gitlab" && parts.length !== 2) ||
      parts.some(part => !/^[\p{L}\p{N}_.-]+$/u.test(part) || [".", "..", "-"].includes(part)))
    throw new PublicRepoSourceError("Enter the repository root URL, not a file, issue or pull request page (https://host/owner/repository)")
  const name = parts[parts.length - 1]
  const owner = parts.slice(0, -1).join("/")
  const path = parts.map(encodeURIComponent).join("/")
  return {provider, host: url.host, origin: url.origin, owner, name, url: `${url.origin}/${path}`}
}

/** No token parameter by design. The entire response, including body reads, shares a deadline. */
async function readPublicJson(url: string, signal: AbortSignal, fetcher: typeof fetch): Promise<any> {
  signal.throwIfAborted()
  const controller = new AbortController()
  const stop = () => controller.abort()
  signal.addEventListener("abort", stop, {once: true})
  const timer = setTimeout(stop, PUBLIC_SOURCE_LIMITS.requestMs)
  let response: Response | undefined
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    response = await fetcher(url, {
      signal: controller.signal,
      credentials: "omit",
      redirect: "error",
      headers: {Accept: "application/json"},
    })
    if (!response.ok) {
      const status = response.status
      throw new PublicRepoSourceError(
        status === 404 || status === 401 ? "Repository not found or not publicly accessible" :
        status === 429 || status === 403 ? "Public access is restricted or rate-limited. Try again later; no source token is required" :
        `The source server could not complete the request (HTTP ${status}). Try again later`, status)
    }
    if (!response.body || Number(response.headers.get("content-length")) > PUBLIC_SOURCE_LIMITS.responseBytes)
      throw new PublicRepoSourceError("Source metadata exceeds the browser response limit")
    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let bytes = 0
    let body = ""
    while (true) {
      controller.signal.throwIfAborted()
      const {done, value} = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > PUBLIC_SOURCE_LIMITS.responseBytes)
        throw new PublicRepoSourceError("Source metadata exceeds the browser response limit")
      body += decoder.decode(value, {stream: true})
    }
    controller.signal.throwIfAborted()
    return JSON.parse(body + decoder.decode())
  } catch (error) {
    signal.throwIfAborted()
    if (controller.signal.aborted) throw new PublicRepoSourceError("The public source request timed out. Try again")
    if (error instanceof PublicRepoSourceError) throw error
    // Do not expose fetch/provider errors, which may contain sensitive URL data.
    throw new PublicRepoSourceError("Could not read public repository metadata. Check the URL, connection and this server's browser/API access")
  } finally {
    clearTimeout(timer)
    signal.removeEventListener("abort", stop)
    if (reader) {
      await reader.cancel().catch(() => {})
      reader.releaseLock()
    } else await response?.body?.cancel().catch(() => {})
  }
}

/** Anonymous, bounded discovery on this origin only; useful for custom forge hostnames. */
export async function discoverPublicGitProvider(
  origin: string, signal: AbortSignal, fetcher: typeof fetch = fetch,
): Promise<PublicRepoProvider> {
  const url = new URL(origin)
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new PublicRepoSourceError("Use an HTTPS forge origin without credentials")
  const known = detectVendorFromUrl(url.origin)
  if (["github", "gitlab", "gitea", "forgejo"].includes(known)) return known as PublicRepoProvider
  if (known !== "generic") throw new PublicRepoSourceError(`Unsupported source. Supported providers: ${PUBLIC_REPO_PROVIDERS}`)
  for (const path of ["/api/forgejo/v1/version", "/api/v1/version"]) {
    try {
      const version = await readPublicJson(`${url.origin}${path}`, signal, fetcher)
      if (typeof version?.version !== "string" || !/^\d+\./.test(version.version)) continue
      const provider = path.includes("forgejo") || version.version.includes("+gitea-") ? "forgejo" : "gitea"
      registerGitHost(url.host, provider)
      return provider
    } catch (error) {
      signal.throwIfAborted()
      if (!(error instanceof PublicRepoSourceError) || error.status !== 404) throw error
    }
  }
  throw new PublicRepoSourceError(`This forge could not be identified. Supported providers: ${PUBLIC_REPO_PROVIDERS}. For a self-hosted server, select its provider explicitly`)
}

export async function inspectPublicRepoSource(
  value: string,
  signal: AbortSignal,
  options: {fetcher?: typeof fetch; provider?: PublicRepoProvider} = {},
): Promise<PublicRepoSource> {
  const fetcher = options.fetcher || fetch
  let parsed = parsePublicRepoUrl(value, options.provider)
  const provider = parsed.provider || await discoverPublicGitProvider(parsed.origin, signal, fetcher)
  parsed = parsePublicRepoUrl(value, provider)
  const base = getGitApiBaseUrl(provider, parsed.origin)
  const endpoint = provider === "gitlab"
    ? `${base}/projects/${encodeURIComponent(`${parsed.owner}/${parsed.name}`)}`
    : `${base}/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.name)}`
  const data = await readPublicJson(endpoint, signal, fetcher)
  const isPublic = provider === "gitlab" ? data?.visibility === "public" : data?.private === false
  if (!isPublic) throw new PublicRepoSourceError("Only publicly accessible repositories can be imported")
  const fullName = provider === "gitlab" ? data.path_with_namespace : data.full_name
  if (typeof fullName !== "string" || fullName.toLowerCase() !== `${parsed.owner}/${parsed.name}`.toLowerCase())
    throw new PublicRepoSourceError("The repository moved or the URL does not identify its root. Use its current repository URL")
  if ((typeof data.id !== "number" && typeof data.id !== "string") || !String(data.id))
    throw new PublicRepoSourceError("The source returned invalid repository identity")
  const clone = provider === "gitlab" ? data.http_url_to_repo : data.clone_url
  const web = provider === "gitlab" ? data.web_url : data.html_url
  for (const remote of [clone, web]) {
    if (typeof remote !== "string") throw new PublicRepoSourceError("The source returned invalid repository URLs")
    const resolved = parsePublicRepoUrl(remote, provider)
    if (resolved.url.toLowerCase() !== parsed.url.toLowerCase())
      throw new PublicRepoSourceError("The source returned a different repository URL. Use its canonical public URL")
  }
  signal.throwIfAborted()
  registerGitHost(parsed.host, provider)
  return {
    provider, host: parsed.host, owner: parsed.owner, name: parsed.name, id: String(data.id),
    url: web, cloneUrl: clone,
    displayName: String(data.name || parsed.name), description: String(data.description || ""),
    defaultBranch: typeof data.default_branch === "string" ? data.default_branch : "",
    topics: Array.isArray(data.topics) ? data.topics.filter((t: unknown) => typeof t === "string") : [],
    empty: data.empty === true || data.empty_repo === true || !data.default_branch,
    ...(provider === "github" && Number.isFinite(data.size) ? {sizeKiB: data.size} : {}),
  }
}
