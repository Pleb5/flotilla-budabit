import { NostrGitProvider } from "../src/api/providers/nostr-git-provider.js";
import type { EventIO } from "../src/types/index.js";
import { makeRepoAddr } from "../src/utils/repo-addr.js";
import * as path from "node:path"
import * as fs from "node:fs"

const demoOwner = "f".repeat(64)

const eventIO: EventIO = {
  fetchEvents: async () => {
    console.log("[eventIO.fetchEvents] returning no events for demo")
    return []
  },
  publishEvent: async (event) => {
    console.log("[eventIO.publishEvent] kind=", event.kind ?? "unknown")
    return {ok: true, relays: []}
  },
  publishEvents: async (events) => Promise.all(events.map(evt => eventIO.publishEvent(evt))),
  getCurrentPubkey: () => demoOwner,
}

// Minimal Git provider; only push is used for normal refs in this example
class DemoGit {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async push(_opts: any): Promise<any> {
    return {ok: true}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async merge(_opts: any): Promise<any> {
    return {oid: "deadbeef", clean: true}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async clone(_opts: any): Promise<any> {
    return {}
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async fetch(_opts: any): Promise<any> {
    return {}
  }
}

async function main() {
  const git = new DemoGit()
  const provider = new NostrGitProvider({
    eventIO,
    gitProvider: git as any,
    publishRepoState: false,
    publishRepoAnnouncements: false,
  })

  const workDir = path.join(process.cwd(), "tmp-demo")
  fs.mkdirSync(workDir, {recursive: true})
  // Create a couple of files to simulate a diff; this example doesn't truly commit,
  // but demonstrates providing fs/dir to enable unified diff generation when refs exist.
  fs.writeFileSync(path.join(workDir, "README.md"), "# Demo\n")

  const repoId = "demo-repo"
  const repoAddr = makeRepoAddr(demoOwner, repoId)

  // PR ref triggers NIP-34 pull request publication with enriched metadata and content
  const result = await provider.push({
    dir: workDir,
    fs: fs as unknown as any,
    refspecs: ["refs/heads/pr/feature-x"],
    repoId,
    repoAddr,
    baseBranch: "refs/heads/main",
    patchContent: undefined, // allow default generator (cover letter + unified diff if resolvable)
    timeoutMs: 1000,
  })

  if (result.blossomSummary) {
    console.log("Blossom summary:", result.blossomSummary)
  }
  console.log("PR push example finished")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
