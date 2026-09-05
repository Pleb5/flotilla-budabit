export interface GitNaturalFetchResponse {
  ok?: boolean
  status: number
  statusText?: string
  text?: () => Promise<string>
  arrayBuffer: () => Promise<ArrayBuffer>
}

export type GitNaturalFetch = (
  input: string,
  init?: RequestInit,
) => Promise<GitNaturalFetchResponse>

export interface GitNaturalRequestOptions {
  fetcher: GitNaturalFetch
  signal?: AbortSignal
}

export function assertSuccessfulResponse(response: GitNaturalFetchResponse, operation: string): void {
  const ok =
    typeof response.ok === "boolean"
      ? response.ok
      : Number.isFinite(response.status) && response.status >= 200 && response.status < 300
  if (ok) return

  const statusText = response.statusText ? ` ${response.statusText}` : ""
  throw new Error(`${operation} failed with HTTP ${response.status}${statusText}`)
}
