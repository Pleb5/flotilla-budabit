<script lang="ts">
  import PrimaryNavItem from "../../../src/lib/components/PrimaryNavItem.svelte"
  import SecondaryNavItem from "../../../src/lib/components/SecondaryNavItem.svelte"
  import NotificationDot from "../../../src/lib/components/NotificationDot.svelte"
  import Icon from "../../../src/lib/components/Icon.svelte"
  import Bell from "../../../src/assets/icons/bell.svg?dataurl"
  import Hashtag from "../../../src/assets/icons/hashtag.svg?dataurl"
  import FilterPanel from "../../../src/app/components/FilterPanel.svelte"
  import ChatItem from "../../../src/app/components/ChatItem.svelte"
  import GitItem from "../../../src/app/components/GitItem.svelte"
  import {RepoTab} from "@nostr-git/ui"
  import type {TrustedEvent} from "@welshman/util"

  const {repo}: {repo: TrustedEvent} = $props()
</script>

<main class="mx-auto grid max-w-5xl gap-4 p-4" data-testid="notification-indicators">
  <h1 class="text-xl font-bold">Notification indicators</h1>
  <section class="rounded-lg bg-base-200 p-4" data-testid="navigation-indicators">
    <h2>Desktop and compact navigation</h2>
    <div class="flex">
      <PrimaryNavItem title="Desktop bell" notification><Icon icon={Bell} /></PrimaryNavItem>
      <PrimaryNavItem title="Compact bell" compact notification
        ><Icon icon={Bell} /></PrimaryNavItem>
      <PrimaryNavItem title="Read bell"><Icon icon={Bell} /></PrimaryNavItem>
    </div>
  </section>
  <div class="grid gap-4 md:grid-cols-2">
    <section class="min-w-0 rounded-lg bg-base-200 p-4" data-testid="sidebar-indicators">
      <h2>Sidebar / drawer</h2>
      <div style="width: 16rem; max-width: 100%">
        <SecondaryNavItem href="/notification-fixture/unread" notification>
          <Icon icon={Hashtag} /><span class="ellipsize"
            >A very long community room name to test overlap</span>
        </SecondaryNavItem>
        <SecondaryNavItem notification onclick={() => {}}>
          <Icon icon={Hashtag} /><span class="ellipsize"
            >A very long sidebar action name to test overlap</span>
        </SecondaryNavItem>
        <SecondaryNavItem href="/notification-fixture/read"
          ><Icon icon={Hashtag} />Read room</SecondaryNavItem>
      </div>
    </section>
    <section class="min-w-0 rounded-lg bg-base-100 p-4" data-testid="repo-tab-indicators">
      <h2>Repository tabs</h2>
      <div class="flex flex-wrap">
        <RepoTab
          tabValue="issues"
          label="Issues"
          href="/notification-fixture/issues"
          activeTab="issues"
          notification />
        <RepoTab
          tabValue="prs"
          label="Pull requests"
          href="/notification-fixture/prs"
          activeTab="issues"
          notification />
      </div>
      <h2 class="mt-4">Selected and unselected tabs</h2>
      <div class="flex flex-wrap gap-2">
        <button class="btn btn-primary btn-sm">Starred<NotificationDot contrast /></button>
        <button class="btn btn-ghost btn-sm">Starred<NotificationDot /></button>
      </div>
    </section>
  </div>
  <section class="min-w-0" data-testid="filter-indicators">
    <h2>Unread counts, including 9+</h2>
    <FilterPanel mode="prs" statusBadgeCounts={{open: 1, merged: 99, closed: 1000, draft: 0}} />
  </section>
  <section class="min-w-0 rounded-lg bg-base-200" data-testid="chat-indicator">
    <ChatItem id="notification-fixture" pubkeys={[]} />
  </section>
  <section class="min-w-0" data-testid="repo-card-indicator">
    <GitItem
      event={repo}
      url="wss://notification-fixture.example"
      loadProfiles={false}
      showActions={false}
      hideDate />
  </section>
</main>
