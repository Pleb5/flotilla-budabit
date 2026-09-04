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
    requireRemoteEvidence?: boolean
  },
): Promise<{tipOid: string; strategy: PrSourceFetchStrategy}> {
  const {
    dir,
    remote,
    url,
    tipCommitOid,
    depth = 100,
    corsProxy,
    onAuth,
    requireRemoteEvidence = false,
  } = opts

  if (!requireRemoteEvidence && (await hasCommitObject(git, dir, tipCommitOid))) {
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

    const remoteContainsTip = requireRemoteEvidence
      ? await isCommitReachableFromRemote(git, dir, remote, tipCommitOid, depth)
      : await hasCommitObject(git, dir, tipCommitOid)
    if (remoteContainsTip) {
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

async function isCommitReachableFromRemote(
  git: GitProvider,
  dir: string,
  remote: string,
  tipCommitOid: string,
  depth: number,
): Promise<boolean> {
  const branches = await git.listBranches({dir, remote}).catch(() => [])
  for (const branch of branches) {
    try {
      const commits = await (git as any).log({
        dir,
        ref: `refs/remotes/${remote}/${branch.replace(`${remote}/`, "")}`,
        depth,
      })
      if (commits.some((commit: any) => commit?.oid === tipCommitOid)) return true
    } catch {
      // Try the next fetched remote branch.
    }
  }
  return false
}
