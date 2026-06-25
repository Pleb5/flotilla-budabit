<script lang="ts">
  import {getContext} from "svelte"
  import {profilesByPubkey} from "@welshman/app"
  import {REPO_KEY, REPO_SETTINGS_ACTIONS_KEY, type RepoSettingsActions} from "@app/core/git-state"
  import {Card, EditRepoPanel, type Repo, type RepoCommunityOption} from "@nostr-git/ui"
  import {activeUserCommunityRefs} from "@app/core/community-state"
  import {
    COMMUNITY_WRITE_TARGETS,
    communityWritableSectionsSupportTarget,
  } from "@app/core/community-permissions"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoSettings = getContext<RepoSettingsActions | undefined>(REPO_SETTINGS_ACTIONS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const canEditAnnouncement = $derived(repoSettings?.canEditAnnouncement ?? false)

  const getCommunityOptionLabel = (communityPubkey: string) => {
    const profile = $profilesByPubkey.get(communityPubkey)
    return (
      profile?.display_name ||
      profile?.name ||
      `${communityPubkey.slice(0, 8)}...${communityPubkey.slice(-6)}`
    )
  }

  const repoCommunityOptions = $derived.by((): RepoCommunityOption[] =>
    $activeUserCommunityRefs
      .filter(ref =>
        communityWritableSectionsSupportTarget({
          definition: ref.definition,
          writableSections: ref.writableSections,
          target: COMMUNITY_WRITE_TARGETS.repository,
        }),
      )
      .map(ref => ({
        pubkey: ref.communityPubkey,
        label: getCommunityOptionLabel(ref.communityPubkey),
        relays: ref.definition.relays,
      })),
  )
</script>

<div class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 sm:p-6">
  <h1 class="text-xl font-semibold">Settings</h1>

  {#if canEditAnnouncement && repoSettings}
    <EditRepoPanel
      variant="page"
      repo={repoClass}
      onPublishEvent={repoSettings.publishRepoEvent}
      onSaveComplete={repoSettings.onSaveComplete}
      canDelete={repoSettings.canDelete}
      onRequestDelete={repoSettings.canDelete ? repoSettings.openDeleteRepoModal : undefined}
      getProfile={repoSettings.getProfile}
      searchProfiles={repoSettings.searchProfiles}
      searchRelays={repoSettings.searchRelays}
      communityOptions={repoCommunityOptions} />
  {:else}
    <Card class="p-4 sm:p-6">
      <h2 class="mb-2 text-lg font-semibold">Repository settings</h2>
      <p class="text-sm text-muted-foreground">
        Only the repository owner can edit repository settings.
      </p>
    </Card>
  {/if}
</div>
