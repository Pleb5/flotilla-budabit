<script lang="ts">
  import ModerationReportCard from "@app/components/community/ModerationReportCard.svelte"
  import type {CommunityModerationAction} from "@app/core/community-reports"

  type Props = {
    reports: CommunityModerationAction[]
    relays?: string[]
    showReporter?: boolean
    emptyMessage?: string
  }

  const {
    reports,
    relays = [],
    showReporter = false,
    emptyMessage = "No moderation actions.",
  }: Props = $props()
</script>

<div class="flex flex-col gap-3">
  {#each reports as report (report.event.id)}
    <ModerationReportCard {report} {relays} {showReporter} />
  {:else}
    <p class="rounded-box bg-base-200 p-4 text-center text-sm opacity-70">{emptyMessage}</p>
  {/each}
</div>
