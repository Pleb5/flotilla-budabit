<script lang="ts">
  import ShieldCheck from "@assets/icons/shield-check.svg?dataurl"
  import Code from "@assets/icons/code-2.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"

  const trustDocHref =
    "/git/naddr1qvzqqqrhnypzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqqgxvmr0w35kcmrp94382erpvf5hgqtk2vr/code?path=docs%2Farchitecture%2FWeb-of-Trust-in-BudaBit-Communities.md"
  const trustDocEventHref =
    "/nevent1qvzqqqqx2upzp5zweue6xqa9npf0md5pak95zgsph2za35sentk88jmzdqwk925sqqstd2x5chl93t2zhqjtxflehjlek55dl7678wswnz6mc9xjgkusn6c0hjwhy"
</script>

<div class="content column gap-4 pb-24 sm:gap-5 sm:pb-12">
  <section class="card2 bg-alt flex flex-col gap-4 shadow-md">
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div class="flex flex-col gap-2">
        <strong class="flex items-center gap-3 text-xl sm:text-2xl">
          <Icon icon={ShieldCheck} /> Trust in BudaBit
        </strong>
        <p class="max-w-3xl text-sm leading-relaxed opacity-75">
          BudaBit trust is client-side and community-first. Collaboration context comes from
          Communikey communities, section grants, repository-community associations, and current
          community moderation state.
        </p>
      </div>
      <span class="badge border border-success/25 bg-success/15 font-medium text-success">
        Community-first
      </span>
    </div>

    <div class="grid gap-3 md:grid-cols-2">
      <div class="rounded-box bg-base-100/40 p-4">
        <div class="font-medium">Primary Evidence</div>
        <p class="mt-2 text-sm opacity-75">
          Community admins, moderators, profile-list membership, and section write grants are the
          primary trust signals inside BudaBit communities.
        </p>
      </div>
      <div class="rounded-box bg-base-100/40 p-4">
        <div class="font-medium">Repository Context</div>
        <p class="mt-2 text-sm opacity-75">
          Repository-community associations give a repository a community context. Associations made
          by admins, repo moderators, or repo-section grantees carry stronger evidence.
        </p>
      </div>
      <div class="rounded-box bg-base-100/40 p-4">
        <div class="font-medium">Contextual Moderation</div>
        <p class="mt-2 text-sm opacity-75">
          Community reports and bans apply only in the community where they are effective. They do
          not create global distrust across BudaBit.
        </p>
      </div>
      <div class="rounded-box bg-base-100/40 p-4">
        <div class="font-medium">Direct Social Overlay</div>
        <p class="mt-2 text-sm opacity-75">
          Direct follows and mutes can help with discovery and ordering, but they are bounded
          personal signals and do not define community trust.
        </p>
      </div>
    </div>

    <div class="rounded-box border border-info/25 bg-info/10 px-4 py-3 text-sm text-info">
      Trust surfaces should show semantic labels like Community member, Moderator, You follow, or
      Banned here instead of raw compound scores.
    </div>
  </section>

  <section class="card2 bg-alt flex flex-col gap-4 shadow-md">
    <div class="flex flex-col gap-2">
      <strong class="flex items-center gap-3 text-base sm:text-lg">
        <Icon icon={Code} /> Architecture Reference
      </strong>
      <p class="max-w-3xl text-sm leading-relaxed opacity-75">
        The full architecture note is committed in this BudaBit repo. Open it in-app for the policy
        details, source event, and implementation rationale.
      </p>
    </div>

    <div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
      <Link href={trustDocHref} class="btn btn-primary btn-sm sm:btn-md">
        Read the trust model document
      </Link>
      <Link href={trustDocEventHref} class="btn btn-neutral btn-sm sm:btn-md">
        Open the source event
      </Link>
    </div>
  </section>
</div>
