<script lang="ts">
  import Button from "@lib/components/Button.svelte"
  import InlinePopover from "@lib/components/InlinePopover.svelte"
  import {preventDefault, stopPropagation} from "@lib/html"
  import ProfileCircle from "@app/components/ProfileCircle.svelte"
  import ProfileDetail from "@app/components/ProfileDetail.svelte"
  import ProfileName from "@app/components/ProfileName.svelte"
  import {pushModal} from "@app/util/modal"

  type Props = {
    maintainers: string[]
    relays?: string[]
    verifiedMaintainers?: Set<string> | string[]
    repoName?: string
    previewCount?: number
    showLabel?: boolean
    class?: string
  }

  const {
    maintainers,
    relays = [],
    verifiedMaintainers = new Set<string>(),
    repoName = "",
    previewCount = 3,
    showLabel = true,
    class: className = "",
  }: Props = $props()

  let popoverOpen = $state(false)

  const visibleMaintainers = $derived(maintainers.slice(0, previewCount))
  const hiddenMaintainerCount = $derived(Math.max(0, maintainers.length - previewCount))
  const verifiedMaintainerSet = $derived.by(() =>
    verifiedMaintainers instanceof Set ? verifiedMaintainers : new Set(verifiedMaintainers),
  )

  const openProfile = (pubkey: string) => {
    popoverOpen = false
    pushModal(ProfileDetail, {
      pubkey,
      url: relays[0],
      relays,
      verifiedMaintainerForRepo: verifiedMaintainerSet.has(pubkey) ? {repoName} : undefined,
    })
  }
</script>

{#if maintainers.length > 0}
  <div class={`flex min-w-0 items-center gap-2 ${className}`}>
    {#if showLabel}
      <span class="shrink-0 text-xs opacity-60">Maintainers</span>
    {/if}
    <div class="flex min-w-0 flex-wrap items-center gap-1.5">
      {#each visibleMaintainers as maintainer (maintainer)}
        {@const isVerifiedMaintainer = verifiedMaintainerSet.has(maintainer)}
        <Button
          class="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border py-0.5 pl-0.5 pr-2 text-left text-xs {isVerifiedMaintainer
            ? 'border-emerald-300/70 bg-emerald-50/80 text-emerald-900 hover:border-emerald-400/80 hover:bg-emerald-100/80 dark:border-emerald-500/35 dark:bg-emerald-950/30 dark:text-emerald-100 dark:hover:bg-emerald-900/35'
            : 'border-border/70 bg-background/70 hover:border-primary/40 hover:bg-primary/10'}"
          aria-label="View maintainer profile"
          title={isVerifiedMaintainer
            ? "Verified maintainer for this repo"
            : "View maintainer profile"}
          onclick={stopPropagation(preventDefault(() => openProfile(maintainer)))}>
          <ProfileCircle
            pubkey={maintainer}
            relays={relays}
            size={5}
            class="border border-border"
            verifiedMaintainerForRepo={isVerifiedMaintainer} />
          <span class="min-w-0 max-w-[6rem] truncate hover:underline">
            <ProfileName pubkey={maintainer} relays={relays} />
          </span>
          {#if isVerifiedMaintainer}
            <span
              class="shrink-0 rounded-full border border-emerald-300/70 bg-white/60 px-1 py-0 text-[9px] font-semibold uppercase tracking-wide text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-200">
              Verified
            </span>
          {/if}
        </Button>
      {/each}

      {#if hiddenMaintainerCount > 0}
        <div class="relative">
          <Button
            class="rounded-full border border-primary/30 bg-primary/10 px-2 py-1 text-xs font-medium text-primary hover:bg-primary/15"
            aria-expanded={popoverOpen}
            aria-label="Show all maintainers"
            title="Show all maintainers"
            onclick={stopPropagation(preventDefault(() => (popoverOpen = !popoverOpen)))}>
            +{hiddenMaintainerCount} more
          </Button>
          {#if popoverOpen}
            <InlinePopover onClose={() => (popoverOpen = false)} align="right" widthClass="w-72">
              <div class="space-y-3">
                <div>
                  <div class="text-sm font-semibold">Maintainers</div>
                  <div class="mt-1 text-xs text-muted-foreground">
                    {maintainers.length} people can maintain this repo.
                  </div>
                </div>
                <div class="space-y-1">
                  {#each maintainers as maintainer (maintainer)}
                    {@const isVerifiedMaintainer = verifiedMaintainerSet.has(maintainer)}
                    <Button
                      class="flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-1.5 text-left text-sm {isVerifiedMaintainer
                        ? 'border-emerald-300/60 bg-emerald-50/70 text-emerald-900 hover:bg-emerald-100/80 dark:border-emerald-500/35 dark:bg-emerald-950/25 dark:text-emerald-100 dark:hover:bg-emerald-900/30'
                        : 'border-transparent hover:bg-secondary/30'}"
                      aria-label="View maintainer profile"
                      title={isVerifiedMaintainer
                        ? "Verified maintainer for this repo"
                        : "View maintainer profile"}
                      onclick={stopPropagation(preventDefault(() => openProfile(maintainer)))}>
                      <ProfileCircle
                        pubkey={maintainer}
                        relays={relays}
                        size={6}
                        class="border border-border"
                        verifiedMaintainerForRepo={isVerifiedMaintainer} />
                      <span class="min-w-0 truncate font-medium hover:underline">
                        <ProfileName pubkey={maintainer} relays={relays} />
                      </span>
                      {#if isVerifiedMaintainer}
                        <span
                          class="ml-auto shrink-0 rounded-full border border-emerald-300/70 bg-white/60 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-500/40 dark:bg-emerald-950/60 dark:text-emerald-200">
                          Verified maintainer
                        </span>
                      {/if}
                    </Button>
                  {/each}
                </div>
              </div>
            </InlinePopover>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
