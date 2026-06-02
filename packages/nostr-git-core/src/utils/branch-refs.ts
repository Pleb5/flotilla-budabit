const stripSymbolicPrefix = (value: string): string => value.replace(/^ref:\s*/i, "")

export const normalizeBranchName = (value?: string | null): string => {
  const raw = stripSymbolicPrefix(String(value || "").trim())
  if (!raw || raw === "HEAD") return raw

  return raw
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/remotes\/origin\//, "")
    .replace(/^origin\//, "")
}

export const buildBranchRefCandidates = (value?: string | null): string[] => {
  const raw = stripSymbolicPrefix(String(value || "").trim())
  if (!raw) return []
  if (raw === "HEAD") return ["HEAD"]

  const shortName = normalizeBranchName(raw)

  return Array.from(
    new Set([
      raw,
      shortName,
      `refs/heads/${shortName}`,
      `origin/${shortName}`,
      `refs/remotes/origin/${shortName}`,
    ]),
  )
}
