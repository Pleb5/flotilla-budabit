/** Open the real fork modal with local data only; never fork or publish anything. */
import {ForkRepoDialog, type Repo} from "@nostr-git/ui"
import {pushModal} from "../../../src/app/util/modal"

export function openForkDialogFixture(sameCoordinate = false) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")

  const commits = [
    {
      oid: "a".repeat(40),
      message: "Fixture commit",
      author: "Fixture",
      timestamp: 1700000000,
    },
  ]
  const repo = {
    name: "scroll-regression",
    description: "Repository used to check fork dialog scrolling.",
    clone: ["https://github.com/fixture/scroll-regression.git"],
    web: [],
    mainBranch: "main",
    selectedBranch: "main",
    branches: [{name: "main"}],
    commits,
    earliestUniqueCommit: commits[0].oid,
    hashtags: ["test"],
    repoEvent: {
      kind: 30617,
      pubkey: "1".repeat(64),
      tags: [["d", "scroll-regression"]],
    },
    getCommitHistory: async () => commits,
  } as unknown as Repo

  return pushModal(
    ForkRepoDialog,
    {
      repo,
      pubkey: (sameCoordinate ? "1" : "2").repeat(64),
      onPublishEvent: async () => {
        throw new Error("Publishing disabled for scroll fixture")
      },
      getProfile: async () => null,
      searchProfiles: async () => [],
      searchRelays: async () => [],
    },
    {fullscreen: true, noEscape: true},
  )
}
