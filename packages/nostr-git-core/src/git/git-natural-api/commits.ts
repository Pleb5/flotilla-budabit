export type Commit = {
  hash: string
  tree: string
  parents: string[]
  author: GitIdentity
  committer: GitIdentity
  message: string
}

export type GitIdentity = {
  name: string
  email: string
  timestamp: number
  timezone: string
}

export function parseCommit(data: Uint8Array, hash: string): Commit {
  const content = new TextDecoder("utf-8").decode(data)
  const headerEndIndex = content.indexOf("\n\n")
  if (headerEndIndex === -1) {
    throw new Error(`Invalid commit format for ${hash}: no message separator found`)
  }

  const result: Partial<Commit> = {
    hash,
    parents: [],
    message: content.slice(headerEndIndex + 2),
  }

  for (const line of content.slice(0, headerEndIndex).split("\n")) {
    if (line.startsWith("tree ")) result.tree = line.slice(5)
    else if (line.startsWith("parent ")) result.parents?.push(line.slice(7))
    else if (line.startsWith("author ")) result.author = parseIdentity(line.slice(7))
    else if (line.startsWith("committer ")) result.committer = parseIdentity(line.slice(10))
  }

  if (!result.tree || !result.author || !result.committer) {
    throw new Error(`Invalid commit format for ${hash}: missing required identity or tree`)
  }
  return result as Commit
}

function parseIdentity(value: string): GitIdentity {
  const mailOpen = value.indexOf("<")
  if (mailOpen === -1) {
    return {name: value.trim(), email: "", timestamp: Number.NaN, timezone: ""}
  }

  const mailClose = value.lastIndexOf(">")
  const tail = value.slice(mailClose + 1).trimStart()
  const timestampAndZone = tail.match(/^(\d+)\s+([+-]\d+)$/)
  return {
    name: value.slice(0, mailOpen).trimEnd(),
    email: value.slice(mailOpen + 1, mailClose),
    timestamp: timestampAndZone ? Number.parseInt(timestampAndZone[1], 10) : Number.NaN,
    timezone: timestampAndZone?.[2] || "",
  }
}
