<script lang="ts">
  import {preventDefault} from "@lib/html"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {pushToast} from "@app/util/toast"
  import {
    defaultRepoWatchOptions,
    updateRepoWatch,
    userRepoWatchValues,
    type RepoWatchOptions,
  } from "@lib/budabit/repo-watch"

  type Props = {
    repoAddr: string
    repoName?: string
  }

  const {repoAddr, repoName = "Repository"}: Props = $props()

  const existingOptions = $derived.by(() => $userRepoWatchValues.repos[repoAddr])

  const cloneOptions = (options: RepoWatchOptions) => JSON.parse(JSON.stringify(options))

  let watchEnabled = $state(false)
  let options = $state<RepoWatchOptions>(cloneOptions(defaultRepoWatchOptions))
  let dirty = $state(false)
  let loading = $state(false)

  $effect(() => {
    if (dirty) return
    if (existingOptions) {
      watchEnabled = true
      options = cloneOptions(existingOptions)
    } else {
      watchEnabled = false
      options = cloneOptions(defaultRepoWatchOptions)
    }
  })

  const markDirty = () => {
    dirty = true
  }

  const hasAnyOption = (opts: RepoWatchOptions) =>
    opts.issues.new ||
    opts.issues.comments ||
    opts.patches.new ||
    opts.patches.comments ||
    opts.patches.updates ||
    opts.status.open ||
    opts.status.draft ||
    opts.status.applied ||
    opts.status.closed ||
    opts.assignments ||
    opts.reviews

  const back = () => history.back()

  const submit = async () => {
    if (!watchEnabled) {
      loading = true
      try {
        await updateRepoWatch(repoAddr, null)
        pushToast({message: "Watch disabled"})
        back()
      } catch (error: any) {
        pushToast({theme: "error", message: error?.message || "Failed to update watch settings"})
      } finally {
        loading = false
      }
      return
    }

    if (!hasAnyOption(options)) {
      return pushToast({
        theme: "error",
        message: "Select at least one notification type",
      })
    }

    loading = true
    try {
      await updateRepoWatch(repoAddr, options)
      pushToast({message: "Watch settings saved"})
      back()
    } catch (error: any) {
      pushToast({theme: "error", message: error?.message || "Failed to update watch settings"})
    } finally {
      loading = false
    }
  }
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      Watch {repoName}
    {/snippet}
    {#snippet info()}
      Choose which updates should trigger in-app notifications.
    {/snippet}
  </ModalHeader>

  <FieldInline>
    {#snippet label()}
      <p>Watch this repo*</p>
    {/snippet}
    {#snippet input()}
      <input
        type="checkbox"
        class="toggle toggle-primary"
        bind:checked={watchEnabled}
        oninput={markDirty} />
    {/snippet}
  </FieldInline>

  <div class="grid gap-4">
    <div class="card2 bg-alt p-4 shadow-sm">
      <strong class="mb-2 block">Issues</strong>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.issues.new}
          oninput={markDirty}
          disabled={!watchEnabled} />
        New issues
      </label>
      <label class="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.issues.comments}
          oninput={markDirty}
          disabled={!watchEnabled} />
        Issue comments (root-level only)
      </label>
    </div>

    <div class="card2 bg-alt p-4 shadow-sm">
      <strong class="mb-2 block">Patches + PRs</strong>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.patches.new}
          oninput={markDirty}
          disabled={!watchEnabled} />
        New patches or PRs
      </label>
      <label class="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.patches.updates}
          oninput={markDirty}
          disabled={!watchEnabled} />
        PR updates
      </label>
      <label class="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.patches.comments}
          oninput={markDirty}
          disabled={!watchEnabled} />
        Patch/PR comments (root-level only)
      </label>
    </div>

    <div class="card2 bg-alt p-4 shadow-sm">
      <strong class="mb-2 block">Status changes</strong>
      <div class="grid gap-2 sm:grid-cols-2">
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            class="checkbox"
            bind:checked={options.status.open}
            oninput={markDirty}
            disabled={!watchEnabled} />
          Open
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            class="checkbox"
            bind:checked={options.status.draft}
            oninput={markDirty}
            disabled={!watchEnabled} />
          Draft
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            class="checkbox"
            bind:checked={options.status.applied}
            oninput={markDirty}
            disabled={!watchEnabled} />
          Applied / merged
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            class="checkbox"
            bind:checked={options.status.closed}
            oninput={markDirty}
            disabled={!watchEnabled} />
          Closed
        </label>
      </div>
    </div>

    <div class="card2 bg-alt p-4 shadow-sm">
      <strong class="mb-2 block">Assignments</strong>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.assignments}
          oninput={markDirty}
          disabled={!watchEnabled} />
        Assigned to me
      </label>
      <label class="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.reviews}
          oninput={markDirty}
          disabled={!watchEnabled} />
        Review requested
      </label>
    </div>
  </div>

  <p class="text-xs text-muted-foreground">
    Comments are in-app only. Email digests include issues, patches/PRs, status changes, and assignments.
  </p>

  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>Go back</Button>
    <Button type="submit" class="btn btn-primary" disabled={loading}>
      <Spinner {loading}>Save</Spinner>
    </Button>
  </ModalFooter>
</form>
