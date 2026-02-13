<script lang="ts">
  import {parse, renderAsHtml} from "@welshman/content"
  import {fly} from "@lib/transition"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"
  import {toast, popToast} from "@app/util/toast"

  const onActionClick = (item: typeof $toast[number]) => {
    item.action?.onclick()
    popToast(item.id)
  }
</script>

{#if $toast.length > 0}
  <div class="bottom-sai right-sai toast z-toast flex flex-col gap-2">
    {#each $toast as item (item.id)}
      {@const theme = item.theme || "info"}
      <div
        transition:fly
        role="alert"
        class="alert flex justify-center whitespace-normal text-left"
        class:bg-base-100={theme === "info"}
        class:text-base-content={theme === "info"}
        class:alert-error={theme === "error"}
        class:alert-warning={theme === "warning"}>
        <p class:welshman-content-error={theme === "error"}>
          {#if item.message}
            {@html renderAsHtml(parse({content: item.message}))}
            {#if item.action}
              <Button class="cursor-pointer underline" onclick={() => onActionClick(item)}>
                {item.action.message}
              </Button>
            {/if}
          {:else if item.children}
            {@const {component: Component, props} = item.children}
            <Component toast={item} {...props} />
          {/if}
        </p>
        <Button class="flex items-center opacity-75" onclick={() => popToast(item.id)}>
          <Icon icon={CloseCircle} />
        </Button>
      </div>
    {/each}
  </div>
{/if}
