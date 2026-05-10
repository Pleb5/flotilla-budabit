<script lang="ts">
  import {getContext} from "svelte"
  import {pubkey} from "@welshman/app"
  import {REPO_KEY, REPO_SETTINGS_ACTIONS_KEY, type RepoSettingsActions} from "@lib/budabit/state"
  import {Card, EditRepoPanel, type Repo} from "@nostr-git/ui"
  import RepoSettingsPanel from "@lib/budabit/components/RepoSettingsPanel.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)
  const repoSettings = getContext<RepoSettingsActions | undefined>(REPO_SETTINGS_ACTIONS_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }

  const canEditAnnouncement = $derived(repoSettings?.canEditAnnouncement ?? false)
  const canUpdateDefaultBranch = $derived(Boolean($pubkey && repoClass.isAuthorized($pubkey)))
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
      searchRelays={repoSettings.searchRelays} />
  {:else if canUpdateDefaultBranch}
    <RepoSettingsPanel repo={repoClass} />
  {:else}
    <Card class="p-4 sm:p-6">
      <h2 class="mb-2 text-lg font-semibold">Repository settings</h2>
      <p class="text-sm text-muted-foreground">
        Only the repository owner can edit repository metadata. Maintainers can change the default
        branch.
      </p>
    </Card>
  {/if}
</div>
