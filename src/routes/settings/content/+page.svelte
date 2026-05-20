<script lang="ts">
  import {getListTags, getPubkeyTagValues, MUTES, makeEvent} from "@welshman/util"
  import {Router} from "@welshman/router"
  import {userMuteList, tagPubkey, publishThunk} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import Field from "@lib/components/Field.svelte"
  import FieldInline from "@lib/components/FieldInline.svelte"
  import Button from "@lib/components/Button.svelte"
  import Link from "@lib/components/Link.svelte"
  import ProfileMultiSelect from "@app/components/ProfileMultiSelect.svelte"
  import {pushToast} from "@app/util/toast"
  import {APP_NAME, userSettingsValues} from "@app/core/state"
  import {publishSettings} from "@app/core/commands"

  const reset = () => {
    settings = {...$userSettingsValues}
    mutedPubkeys = getPubkeyTagValues(getListTags($userMuteList))
  }

  const onsubmit = preventDefault(async () => {
    await publishSettings($state.snapshot(settings))

    publishThunk({
      event: makeEvent(MUTES, {tags: mutedPubkeys.map(tagPubkey)}),
      relays: Router.get().FromUser().getUrls(),
    })

    pushToast({message: "Your settings have been saved!"})
  })

  let settings = $state({...$userSettingsValues})
  let mutedPubkeys = $state(getPubkeyTagValues(getListTags($userMuteList)))
</script>

<form class="content column gap-4" {onsubmit}>
  <div class="card2 bg-alt col-4 shadow-md">
    <strong class="text-lg">Content Settings</strong>
    <FieldInline>
      {#snippet label()}
        <p>Hide sensitive content?</p>
      {/snippet}
      {#snippet input()}
        <input
          type="checkbox"
          class="toggle toggle-primary"
          bind:checked={settings.hide_sensitive} />
      {/snippet}
      {#snippet info()}
        <p>
          If content is marked by the author as sensitive, {$APP_NAME} will hide it by default.
        </p>
      {/snippet}
    </FieldInline>
    <FieldInline>
      {#snippet label()}
        <p>Show media?</p>
      {/snippet}
      {#snippet input()}
        <input type="checkbox" class="toggle toggle-primary" bind:checked={settings.show_media} />
      {/snippet}
      {#snippet info()}
        <p>Use this to disable link previews and image rendering.</p>
      {/snippet}
    </FieldInline>
    <Field>
      {#snippet label()}
        <p>Muted Accounts</p>
      {/snippet}
      {#snippet input()}
        <div>
          <ProfileMultiSelect bind:value={mutedPubkeys} />
        </div>
      {/snippet}
    </Field>
    <strong class="text-lg">Editor Settings</strong>
    <FieldInline>
      {#snippet label()}
        <p>Send Delay</p>
      {/snippet}
      {#snippet input()}
        <input
          class="range range-primary"
          type="range"
          min="0"
          max="10000"
          step="1000"
          bind:value={settings.send_delay} />
      {/snippet}
      {#snippet info()}
        <p>
          Delay sending chat messages for {settings.send_delay / 1000}
          {settings.send_delay === 1000 ? "second" : "seconds"}.
        </p>
      {/snippet}
    </FieldInline>
    <div class="rounded-box bg-base-200 p-3 text-sm">
      Personal media servers moved to <Link class="link" href="/settings/blossom">Blossom</Link>,
      where upload history, mirroring, and optimization settings live together.
    </div>
    <strong class="text-lg">Accessibility</strong>
    <Field>
      {#snippet label()}
        <p>Font size</p>
      {/snippet}
      {#snippet secondary()}
        <p>{Math.round(settings.font_size * 100)}%</p>
      {/snippet}
      {#snippet input()}
        <input
          class="range range-primary"
          type="range"
          min="0.8"
          max="1.3"
          step="0.05"
          bind:value={settings.font_size} />
      {/snippet}
    </Field>
    <div class="mt-4 flex flex-row items-center justify-between gap-4">
      <Button class="btn btn-neutral" onclick={reset}>Discard Changes</Button>
      <Button type="submit" class="btn btn-primary">Save Changes</Button>
    </div>
  </div>
</form>
