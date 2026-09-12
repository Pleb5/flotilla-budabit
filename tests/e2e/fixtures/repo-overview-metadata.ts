import {withRepoCommunityBinding, type RepoCommunityBinding} from "@nostr-git/core/events"
import {
  createRepoAnnouncement,
  encodeRepoNaddr,
  signTestEvent,
  TEST_PUBKEYS,
  type RepoAnnouncementOptions,
} from "./events/repo"

export const overviewMetadata = {
  identifier: `Legacy.Case-${"repository-identity-".repeat(5)}stable`,
  name: "Repository metadata preview",
  description:
    "A **read-only overview** for everyone who works on this repository.\n\n" +
    "Maintainers and contributors can inspect the published repository metadata without opening the owner's settings. " +
    "This description is deliberately longer than the repository-card preview so the overview must show it in full. " +
    "Read the [contribution guide](https://example.test/contributing) before getting started. End of full description.",
  hashtags: ["nostr", "svelte", "nostr", "", " ", `topic-${"long-".repeat(15)}name`],
  earliestUniqueCommit: "1234567890abcdef1234567890abcdef12345678",
  maintainers: [TEST_PUBKEYS.maintainer],
  pubkey: TEST_PUBKEYS.alice,
  relays: ["wss://repo-overview-metadata.test/"],
  created_at: 1705320000,
} satisfies RepoAnnouncementOptions

export const createOverviewMetadataAnnouncement = ({
  community,
  ...changes
}: Partial<RepoAnnouncementOptions> & {community?: RepoCommunityBinding} = {}) =>
  signTestEvent(
    withRepoCommunityBinding(createRepoAnnouncement({...overviewMetadata, ...changes}), community),
  )

export const overviewMetadataPath = `/git/${encodeRepoNaddr(
  overviewMetadata.pubkey,
  overviewMetadata.identifier,
  overviewMetadata.relays,
)}`
