<script lang="ts">
  import {secondsToDate, dateToSeconds} from "@welshman/lib"
  import CloseCircle from "@assets/icons/close-circle.svg?dataurl"
  import CalendarMinimalistic from "@assets/icons/calendar-minimalistic.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import Button from "@lib/components/Button.svelte"

  interface Props {
    value?: number | undefined
  }

  let {value = $bindable()}: Props = $props()

  const pad = (n: number) => ("00" + String(n)).slice(-2)

  const getDateValue = (d: Date) =>
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

  const getTimeValue = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`

  const getDateFromValues = () => {
    const [year, month, day] = dateValue.split("-").map(Number)
    if (!year || !month || !day) return undefined

    const nextDate = new Date(year, month - 1, day)

    if (time) {
      const [hours, minutes] = time.split(":").map(Number)

      if (Number.isInteger(hours) && Number.isInteger(minutes)) {
        nextDate.setHours(hours, minutes, 0, 0)
      }
    }

    return nextDate
  }

  const syncFromValue = (nextValue: number | undefined) => {
    const nextDate = nextValue ? secondsToDate(nextValue) : undefined

    dateValue = nextDate ? getDateValue(nextDate) : ""
    time = nextDate ? getTimeValue(nextDate) : ""
  }

  const focusDate = () => dateInput?.focus()

  const clear = () => {
    dateValue = ""
    time = ""
  }

  const initialDate = value ? secondsToDate(value) : undefined
  const initialDateValue = initialDate ? getDateValue(initialDate) : ""
  const initialTime = initialDate ? getTimeValue(initialDate) : ""
  // Let the user select a date max 2 years in the future
  const today = new Date()
  const max = new Date(today)
  max.setFullYear(max.getFullYear() + 2)
  const maxDateValue = getDateValue(max)

  let dateValue = $state(initialDateValue)
  let time = $state(initialTime)
  let dateInput: HTMLInputElement | undefined = $state()
  let lastValue: number | undefined = value

  // Sync external value changes into the picker fields.
  $effect(() => {
    if (value === lastValue) return

    lastValue = value
    syncFromValue(value)
  })

  // Sync user edits back into the bound timestamp without clearing initial values.
  $effect(() => {
    const currentDate = getDateFromValues()

    if (!currentDate) {
      if (lastValue !== undefined) {
        lastValue = undefined
        value = undefined
      }

      return
    }

    const nextValue = dateToSeconds(currentDate)

    if (nextValue !== lastValue) {
      lastValue = nextValue
      value = nextValue
    }
  })
</script>

<div class="relative grid grid-cols-2 gap-2">
  <div class="relative">
    <input
      bind:this={dateInput}
      bind:value={dateValue}
      class="input input-bordered w-full rounded-lg pr-10"
      type="date"
      max={maxDateValue} />
    <div class="absolute right-2 top-0 flex h-12 cursor-pointer items-center gap-2">
      {#if dateValue}
        <Button onclick={clear} class="h-5">
          <Icon icon={CloseCircle} />
        </Button>
      {:else}
        <Button onclick={focusDate} class="h-5">
          <Icon icon={CalendarMinimalistic} />
        </Button>
      {/if}
    </div>
  </div>
  <label class="input input-bordered flex items-center">
    <input
      list="time-options"
      class="grow"
      type="time"
      step="60"
      bind:value={time} />
  </label>
</div>
