import { NostrGitProvider } from "../src/api/providers/nostr-git-provider.js";
import type { EventIO } from "../src/types/index.js";
import { makeRepoAddr } from "../src/utils/repo-addr.js";

const demoOwner = "f".repeat(64);

// Minimal EventIO implementation for demos
const eventIO: EventIO = {
  fetchEvents: async () => {
    console.log("[eventIO.fetchEvents]", "returning no events for demo");
    return [];
  },
  publishEvent: async (event) => {
    console.log("[eventIO.publishEvent] kind=", event.kind ?? "unknown");
    return { ok: true, relays: [] };
  },
  publishEvents: async (events) => Promise.all(events.map((evt) => eventIO.publishEvent(evt))),
  getCurrentPubkey: () => demoOwner,
};

// Fake Git provider that fails first push (ssh) and succeeds second (https)
class DemoGit {
  private pushed = false
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async push(options: any): Promise<any> {
    if (!this.pushed && options.url?.startsWith("ssh://")) {
      this.pushed = true
      throw new Error("ssh failed")
    }
    console.log("[git.push] to", options.url ?? "(no-url)")
    return {ok: true}
  }
  // The rest of interface methods are unused in this example
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

  const repoId = "demo-repo"
  const repoAddr = makeRepoAddr(demoOwner, repoId)

  // Stub discovery to provide two URLs so push can fallback
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(provider as any).discoverRepo = async () => ({
    urls: ["ssh://git@host/demo-repo", "https://host/demo-repo"],
  })

  const result = await provider.push({
    refspecs: ["refs/heads/main"],
    repoId,
    url: "ssh://git@host/demo-repo",
    nostrStatus: {repoAddr, rootId: "root-evt", content: "Push applied to main", close: true},
    timeoutMs: 1000,
  })

  console.log("Push result (server):", result.server)
  if (result.blossomSummary) {
    console.log("Blossom summary:", result.blossomSummary)
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
