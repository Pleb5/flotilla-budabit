<script lang="ts">
  import {
    ArrowRight,
    BadgeCheck,
    Blocks,
    CalendarDays,
    Check,
    ClipboardList,
    Code,
    FileText,
    Flag,
    GitBranch,
    Globe2,
    Image,
    KeyRound,
    LockKeyhole,
    MessageSquare,
    Network,
    PenLine,
    Replace,
    Server,
    ShieldCheck,
    UsersRound,
    Zap,
  } from "@lucide/svelte"
  import {
    COMMUNITY_SECTION_CALENDAR,
    COMMUNITY_SECTION_GENERAL,
    COMMUNITY_SECTION_GOALS,
    COMMUNITY_SECTION_REPO_CURATOR,
    COMMUNITY_SECTION_ROOMS,
    COMMUNITY_SECTION_THREADS,
    COMMUNITY_SECTION_WIDGETS,
  } from "@app/core/community"
  import Page from "@lib/components/Page.svelte"

  const benefits = [
    "User-owned accounts",
    "Independent community",
    "Portable content",
    "Permissionless collaboration",
  ]

  const defaultSections = [
    {
      label: COMMUNITY_SECTION_GENERAL,
      detail: "Room messages, comments, reactions, reports, labels",
    },
    {label: COMMUNITY_SECTION_ROOMS, detail: "Who can start new rooms"},
    {label: COMMUNITY_SECTION_THREADS, detail: "Who can start new threads"},
    {label: COMMUNITY_SECTION_CALENDAR, detail: "Who can publish calendar events"},
    {label: COMMUNITY_SECTION_GOALS, detail: "Who can publish fundraiser goals"},
    {label: COMMUNITY_SECTION_REPO_CURATOR, detail: "Repos and permalink curation"},
    {label: COMMUNITY_SECTION_WIDGETS, detail: "Smart widget curation"},
  ]

  const alternativeSections = [
    {label: COMMUNITY_SECTION_GENERAL, detail: "Shared discussion and moderation signals"},
    {label: "Conversation-creator", detail: "Room creators and thread creators together"},
    {label: "Events-and-goals", detail: "Calendar events and fundraiser goals together"},
    {label: "Code-and-widget-curator", detail: "Repo, permalink, and widget curation together"},
  ]
</script>

<svelte:head>
  <title>How BudaBit communities work</title>
  <meta
    name="description"
    content="A visual guide for community leaders explaining portable BudaBit communities, default content sections, moderators, client-side moderation, and replaceable infrastructure." />
</svelte:head>

<Page class="cw-full bg-base-300 text-base-content">
  <main
    class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 pb-28 sm:px-6 lg:px-8 lg:py-10">
    <section
      class="relative isolate overflow-hidden rounded-[2rem] border border-base-content/10 bg-base-100 p-6 shadow-xl ring-1 ring-base-content/10 sm:p-8 lg:p-10">
      <div class="absolute inset-0 bg-gradient-to-br from-primary/20 via-base-100 to-info/25"></div>
      <div class="relative grid gap-8 lg:grid-cols-[minmax(0,1fr)_420px] lg:items-center">
        <div>
          <div
            class="mb-5 inline-flex rounded-full border border-warning/45 bg-warning/20 px-3 py-1 text-xs font-bold uppercase tracking-wide text-warning">
            Community leader guide
          </div>
          <h1
            class="max-w-4xl text-4xl font-bold tracking-tight text-base-content sm:text-5xl lg:text-6xl">
            How BudaBit communities work
          </h1>
          <p class="mt-5 max-w-3xl text-base leading-relaxed text-base-content/90 sm:text-lg">
            A BudaBit community is anchored by a Nostr key, shaped by content sections, and free to
            swap the infrastructure around it.
          </p>
          <div class="mt-6 flex flex-wrap gap-2">
            {#each benefits as benefit}
              <span
                class="badge gap-1 border border-success/60 bg-success px-3 py-3 font-semibold text-success-content shadow-sm">
                <Check size={14} />
                {benefit}
              </span>
            {/each}
          </div>
        </div>

        <div class="rounded-[1.5rem] border border-base-content/10 bg-base-200 p-5 shadow-lg">
          <div class="grid gap-3 text-center">
            <div
              class="mx-auto rounded-2xl border border-primary bg-primary p-5 text-primary-content shadow-sm">
              <KeyRound size={44} />
            </div>
            <strong class="text-xl text-base-content">One Nostr keypair</strong>
            <p class="text-sm leading-relaxed text-base-content/85">
              The community identity is globally unique. Content can move between relays and apps
              without becoming ambiguous.
            </p>
          </div>
          <div class="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-sm">
            <div class="rounded-2xl border border-base-300 bg-base-100 p-3 text-center font-medium">
              Relay A
            </div>
            <ArrowRight class="text-base-content/70" size={18} />
            <div class="rounded-2xl border border-base-300 bg-base-100 p-3 text-center font-medium">
              Relay B
            </div>
          </div>
          <p class="mt-3 text-center text-xs text-base-content/75">
            Same community, same key, no confusion.
          </p>
        </div>
      </div>
    </section>

    <section class="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex flex-col gap-5">
          <div class="min-w-0">
            <div class="flex items-center gap-3 text-primary">
              <ShieldCheck size={28} />
              <h2 class="text-2xl font-bold">Portable is power</h2>
            </div>
            <p class="mt-3 max-w-2xl text-sm leading-relaxed opacity-75 sm:text-base">
              Nostr is the verifiable backbone. Relays, media servers, mints, git servers, and
              clients are configurable, redundant, and replaceable.
            </p>
          </div>
          <div class="grid min-w-0 gap-3 sm:grid-cols-2">
            <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
              <UsersRound class="text-success" size={24} />
              <strong class="mt-3 block">Accounts stay with users</strong>
            </div>
            <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
              <Globe2 class="text-info" size={24} />
              <strong class="mt-3 block">The community stays independent</strong>
            </div>
            <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
              <Replace class="text-warning" size={24} />
              <strong class="mt-3 block">Infrastructure can be replaced</strong>
            </div>
            <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
              <Network class="text-primary" size={24} />
              <strong class="mt-3 block">Open protocols invite collaboration</strong>
            </div>
          </div>
        </div>
      </article>

      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex items-center gap-3 text-info">
          <KeyRound size={28} />
          <h2 class="text-2xl font-bold">One community, one key</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          Each community is tied to one Nostr keypair. That gives leaders one clear public identity
          for publishing the community definition and policy.
        </p>
        <div class="mt-5 rounded-2xl border border-info/25 bg-info/10 p-4">
          <div class="flex flex-wrap items-center justify-center gap-3 text-sm font-semibold">
            <span class="rounded-full bg-base-100 px-4 py-2">npub...</span>
            <ArrowRight size={18} />
            <span class="rounded-full bg-base-100 px-4 py-2">Community definition</span>
            <ArrowRight size={18} />
            <span class="rounded-full bg-base-100 px-4 py-2">Shared context</span>
          </div>
        </div>
      </article>
    </section>

    <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
      <div class="max-w-4xl">
        <div class="flex items-center gap-3 text-primary">
          <Blocks size={28} />
          <h2 class="text-2xl font-bold">Default content sections</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          BudaBit starts communities with useful default sections. Owners can redefine those
          sections later to match how their group actually works.
        </p>
      </div>

      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <div class="mb-4 flex items-center justify-between gap-3">
            <strong>Default definition</strong>
            <span class="badge badge-primary">editable</span>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            {#each defaultSections as section}
              <div class="rounded-2xl border border-base-300 bg-base-100 p-3">
                <strong>{section.label}</strong>
                <p class="mt-1 text-xs opacity-65">{section.detail}</p>
                <div class="mt-3 flex flex-wrap gap-1 text-[0.65rem] uppercase tracking-wide">
                  <span class="rounded-full bg-primary/10 px-2 py-1 text-primary">access</span>
                  <span class="rounded-full bg-info/10 px-2 py-1 text-info">moderation</span>
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <div class="mb-4 flex items-center justify-between gap-3">
            <strong>Alternative definition example</strong>
            <span class="badge border border-success/25 bg-success/15 text-success"
              >owner-defined</span>
          </div>
          <div class="space-y-3">
            {#each alternativeSections as section, index}
              <div
                class="flex items-center gap-3 rounded-2xl border border-base-300 bg-base-100 p-3">
                <div
                  class="center h-9 w-9 shrink-0 rounded-xl bg-success/15 text-sm font-bold text-success">
                  {index + 1}
                </div>
                <div class="min-w-0 flex-1">
                  <strong>{section.label}</strong>
                  <p class="text-xs opacity-65">{section.detail}</p>
                </div>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <div class="mt-5 grid gap-3 md:grid-cols-3">
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <FileText class="text-primary" size={24} />
          <strong class="mt-3 block">Event kinds</strong>
          <p class="mt-1 text-sm opacity-70">
            Each section lists the Nostr event kinds it manages.
          </p>
        </div>
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <PenLine class="text-info" size={24} />
          <strong class="mt-3 block">Optional subtype</strong>
          <p class="mt-1 text-sm opacity-70">
            Subtypes split one event kind into multiple purposes.
          </p>
        </div>
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <LockKeyhole class="text-warning" size={24} />
          <strong class="mt-3 block">Policy per section</strong>
          <p class="mt-1 text-sm opacity-70">
            Access and moderation can be different for every section.
          </p>
        </div>
      </div>
    </section>

    <section class="grid gap-4 lg:grid-cols-2">
      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex items-center gap-3 text-success">
          <UsersRound size={28} />
          <h2 class="text-2xl font-bold">Owners delegate by section</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          The community owner can add any number of moderators to each section. Moderators help
          manage publishing access, application forms, reports, and moderation work.
        </p>

        <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
          <div class="rounded-2xl border border-success/25 bg-success/10 p-4 text-center">
            <BadgeCheck class="mx-auto text-success" size={30} />
            <strong class="mt-2 block">Owner</strong>
          </div>
          <ArrowRight class="mx-auto hidden opacity-50 sm:block" size={20} />
          <div class="grid gap-2">
            <div class="rounded-2xl bg-base-200 p-3 text-sm">Room-creator moderator</div>
            <div class="rounded-2xl bg-base-200 p-3 text-sm">Calendar-event moderator</div>
            <div class="rounded-2xl bg-base-200 p-3 text-sm">Code-curator moderator</div>
          </div>
        </div>

        <div class="mt-5 grid gap-3 sm:grid-cols-3">
          <div class="rounded-2xl bg-base-200 p-3 text-sm">
            <LockKeyhole class="mb-2 text-primary" size={20} />
            Grant publishing access
          </div>
          <div class="rounded-2xl bg-base-200 p-3 text-sm">
            <ClipboardList class="mb-2 text-info" size={20} />
            Manage access forms
          </div>
          <div class="rounded-2xl bg-base-200 p-3 text-sm">
            <Flag class="mb-2 text-warning" size={20} />
            Review reports
          </div>
        </div>
      </article>

      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex items-center gap-3 text-warning">
          <ShieldCheck size={28} />
          <h2 class="text-2xl font-bold">Moderation works in the client</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          By default, BudaBit enforces community moderation client-side. A community can work on any
          Nostr relay, while server-side enforcement is left to relay operators.
        </p>

        <div class="mt-5 rounded-2xl border border-warning/25 bg-warning/10 p-4">
          <div class="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <div class="rounded-2xl bg-base-100 p-3 text-center text-sm">
              <Server class="mx-auto mb-2 text-base-content/70" size={24} />
              Any relay
            </div>
            <ArrowRight class="mx-auto opacity-50" size={18} />
            <div class="rounded-2xl bg-base-100 p-3 text-center text-sm">
              <ShieldCheck class="mx-auto mb-2 text-warning" size={24} />
              BudaBit policy
            </div>
            <ArrowRight class="mx-auto opacity-50" size={18} />
            <div class="rounded-2xl bg-base-100 p-3 text-center text-sm">
              <UsersRound class="mx-auto mb-2 text-success" size={24} />
              Clean view
            </div>
          </div>
        </div>

        <div class="mt-5 rounded-2xl border border-info/25 bg-info/10 p-4">
          <strong class="text-info">Bootstrap faster</strong>
          <p class="mt-1 text-sm leading-relaxed opacity-75">
            Owners and admins can add members directly without forms when they are starting a new
            community or onboarding trusted people.
          </p>
        </div>
      </article>
    </section>

    <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
      <div class="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div>
          <div class="flex items-center gap-3 text-info">
            <Server size={28} />
            <h2 class="text-2xl font-bold">Run extra infrastructure when it matters</h2>
          </div>
          <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
            Communities can use shared infrastructure, run their own, or mix both. This gives
            leaders trusted files, code, payments, and storage without locking the group to one
            provider.
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <Network class="text-primary" size={26} />
            <strong class="mt-3 block">Relays</strong>
            <p class="mt-1 text-xs opacity-65">Community event transport</p>
          </div>
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <Image class="text-info" size={26} />
            <strong class="mt-3 block">Blossom</strong>
            <p class="mt-1 text-xs opacity-65">Nostr-native media files</p>
          </div>
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <Zap class="text-warning" size={26} />
            <strong class="mt-3 block">Cashu</strong>
            <p class="mt-1 text-xs opacity-65">Community-trusted eCash</p>
          </div>
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <GitBranch class="text-success" size={26} />
            <strong class="mt-3 block">Grasp</strong>
            <p class="mt-1 text-xs opacity-65">Nostr-native git hosting</p>
          </div>
        </div>
      </div>
    </section>

    <section class="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex items-center gap-3 text-success">
          <Code size={28} />
          <h2 class="text-2xl font-bold">Community-trusted code</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          Repositories and code snippets can be associated with a community when permissions allow.
          Repo owners still moderate their own issues, pull requests, comments, and repo content.
        </p>
        <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
          <div class="rounded-2xl bg-base-200 p-3 text-center text-sm">
            <UsersRound class="mx-auto mb-2 text-primary" size={24} />
            Community
          </div>
          <ArrowRight class="mx-auto opacity-50" size={18} />
          <div class="rounded-2xl bg-base-200 p-3 text-center text-sm">
            <GitBranch class="mx-auto mb-2 text-success" size={24} />
            Repo association
          </div>
          <ArrowRight class="mx-auto opacity-50" size={18} />
          <div class="rounded-2xl bg-base-200 p-3 text-center text-sm">
            <ShieldCheck class="mx-auto mb-2 text-info" size={24} />
            Trusted context
          </div>
        </div>
      </article>

      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex items-center gap-3 text-primary">
          <MessageSquare size={28} />
          <h2 class="text-2xl font-bold">What leaders manage</h2>
        </div>
        <div class="mt-5 grid gap-3 sm:grid-cols-2">
          <div class="rounded-2xl bg-base-200 p-4">
            <CalendarDays class="text-info" size={22} />
            <strong class="mt-3 block">A living definition</strong>
            <p class="mt-1 text-sm opacity-70">Sections, infrastructure, and policy can evolve.</p>
          </div>
          <div class="rounded-2xl bg-base-200 p-4">
            <UsersRound class="text-success" size={22} />
            <strong class="mt-3 block">Trusted people</strong>
            <p class="mt-1 text-sm opacity-70">Owners, moderators, members, and applicants.</p>
          </div>
          <div class="rounded-2xl bg-base-200 p-4">
            <FileText class="text-warning" size={22} />
            <strong class="mt-3 block">Content access</strong>
            <p class="mt-1 text-sm opacity-70">
              Who can publish in each default or custom section.
            </p>
          </div>
          <div class="rounded-2xl bg-base-200 p-4">
            <Flag class="text-error" size={22} />
            <strong class="mt-3 block">Local moderation</strong>
            <p class="mt-1 text-sm opacity-70">Reports, bans, reviews, and section decisions.</p>
          </div>
        </div>
      </article>
    </section>

    <section
      class="rounded-[1.5rem] border border-primary/25 bg-primary/10 p-5 text-center shadow-sm sm:p-6">
      <strong class="text-xl text-primary">The short version</strong>
      <p class="mx-auto mt-2 max-w-3xl text-sm leading-relaxed opacity-80 sm:text-base">
        A BudaBit community is a portable Nostr identity with editable content sections, delegated
        moderation, and optional infrastructure that the group can trust, replace, and share. This
        enables fully portable and permissionless collaboration over open protocols.
      </p>
    </section>
  </main>
</Page>
