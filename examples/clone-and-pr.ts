import { NostrGitProvider } from "../src/api/providers/nostr-git-provider.js";
import type { EventIO } from "../src/types/index.js";
import { makeRepoAddr } from "../src/utils/repo-addr.js";
import * as path from "node:path"
import * as fs from "node:fs"
import * as os from "node:os"
import * as git from "isomorphic-git"

const demoOwner = "f".repeat(64);

const eventIO: EventIO = {
  fetchEvents: async () => {
    console.log("[eventIO.fetchEvents] returning no events for demo");
    return [];
  },
  publishEvent: async (event) => {
    console.log("[eventIO.publishEvent] kind=", event.kind ?? "unknown");
    return { ok: true, relays: [] };
  },
  publishEvents: async (events) => Promise.all(events.map((evt) => eventIO.publishEvent(evt))),
  getCurrentPubkey: () => demoOwner,
};

// Minimal Git provider; we don't need server push for PR path
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

async function setupRepo(dir: string) {
  // Initialize a real git repo with isomorphic-git
  await git.init({fs, dir, defaultBranch: "main"})
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo Repo\n")
  await git.add({fs, dir, filepath: "README.md"})
  await git.commit({
    fs,
    dir,
    message: "chore: init",
    author: {name: "Demo", email: "demo@example.com"},
  })

  // Create a feature branch and change a file
  await git.branch({fs, dir, ref: "feature-x"})
  await git.checkout({fs, dir, ref: "feature-x"})
  fs.writeFileSync(path.join(dir, "README.md"), "# Demo Repo\n\nAdded feature X\n")
  await git.add({fs, dir, filepath: "README.md"})
  await git.commit({
    fs,
    dir,
    message: "feat: feature x",
    author: {name: "Demo", email: "demo@example.com"},
  })
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ngit-demo-"))
  console.log("Working dir:", tmp)
  await setupRepo(tmp)

  const gitProvider = new DemoGit()
  const provider = new NostrGitProvider({
    eventIO,
    gitProvider: gitProvider as any,
    publishRepoState: false,
    publishRepoAnnouncements: false,
  })

  const repoId = "demo-repo"
  const repoAddr = makeRepoAddr(demoOwner, repoId)

  // For demonstration, discovery is not required for PR publication
  // Provide fs/dir + baseBranch so default PR content includes a unified diff
  const result = await provider.push({
    dir: tmp,
    fs: fs as unknown as any,
    refspecs: ["refs/heads/pr/feature-x"],
    repoId,
    repoAddr,
    baseBranch: "refs/heads/main",
    timeoutMs: 1000,
  })

  if (result.blossomSummary) {
    console.log("Blossom summary:", result.blossomSummary)
  }
  console.log("Clone-and-PR example finished")
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
