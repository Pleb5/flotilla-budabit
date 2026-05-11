<script lang="ts">
  import {fade} from "@lib/transition"
  import CompassBig from "@assets/icons/compass-big.svg?dataurl"
  import NotesMinimalistic from "@assets/icons/notes-minimalistic.svg?dataurl"
  import StarFallMinimalistic from "@assets/icons/star-fall-minimalistic.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import ChatRound from "@assets/icons/chat-round.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Link from "@lib/components/Link.svelte"
  import {makeSpacePath} from "@app/util/routes"
  import {notifications} from "@app/util/notifications"

  type Props = {
    url: string
  }

  const {url}: Props = $props()
  const chatPath = makeSpacePath(url, "chat")
  const goalsPath = makeSpacePath(url, "goals")
  const threadsPath = makeSpacePath(url, "threads")
  const calendarPath = makeSpacePath(url, "calendar")
  const gitPath = makeSpacePath(url, "git")
</script>

<div class="card2 bg-alt md:hidden">
  <h3 class="mb-4 flex items-center gap-2 text-lg font-semibold">
    <Icon icon={CompassBig} />
    Quick Links
  </h3>
  <div class="flex flex-col gap-2">
    <Link href={chatPath} class="btn btn-neutral w-full justify-start">
      <div class="relative flex items-center gap-2">
        <Icon icon={ChatRound} />
        Chat
        {#if $notifications.has(chatPath)}
          <div class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-primary" transition:fade>
          </div>
        {/if}
      </div>
    </Link>
    <Link href={goalsPath} class="btn btn-neutral w-full justify-start">
      <div class="relative flex items-center gap-2">
        <Icon icon={StarFallMinimalistic} />
        Goals
        {#if $notifications.has(goalsPath)}
          <div
            class="absolute -right-3 -top-1 h-2 w-2 rounded-full bg-neutral-content"
            transition:fade>
          </div>
        {/if}
      </div>
    </Link>
  </div>
</div>
