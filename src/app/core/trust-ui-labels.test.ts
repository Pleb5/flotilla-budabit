import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readUiFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

const trustSurfaceFiles = [
  {name: "repo overview", path: "../../routes/git/[id=naddr]/+page.svelte"},
  {name: "PR list", path: "../../routes/git/[id=naddr]/prs/+page.svelte"},
  {name: "PR detail", path: "../components/PRView.svelte"},
  {name: "profile collaboration", path: "../components/ProfileCodeTrustAnalysis.svelte"},
  {name: "profile NIP-85 metrics", path: "../components/ProfileNip85Metrics.svelte"},
  {name: "trust model", path: "../../routes/trust-model/+page.svelte"},
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

const trustModelDocHref =
  "/git/naddr1qvzqqqrhnypzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqqgxvmr0w35kcmrp94382erpvf5hgqtk2vr/code?path=docs%2Farchitecture%2FWeb-of-Trust-in-BudaBit-Communities.md"
const trustModelEventHref =
  "/nevent1qvzqqqqx2upzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqqstd2x5chl93t2zhqjtxflehjlek55dl7678wswnz6mc9xjgkusn6c0hjwhy"

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
    expect(readUiFile("../components/ProfileCodeTrustAnalysis.svelte")).toContain(
      "More about trust in BudaBit",
    )
    expect(readUiFile("../../routes/trust-model/+page.svelte")).toContain("Trust in BudaBit")
    expect(readUiFile("../../routes/trust-model/+page.svelte")).toContain("Community-first")
  })

  it("moves trust explanation out of settings", () => {
    const trustModel = readUiFile("../../routes/trust-model/+page.svelte")

    expect(trustModel).not.toContain("NIP-85")
    expect(trustModel).toContain(trustModelDocHref)
    expect(trustModel).toContain(trustModelEventHref)
    expect(readUiFile("../../routes/settings/trust/+page.ts")).toContain(
      'throw redirect(307, "/trust-model")',
    )
    expect(readUiFile("../components/MenuSettings.svelte")).not.toContain("/settings/trust")
    expect(readUiFile("../../routes/settings/+layout.svelte")).not.toContain("/settings/trust")
  })

  it("keeps deeper profile trust analysis behind explicit actions", () => {
    const profilePage = readUiFile("../../routes/people/[profile]/+page.svelte")
    const profileCollaboration = readUiFile("../components/ProfileCodeTrustAnalysis.svelte")

    expect(profilePage).not.toContain("loadRepoAnnouncements(")
    expect(profilePage).toContain("Load recent git activity")
    expect(profilePage).toContain("Load repository relationships")
    expect(profilePage).not.toContain("Basic stats render first")
    expect(profilePage).not.toContain("Not loaded")
    expect(profilePage).not.toContain("Press Load")
    expect(profileCollaboration).toContain("Analyze code collaboration")
    expect(profileCollaboration).toContain("requestId")
    expect(profileCollaboration).not.toContain("Automatically checks")
  })
})
