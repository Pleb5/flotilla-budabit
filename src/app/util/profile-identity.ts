import type {Profile, TrustedEvent} from "@welshman/util"
import {npubEncode} from "nostr-tools/nip19"

export const IDENTITY_KIND = 10011
export type GitHubIdentity = {username: string; proof: string}
export type ProfileValues = {profile: Profile; githubIdentity?: GitHubIdentity}
export type IdentityVerification = {
  status: "valid" | "invalid" | "unavailable"
  message: string
}

export const normalizeWebsite = (value = "") => {
  const trimmed = value.trim()
  if (!trimmed) return ""
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`)
    return ["http:", "https:"].includes(url.protocol) &&
      url.hostname &&
      !url.username &&
      !url.password
      ? url.href
      : ""
  } catch {
    return ""
  }
}

export const parseNip05 = (value: string) => {
  const match = value
    .trim()
    .match(/^(?:([a-z\d_.-]+)@)?((?:[a-z\d](?:[a-z\d-]*[a-z\d])?\.)+[a-z]{2,})$/i)
  return match ? {name: match[1] || "_", domain: match[2].toLowerCase()} : undefined
}

export const verifyNip05 = async (
  value: string,
  pubkey: string,
  signal?: AbortSignal,
): Promise<IdentityVerification> => {
  const address = parseNip05(value)
  if (!address)
    return {status: "invalid", message: "Enter a NIP-05 address such as name@example.com."}
  try {
    const response = await fetch(
      `https://${address.domain}/.well-known/nostr.json?name=${encodeURIComponent(address.name)}`,
      {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
          : AbortSignal.timeout(8000),
        redirect: "error",
      },
    )
    if (response.status === 404)
      return {status: "invalid", message: "No NIP-05 record found at this domain."}
    if (!response.ok) throw new Error("NIP-05 service unavailable")
    const data = await response.json()
    const key = data?.names?.[address.name]
    return typeof key === "string" && key.toLowerCase() === pubkey.toLowerCase()
      ? {status: "valid", message: "NIP-05 address verified for this Nostr public key."}
      : {status: "invalid", message: "This NIP-05 address does not point to this Nostr public key."}
  } catch {
    return {
      status: "unavailable",
      message:
        "Could not check NIP-05. The service may be offline or block browser requests. Try again.",
    }
  }
}

export const normalizeGitHubIdentity = ({username, proof}: GitHubIdentity): GitHubIdentity => {
  username = username.trim().replace(/^@/, "").toLowerCase()
  proof = proof.trim()
  if (/^https:\/\/gist\.github\.com\//i.test(proof)) {
    try {
      const parts = new URL(proof).pathname.split("/").filter(Boolean)
      if (parts.length === 2 && parts[0].toLowerCase() === username) proof = parts[1]
    } catch {
      /* Invalid URLs are rejected below. */
    }
  }
  return {username, proof}
}

export const isGitHubUsername = (username: string) =>
  /^[a-z\d](?:[a-z\d-]{0,37}[a-z\d])?$/i.test(username) && !username.includes("--")

export const isGitHubIdentity = (identity: GitHubIdentity) =>
  isGitHubUsername(identity.username) && /^[a-f\d]+$/i.test(identity.proof)

export const selectIdentityEvent = (events: TrustedEvent[], pubkey: string) =>
  events
    .filter(event => event.kind === IDENTITY_KIND && event.pubkey === pubkey)
    .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))[0]

// A dedicated identity event (including an empty one) supersedes legacy kind-0 tags.
export const readGitHubIdentity = (profile?: Profile | null, identities?: TrustedEvent) => {
  const tags = identities?.tags ?? profile?.event?.tags ?? []
  for (const tag of tags) {
    if (tag[0] !== "i" || !tag[1]?.toLowerCase().startsWith("github:")) continue
    const identity = normalizeGitHubIdentity({username: tag[1].slice(7), proof: tag[2] || ""})
    if (isGitHubUsername(identity.username)) return identity
  }
  return {username: "", proof: ""}
}

export const replaceGitHubTags = (tags: string[][], identity: GitHubIdentity) => {
  const result = tags.filter(
    tag => !(tag[0] === "i" && tag[1]?.toLowerCase().startsWith("github:")),
  )
  const normalized = normalizeGitHubIdentity(identity)
  if (normalized.username || normalized.proof) {
    if (!isGitHubIdentity(normalized))
      throw new Error("Enter a GitHub username and valid Gist ID, or clear both fields.")
    result.push(["i", `github:${normalized.username}`, normalized.proof])
  }
  return result
}

export const buildGitHubIdentityUpdate = (
  profile: Profile,
  identity?: GitHubIdentity,
  current?: TrustedEvent,
) => {
  const profileTags = profile.event?.tags || []
  if (!identity) return {profileTags}
  const normalized = normalizeGitHubIdentity(identity)
  const previous = readGitHubIdentity(profile, current)
  const changed = JSON.stringify(normalized) !== JSON.stringify(previous)
  // Preserve an unchanged malformed legacy claim rather than blocking unrelated edits.
  if (!changed && normalized.username && !isGitHubIdentity(normalized)) return {profileTags}
  return {
    profileTags: replaceGitHubTags(profileTags, normalized),
    identityTags: changed
      ? replaceGitHubTags(current?.tags ?? profileTags.filter(tag => tag[0] === "i"), normalized)
      : undefined,
  }
}

export const githubProofText = (pubkey: string) =>
  `Verifying that I control the following Nostr public key: ${npubEncode(pubkey)}`

type Gist = {
  id?: string
  public?: boolean
  owner?: {login?: string}
  description?: string
  files?: Record<string, {content?: string; truncated?: boolean}>
}

export const verifyGitHubGist = (
  gist: Gist,
  identity: GitHubIdentity,
  pubkey: string,
): IdentityVerification => {
  const files = Object.values(gist.files || {})
  if (
    gist.id !== identity.proof ||
    gist.public !== true ||
    gist.owner?.login?.toLowerCase() !== identity.username.toLowerCase()
  ) {
    return {
      status: "invalid",
      message: "The public Gist must belong to the claimed GitHub account.",
    }
  }
  if (
    files.length !== 1 ||
    files[0].truncated ||
    files[0].content?.trim() !== githubProofText(pubkey)
  ) {
    return {
      status: "invalid",
      message:
        "The Gist must contain one file with the verification text for this Nostr public key.",
    }
  }
  return {status: "valid", message: "GitHub account and Nostr public key verified."}
}

export const verifyGitHubIdentity = async (
  value: GitHubIdentity,
  pubkey: string,
  signal?: AbortSignal,
): Promise<IdentityVerification> => {
  const identity = normalizeGitHubIdentity(value)
  if (!isGitHubIdentity(identity))
    return {
      status: "invalid",
      message: "Enter a GitHub username and a Gist ID or matching Gist URL.",
    }
  try {
    const response = await fetch(`https://api.github.com/gists/${identity.proof}`, {
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
        : AbortSignal.timeout(8000),
      headers: {Accept: "application/vnd.github+json"},
    })
    if (response.status === 404)
      return {status: "invalid", message: "GitHub verification Gist not found."}
    if (!response.ok) throw new Error("GitHub unavailable")
    return verifyGitHubGist(await response.json(), identity, pubkey)
  } catch {
    return {
      status: "unavailable",
      message:
        "Could not check GitHub proof. GitHub may be unavailable or rate-limiting requests. Try again.",
    }
  }
}

// Called only by the explicit auto-verification button. Never send a token to a gist/raw URL.
export const createGitHubAttestation = async (
  token: string,
  pubkey: string,
): Promise<GitHubIdentity> => {
  const request = async (path: string, body?: unknown) => {
    const response = await fetch(`https://api.github.com${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        ...(body ? {"Content-Type": "application/json"} : {}),
      },
      signal: AbortSignal.timeout(15000),
      redirect: "error",
      ...(body ? {body: JSON.stringify(body)} : {}),
    })
    if (!response.ok)
      throw new Error(
        response.status === 401
          ? "GitHub token expired or invalid. Update it in account settings."
          : response.status === 403
            ? "GitHub denied the request. Check the token's Gist write permission and API rate limit."
            : `GitHub request failed (${response.status}). Try again.`,
      )
    return response.json()
  }
  const user = await request("/user")
  const username = String(user.login || "").toLowerCase()
  if (!isGitHubUsername(username))
    throw new Error("GitHub did not return a valid account username.")
  // Reuse a previous verification (e.g. after closing the editor without saving).
  const gists: Gist[] = await request("/gists?per_page=100")
  const candidates = gists
    .filter(
      gist =>
        gist.public &&
        (/nostr/i.test(gist.description || "") ||
          Object.keys(gist.files || {}).some(name => /nostr/i.test(name))),
    )
    .slice(0, 10)
  for (const candidate of candidates) {
    if (!candidate.id || !/^[a-f\d]+$/i.test(candidate.id)) continue
    const identity = {username, proof: candidate.id}
    if (
      verifyGitHubGist(await request(`/gists/${candidate.id}`), identity, pubkey).status === "valid"
    )
      return identity
  }
  const gist = await request("/gists", {
    description: "Nostr Identity Verification (NIP-39)",
    public: true,
    files: {"nostr-verification.txt": {content: githubProofText(pubkey)}},
  })
  const identity = {username, proof: String(gist.id || "")}
  if (verifyGitHubGist(gist, identity, pubkey).status !== "valid")
    throw new Error("GitHub returned an unexpected Gist. Check your Gists before retrying.")
  return identity
}
