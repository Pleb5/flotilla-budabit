<script lang="ts">
  import type {RepoCreationRecoveryRecord} from "@nostr-git/ui"
  import type {NostrEvent} from "nostr-tools"

  const {
    records,
    busy,
    onRecover,
  }: {
    records: RepoCreationRecoveryRecord[]
    busy: string[]
    onRecover: (record: RepoCreationRecoveryRecord, reviewed?: NostrEvent) => Promise<void>
  } = $props()

  const values = (event: NostrEvent, tag: string) =>
    event.tags.filter(item => item[0] === tag).flatMap(item => item.slice(1))
</script>

{#if records.length}
  <section
    aria-label="Pending repository operations"
    class="space-y-3 rounded-lg border border-border bg-card p-4">
    <h2 class="font-semibold">Pending repository operations</h2>
    <p class="text-sm text-muted-foreground">
      Completed Git work is retained. Metadata recovery does not recreate or push repositories.
    </p>
    {#each records as record (record.id)}
      <div class="space-y-2 border-t border-border pt-3" data-recovery-id={record.id}>
        <p class="break-all font-medium">{record.repoName}</p>
        <p class="text-sm" role="status">
          {record.manualAttention.reason ||
            record.lastError ||
            "Repository metadata delivery is pending."}
        </p>
        {#if record.phase === "metadata-review" && record.reviewAnnouncement}
          {@const current = record.reviewAnnouncement}
          <details class="space-y-2">
            <summary class="cursor-pointer text-sm font-medium"
              >Review current owner metadata</summary>
            <dl class="space-y-1 break-all text-sm">
              <dt class="font-medium">Name</dt>
              <dd>{values(current, "name").join(", ") || record.repoName}</dd>
              <dt class="font-medium">Maintainers</dt>
              <dd>{values(current, "maintainers").join(", ") || "Owner only"}</dd>
              <dt class="font-medium">Upstreams</dt>
              <dd>{values(current, "u").join(", ") || "None"}</dd>
              <dt class="font-medium">Verified hosting to retain</dt>
              <dd>
                {record.targets
                  .filter(target => target.stage === "verified")
                  .map(target => target.remoteUrl)
                  .filter(Boolean)
                  .join(", ") || "Target verification pending"}
              </dd>
            </dl>
            <p class="text-sm text-muted-foreground">
              Keep this announcement's content, permissions, and other metadata. Apply only verified
              hosting changes. Another owner edit will require a new review.
            </p>
            <details>
              <summary class="cursor-pointer text-sm">Full announcement</summary>
              <pre
                class="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-xs">{JSON.stringify(
                  current,
                  null,
                  2,
                )}</pre>
            </details>
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={busy.includes(record.id)}
              onclick={() => onRecover(record, current)}>
              {busy.includes(record.id)
                ? "Recovering..."
                : "Use current metadata and finish hosting"}
            </button>
          </details>
        {:else}
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            disabled={busy.includes(record.id)}
            onclick={() => onRecover(record)}>
            {busy.includes(record.id) ? "Recovering..." : "Retry recovery"}
          </button>
        {/if}
      </div>
    {/each}
  </section>
{/if}
