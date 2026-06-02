import type {GitProvider} from "./provider.js"

export type PrSourceFetchStrategy = "local" | "tip-oid" | "all-refs"

export async function hasCommitObject(
  git: GitProvider,
  dir: string,
  oid: string,
): Promise<boolean> {
  if (!oid) return false

  try {
    await git.readCommit({dir, oid})
    return true
  } catch {
    return false
  }
}

export async function fetchPrSourceTip(
  git: GitProvider,
  opts: {
    dir: string
    remote: string
    url: string
    tipCommitOid: string
    depth?: number
    corsProxy?: string | null
    onAuth?: any
  },
): Promise<{tipOid: string; strategy: PrSourceFetchStrategy}> {
  const {dir, remote, url, tipCommitOid, depth = 100, corsProxy, onAuth} = opts

  if (await hasCommitObject(git, dir, tipCommitOid)) {
    return {tipOid: tipCommitOid, strategy: "local"}
  }

  const commonFetchOptions = {
    dir,
    remote,
    url,
    depth,
    tags: false,
    ...(corsProxy !== undefined ? {corsProxy} : {}),
    ...(onAuth ? {onAuth} : {}),
  }

  let tipFetchError: unknown

  try {
    await git.fetch({
      ...commonFetchOptions,
      ref: tipCommitOid,
      singleBranch: true,
    })

    if (await hasCommitObject(git, dir, tipCommitOid)) {
      return {tipOid: tipCommitOid, strategy: "tip-oid"}
    }

    tipFetchError = new Error(`Fetched tip ${tipCommitOid} but commit object is still missing`)
  } catch (error) {
    tipFetchError = error
  }

  let allRefsError: unknown

  try {
    try {
      await git.setConfig({
        dir,
        path: `remote.${remote}.fetch`,
        value: `+refs/heads/*:refs/remotes/${remote}/*`,
      })
    } catch {
      // ignore
    }

    await git.fetch({
      ...commonFetchOptions,
      singleBranch: false,
    })

    if (await hasCommitObject(git, dir, tipCommitOid)) {
      return {tipOid: tipCommitOid, strategy: "all-refs"}
    }

    allRefsError = new Error(`Fetched source refs but commit ${tipCommitOid} is still unavailable`)
  } catch (error) {
    allRefsError = error
  }

  const toMessage = (error: unknown) => {
    if (error instanceof Error) return error.message || error.name
    return String(error || "Unknown error")
  }

  const messages = Array.from(
    new Set(
      [
        tipFetchError ? `tip fetch: ${toMessage(tipFetchError)}` : "",
        allRefsError ? `ref fetch: ${toMessage(allRefsError)}` : "",
      ].filter(Boolean),
    ),
  )

  throw new Error(messages.join(" | ") || `Failed to fetch PR tip ${tipCommitOid}`)
}
