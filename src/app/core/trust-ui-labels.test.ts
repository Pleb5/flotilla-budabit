import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readUiFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

const trustSurfaceFiles = [
  {name: "repo overview", path: "../../routes/git/[id=naddr]/+page.svelte"},
  {name: "PR list", path: "../../routes/git/[id=naddr]/prs/+page.svelte"},
  {name: "PR detail", path: "../components/PRView.svelte"},
  {name: "profile collaboration", path: "../components/ProfileCodeTrustAnalysis.svelte"},
  {name: "profile NIP-85 metrics", path: "../components/ProfileNip85Metrics.svelte"},
  {name: "trust settings", path: "../../routes/settings/trust/+page.svelte"},
  {
    name: "provider recommendations",
    path: "../../routes/settings/trust/ProviderRecommendationRow.svelte",
  },
]

const avoidedLabelPatterns = [
  /\bSocial-known\b/,
  /\bTrust score\b/i,
  /\bGlobally distrusted\b/i,
  /\bTrust Activity\b/,
  /\bTrusted (merged|maintainer|collaborators|author|Assertions)\b/i,
  /\btrusted (author|maintainer|collaborator|providers?|profiles|activity|assertions?)\b/i,
]

describe("trust UI labels", () => {
  it("does not render avoided raw or vague trust labels on trust surfaces", () => {
    for (const file of trustSurfaceFiles) {
      const source = readUiFile(file.path)

      for (const pattern of avoidedLabelPatterns) {
        expect(source, `${file.name} should not match ${pattern}`).not.toMatch(pattern)
      }
    }
  })

  it("keeps semantic evidence labels on the migrated surfaces", () => {
    expect(readUiFile("../../routes/git/[id=naddr]/+page.svelte")).toContain(
      "Community-aligned merged PRs",
    )
    expect(readUiFile("../../routes/git/[id=naddr]/+page.svelte")).toContain("Community Activity")
    expect(readUiFile("../components/ProfileCodeTrustAnalysis.svelte")).toContain(
      "Code collaboration evidence",
    )
    expect(readUiFile("../components/ProfileCodeTrustAnalysis.svelte")).toContain(
      "Direct-follow merged PRs",
    )
    expect(readUiFile("../../routes/settings/trust/+page.svelte")).toContain("Community Trust")
  })
})
