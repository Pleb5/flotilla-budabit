<script lang="ts">
  import {
    ArrowRight,
    BadgeCheck,
    Blocks,
    BriefcaseBusiness,
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
    COMMUNITY_SECTION_MARKETPLACE,
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
    "Open collaboration",
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
    {label: COMMUNITY_SECTION_REPO_CURATOR, detail: "Repositories and code links"},
    {label: COMMUNITY_SECTION_WIDGETS, detail: "Community widgets"},
    {
      label: COMMUNITY_SECTION_MARKETPLACE,
      detail: "Jobs, services, proposals, orders, reviews, and classifieds",
    },
  ]

  const alternativeSections = [
    {label: COMMUNITY_SECTION_GENERAL, detail: "Discussion, reactions, and reports"},
    {label: "Conversation-creator", detail: "New rooms and threads"},
    {label: "Events-and-goals", detail: "Calendar events and fundraiser goals"},
    {label: "Code-and-widget-curator", detail: "Repositories, code links, and widgets"},
    {label: "Trade", detail: "Freelance work and classifieds"},
  ]

  const {showStartCommunityCta = false}: {showStartCommunityCta?: boolean} = $props()
</script>

<svelte:head>
  <title>How BudaBit communities work</title>
  <meta
    name="description"
    content="Choose what your BudaBit community shares, who can publish, and which tools and servers to use." />
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
            Choose what your community shares, who can publish, and where it is hosted.
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
            <strong class="text-xl text-base-content">Stable community ID</strong>
            <p class="text-sm leading-relaxed text-base-content/85">
              One account can own several communities, each with its own ID.
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
            Change servers. Keep your community identity.
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
              Signed Nostr records let compatible apps verify shared work. Your community chooses
              its hosting and services.
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
          <h2 class="text-2xl font-bold">Stable ID, explicit owner</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          Each community has a stable ID and settings signed by its owner. Share its community link
          so people open the right community.
        </p>
        <div class="mt-5 rounded-2xl border border-info/25 bg-info/10 p-4">
          <div class="flex flex-wrap items-center justify-center gap-3 text-sm font-semibold">
            <span class="rounded-full bg-base-100 px-4 py-2">Community ID + owner</span>
            <ArrowRight size={18} />
            <span class="rounded-full bg-base-100 px-4 py-2">Signed settings</span>
            <ArrowRight size={18} />
            <span class="rounded-full bg-base-100 px-4 py-2">Community link</span>
          </div>
        </div>
      </article>
    </section>

    <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
      <div class="max-w-4xl">
        <div class="flex items-center gap-3 text-primary">
          <Blocks size={28} />
          <h2 class="text-2xl font-bold">Content sections</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          Sections group content and publishing permissions. New communities start with these eight
          sections; owners can rename or reorganize them.
        </p>
      </div>

      <div class="mt-5 grid gap-4 lg:grid-cols-2">
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <div class="mb-4 flex items-center justify-between gap-3">
            <strong>Default sections</strong>
            <span class="badge badge-primary">editable</span>
          </div>
          <div class="grid gap-3 sm:grid-cols-2">
            {#each defaultSections as section}
              <div class="rounded-2xl border border-base-300 bg-base-100 p-3">
                <strong>{section.label}</strong>
                <p class="mt-1 text-xs opacity-65">{section.detail}</p>
                <div class="mt-3 flex flex-wrap gap-1 text-[0.65rem] uppercase tracking-wide">
                  <span class="rounded-full bg-primary/10 px-2 py-1 text-primary">publishing</span>
                  <span class="rounded-full bg-info/10 px-2 py-1 text-info">moderation</span>
                </div>
              </div>
            {/each}
          </div>
        </div>

        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <div class="mb-4 flex items-center justify-between gap-3">
            <strong>One way to combine them</strong>
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

      <p class="mt-4 text-sm opacity-75">
        Existing communities keep their saved sections until the owner updates them.
      </p>

      <div class="mt-5 grid gap-3 md:grid-cols-3">
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <FileText class="text-primary" size={24} />
          <strong class="mt-3 block">Content types</strong>
          <p class="mt-1 text-sm opacity-70">
            Group related content, such as messages or calendar events.
          </p>
        </div>
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <PenLine class="text-info" size={24} />
          <strong class="mt-3 block">Flexible sections</strong>
          <p class="mt-1 text-sm opacity-70">
            Keep room creation and thread creation separate, or combine them.
          </p>
        </div>
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <LockKeyhole class="text-warning" size={24} />
          <strong class="mt-3 block">Publishing rules</strong>
          <p class="mt-1 text-sm opacity-70">
            Choose who can publish and manage content in each section.
          </p>
        </div>
      </div>
    </section>

    <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
      <div class="flex items-center gap-3 text-success">
        <BriefcaseBusiness size={28} />
        <h2 class="text-2xl font-bold">A marketplace for your community</h2>
      </div>
      <p class="mt-3 max-w-4xl text-sm leading-relaxed opacity-75 sm:text-base">
        Marketplace covers freelance work and classifieds. Enable the Freelance and Classifieds
        widgets, then grant members publishing access.
      </p>
      <div class="mt-5 grid gap-3 sm:grid-cols-2">
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <strong>Find help with a job</strong>
          <p class="mt-2 text-sm opacity-75">
            Post a job → choose a proposal → record the outcome → exchange reviews.
          </p>
        </div>
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
          <strong>Offer your services</strong>
          <p class="mt-2 text-sm opacity-75">
            List a service → accept an order → the client records the outcome → exchange reviews.
          </p>
        </div>
        <div class="rounded-2xl border border-base-300 bg-base-200 p-4 sm:col-span-2">
          <strong>Sell or give away an item</strong>
          <p class="mt-2 text-sm opacity-75">
            Post a listing → arrange payment and handoff → mark it sold or given away.
          </p>
        </div>
      </div>
      <p class="mt-4 text-sm leading-relaxed opacity-75">
        New communities include the section. Existing communities can add Marketplace or update
        their Freelance section in settings. Widgets are added separately; participants arrange
        payment directly.
      </p>
    </section>

    <section class="grid gap-4 lg:grid-cols-2">
      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex items-center gap-3 text-success">
          <UsersRound size={28} />
          <h2 class="text-2xl font-bold">Owners delegate by section</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          Owners appoint section moderators to manage publishing access, applications, and reports.
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
          <h2 class="text-2xl font-bold">Your community sets the rules</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          BudaBit applies your community's publishing and moderation rules. Content moderation is
          section-specific; person bans apply across the community. Relay operators can enforce
          additional rules.
        </p>

        <div class="mt-5 rounded-2xl border border-warning/25 bg-warning/10 p-4">
          <div class="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
            <div class="rounded-2xl bg-base-100 p-3 text-center text-sm">
              <Server class="mx-auto mb-2 text-base-content/70" size={24} />
              Nostr relay
            </div>
            <ArrowRight class="mx-auto opacity-50" size={18} />
            <div class="rounded-2xl bg-base-100 p-3 text-center text-sm">
              <ShieldCheck class="mx-auto mb-2 text-warning" size={24} />
              Community rules
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
            Owners and section moderators can grant publishing access directly, without forms.
          </p>
        </div>
      </article>
    </section>

    <section class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
      <div class="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <div>
          <div class="flex items-center gap-3 text-info">
            <Server size={28} />
            <h2 class="text-2xl font-bold">Choose your hosting</h2>
          </div>
          <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
            Use shared servers, run your own, or mix both. Recommend services your community wants
            to use.
          </p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <Network class="text-primary" size={26} />
            <strong class="mt-3 block">Relays</strong>
            <p class="mt-1 text-xs opacity-65">Store and share community activity</p>
          </div>
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <Image class="text-info" size={26} />
            <strong class="mt-3 block">Blossom</strong>
            <p class="mt-1 text-xs opacity-65">Host and mirror media</p>
          </div>
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <Zap class="text-warning" size={26} />
            <strong class="mt-3 block">Cashu</strong>
            <p class="mt-1 text-xs opacity-65">Community-recommended mints</p>
          </div>
          <div class="rounded-2xl border border-base-300 bg-base-200 p-4">
            <GitBranch class="text-success" size={26} />
            <strong class="mt-3 block">GRASP</strong>
            <p class="mt-1 text-xs opacity-65">Git hosting on Nostr</p>
          </div>
        </div>
      </div>
    </section>

    <section class="grid gap-4 lg:grid-cols-[1fr_1fr]">
      <article class="rounded-[1.5rem] border border-base-300 bg-base-100 p-5 shadow-sm sm:p-6">
        <div class="flex items-center gap-3 text-success">
          <Code size={28} />
          <h2 class="text-2xl font-bold">Code with community context</h2>
        </div>
        <p class="mt-3 text-sm leading-relaxed opacity-75 sm:text-base">
          Repositories can have a community home. Code links can be shared across communities, with
          publishing permission. Repo owners and maintainers manage their own collaboration.
        </p>
        <div class="mt-5 grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto_1fr] sm:items-center">
          <div class="rounded-2xl bg-base-200 p-3 text-center text-sm">
            <UsersRound class="mx-auto mb-2 text-primary" size={24} />
            Community
          </div>
          <ArrowRight class="mx-auto opacity-50" size={18} />
          <div class="rounded-2xl bg-base-200 p-3 text-center text-sm">
            <GitBranch class="mx-auto mb-2 text-success" size={24} />
            Shared code
          </div>
          <ArrowRight class="mx-auto opacity-50" size={18} />
          <div class="rounded-2xl bg-base-200 p-3 text-center text-sm">
            <ShieldCheck class="mx-auto mb-2 text-info" size={24} />
            Community context
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
            <strong class="mt-3 block">Community settings</strong>
            <p class="mt-1 text-sm opacity-70">Sections, servers, and publishing rules.</p>
          </div>
          <div class="rounded-2xl bg-base-200 p-4">
            <UsersRound class="text-success" size={22} />
            <strong class="mt-3 block">Trusted people</strong>
            <p class="mt-1 text-sm opacity-70">Owners, moderators, members, and applicants.</p>
          </div>
          <div class="rounded-2xl bg-base-200 p-4">
            <FileText class="text-warning" size={22} />
            <strong class="mt-3 block">Publishing access</strong>
            <p class="mt-1 text-sm opacity-70">Who can publish in each section.</p>
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
        Your identity, your community, your publishing rules. Build together on open protocols with
        the tools and hosting you choose.
      </p>
    </section>

    {#if showStartCommunityCta}
      <div class="flex justify-center pt-2">
        <a class="btn btn-primary btn-lg" href="/explore/create-community">Start My Community</a>
      </div>
    {/if}
  </main>
</Page>
