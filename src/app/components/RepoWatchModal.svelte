<script lang="ts">
  import {now} from "@welshman/lib"
  import {Address} from "@welshman/util"
  import {preventDefault} from "@lib/html"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Button from "@lib/components/Button.svelte"
  import Spinner from "@lib/components/Spinner.svelte"
  import {pushToast} from "@app/util/toast"
  import {setCheckedAt} from "@app/util/notifications"
  import {makeGitPath} from "@app/util/routes"
  import {
    defaultRepoWatchOptions,
    updateRepoWatch,
    userRepoWatchValues,
    type RepoWatchActivityFilter,
    type RepoWatchOptions,
  } from "@app/core/repo-watch"

  type Props = {
    repoAddr: string
    repoName?: string
    repoBasePath?: string
    hasCommunity?: boolean
  }

  const {
    repoAddr,
    repoName = "Repository",
    repoBasePath = "",
    hasCommunity = false,
  }: Props = $props()

  const existingOptions = $derived.by(() => $userRepoWatchValues.repos[repoAddr])

  const cloneOptions = (options: RepoWatchOptions) => JSON.parse(JSON.stringify(options))

  let watchEnabled = $state(false)
  let options = $state<RepoWatchOptions>(cloneOptions(defaultRepoWatchOptions))
  let dirty = $state(false)
  let loading = $state(false)

  const activityFilterOptions: Array<{
    value: RepoWatchActivityFilter
    label: string
    tooltip: string
    requiresCommunity?: boolean
  }> = [
    {
      value: "all",
      label: "All activity",
      tooltip: "Show badges for enabled activity from anyone except you.",
    },
    {
      value: "community",
      label: "Community-only",
      tooltip:
        "Only show badges for activity from eligible members of this repo's tagged community.",
      requiresCommunity: true,
    },
    {
      value: "maintainers",
      label: "Maintainer-only",
      tooltip: "Only show badges for activity from the repo owner and declared maintainers.",
    },
    {
      value: "maintainers-community",
      label: "Maintainers + community only",
      tooltip:
        "Only show badges for activity from declared maintainers or eligible tagged-community members.",
      requiresCommunity: true,
    },
  ]

  const visibleActivityFilterOptions = $derived(
    activityFilterOptions.filter(option => hasCommunity || !option.requiresCommunity),
  )

  const isCommunityActivityFilter = (value: RepoWatchActivityFilter) =>
    value === "community" || value === "maintainers-community"

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

  $effect(() => {
    if (!hasCommunity && isCommunityActivityFilter(options.activityFilter)) {
      options.activityFilter = "all"
    }
  })

  const markDirty = () => {
    dirty = true
  }

  const hasAnyOption = (opts: RepoWatchOptions) =>
    opts.issues.new ||
    opts.issues.comments ||
    opts.prs.new ||
    opts.prs.comments ||
    opts.prs.updates ||
    opts.status.open ||
    opts.status.draft ||
    opts.status.applied ||
    opts.status.closed ||
    opts.assignments

  const back = () => history.back()

  const normalizeOptionsForRepo = (opts: RepoWatchOptions): RepoWatchOptions => {
    const next = cloneOptions(opts)
    if (!hasCommunity && isCommunityActivityFilter(next.activityFilter)) {
      next.activityFilter = "all"
    }
    next.reviews = false
    return next
  }

  const markWatchedSectionsSeen = () => {
    const checkedAt = now()
    const repoBasePaths = new Set<string>()

    if (repoBasePath) repoBasePaths.add(repoBasePath)

    try {
      repoBasePaths.add(makeGitPath(undefined, Address.from(repoAddr).toNaddr()))
    } catch {
      // If the watch key is malformed, the current route path is the best available checkpoint.
    }

    for (const basePath of repoBasePaths) {
      setCheckedAt(`${basePath}/issues`, checkedAt)
      setCheckedAt(`${basePath}/prs`, checkedAt)
    }
  }

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
      await updateRepoWatch(repoAddr, normalizeOptionsForRepo(options))
      markWatchedSectionsSeen()
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
      <strong class="mb-2 block">Filter activity</strong>
      <div class="grid gap-2">
        {#each visibleActivityFilterOptions as option (option.value)}
          <label class="flex items-center gap-2">
            <input
              type="radio"
              class="radio radio-primary radio-sm"
              value={option.value}
              bind:group={options.activityFilter}
              oninput={markDirty}
              disabled={!watchEnabled} />
            <span>{option.label}</span>
            <span
              class="tooltip tooltip-left inline-flex cursor-help items-center rounded-full border border-base-300 px-1.5 text-xs opacity-70"
              data-tip={option.tooltip}
              title={option.tooltip}>
              ?
            </span>
          </label>
        {/each}
      </div>
    </div>

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
      <strong class="mb-2 block">PRs</strong>
      <label class="flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.prs.new}
          oninput={markDirty}
          disabled={!watchEnabled} />
        New PRs
      </label>
      <label class="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.prs.updates}
          oninput={markDirty}
          disabled={!watchEnabled} />
        PR updates
      </label>
      <label class="mt-2 flex items-center gap-2">
        <input
          type="checkbox"
          class="checkbox"
          bind:checked={options.prs.comments}
          oninput={markDirty}
          disabled={!watchEnabled} />
        PR comments (root-level only)
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
          Merged
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
    </div>
  </div>

  <p class="text-xs text-muted-foreground">
    {#if __ALERTS__}
      Comments are in-app only. Email digests include issues, PRs, status changes, and assignments.
    {:else}
      Watch settings create in-app notifications only.
    {/if}
  </p>

  <ModalFooter>
    <Button class="btn btn-link" onclick={back}>Go back</Button>
    <Button type="submit" class="btn btn-primary" disabled={loading}>
      <Spinner {loading}>Save</Spinner>
    </Button>
  </ModalFooter>
</form>
