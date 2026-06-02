import { configureWorkerEventIO, getGitWorker } from "../src/worker/index.js";
import type { EventIO } from "../src/types/index.js";

async function main() {
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

  const { api, worker } = getGitWorker((evt) => {
    const payload = (evt as MessageEvent).data ?? evt;
    console.log("[worker-progress]", payload);
  });

  try {
    await configureWorkerEventIO(api, eventIO);

    const remoteUrl = await api.cloneAndFork({
      sourceUrl: "https://github.com/example/repo.git",
      targetHost: "github",
      targetToken: "ghp_xxx",
      targetUsername: "your-username",
      targetRepo: "forked-repo",
      nostrPrivateKey: new Uint8Array([]),
      relays: ["wss://relay.nostr.example"],
    });
    console.log("Forked repo is at:", remoteUrl);

    const files = await api.listRepoFiles({
      host: "github.com",
      owner: "example",
      repo: "repo",
      branch: "main",
      path: "",
    });
    console.log("Repo files:", files);

    const content = await api.fetchPermalink({
      host: "github.com",
      owner: "example",
      repo: "repo",
      branch: "main",
      filePath: "README.md",
      startLine: 0,
      endLine: 10,
    });
    console.log("Permalink content:", content);
  } finally {
    worker.terminate();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
