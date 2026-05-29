import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

const compact = (source: string) => source.replace(/\s+/g, " ")
const dense = (source: string) => source.replace(/\s+/g, "")

describe("personal user-data relay policy wiring", () => {
  it("adds active community relays to explicit personal command updates", () => {
    const commands = readProjectFile("./commands.ts")

    const source = compact(commands)
    const denseSource = dense(commands)

    expect(source).toContain("import {getUserDataPublishRelays}")
    expect(denseSource).toContain(
      "relays:getUserDataPublishRelays([url,...INDEXER_RELAYS,...Router.get().FromUser().getUrls(),])",
    )
    expect(denseSource).toContain(
      "relays:getUserDataPublishRelays([...INDEXER_RELAYS,...Router.get().FromUser().getUrls()])",
    )
    expect(denseSource).toContain(
      "relays:getUserDataPublishRelays(Router.get().FromUser().getUrls())",
    )
    expect(denseSource).toContain(
      "constrelays=getUserDataPublishRelays(router.merge(scenarios).getUrls())",
    )
  })

  it("adds active community relays to personal git app-data updates", () => {
    expect(compact(readProjectFile("./git-commands.ts"))).toContain("getUserDataPublishRelays")
    expect(compact(readProjectFile("./git-requests.ts"))).toContain(
      "return getUserDataPublishRelays(out)",
    )
    expect(dense(readProjectFile("./repo-watch.ts"))).toContain(
      "relays:getUserDataPublishRelays(Router.get().FromUser().getUrls())",
    )
  })

  it("adds active community relays to settings list saves", () => {
    expect(dense(readProjectFile("../../routes/settings/blossom/+page.svelte"))).toContain(
      "relays:getUserDataPublishRelays(Router.get().FromUser().getUrls())",
    )
    expect(dense(readProjectFile("../../routes/settings/content/+page.svelte"))).toContain(
      "relays:getUserDataPublishRelays(Router.get().FromUser().getUrls())",
    )
  })
})
