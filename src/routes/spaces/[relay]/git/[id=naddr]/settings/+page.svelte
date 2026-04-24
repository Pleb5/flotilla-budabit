<script lang="ts">
  import {getContext} from "svelte"
  import {REPO_KEY} from "@lib/budabit/state"
  import type {Repo} from "@nostr-git/ui"
  import RepoSettingsPanel from "@lib/budabit/components/RepoSettingsPanel.svelte"

  const repoClass = getContext<Repo>(REPO_KEY)

  if (!repoClass) {
    throw new Error("Repo context not available")
  }
</script>

<div class="mx-auto flex max-w-2xl flex-col gap-4 p-4 sm:p-6">
  <h1 class="text-xl font-semibold">Settings</h1>
  <RepoSettingsPanel repo={repoClass} />
</div>
