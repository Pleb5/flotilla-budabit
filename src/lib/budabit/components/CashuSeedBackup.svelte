<script lang="ts">
  import {getCashuMnemonic, confirmCashuBackup} from "@lib/budabit/cashu"
  import Button from "@lib/components/Button.svelte"

  interface Props {
    onconfirmed?: () => void
  }

  const {onconfirmed}: Props = $props()

  const words = $derived(getCashuMnemonic().split(" "))

  let copied = $state(false)
  let quizIndices = $state<number[]>([])
  let quizAnswers = $state<string[]>(["", "", ""])
  let error = $state("")
  let step = $state<"display" | "quiz">("display")

  const copyAll = async () => {
    await navigator.clipboard.writeText(words.join(" "))
    copied = true
    setTimeout(() => (copied = false), 2000)
  }

  const startQuiz = () => {
    const indices: number[] = []
    while (indices.length < 3) {
      const i = Math.floor(Math.random() * words.length)
      if (!indices.includes(i)) indices.push(i)
    }
    quizIndices = indices.sort((a, b) => a - b)
    quizAnswers = ["", "", ""]
    error = ""
    step = "quiz"
  }

  const verify = async () => {
    const allCorrect = quizIndices.every(
      (idx, i) => quizAnswers[i].trim().toLowerCase() === words[idx].toLowerCase(),
    )
    if (!allCorrect) {
      error = "One or more words are incorrect. Please check your backup and try again."
      return
    }
    await confirmCashuBackup()
    onconfirmed?.()
  }
</script>

<div class="flex flex-col gap-6 p-4">
  {#if step === "display"}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Back Up Your Seed Phrase</h3>
      <p class="text-sm opacity-75">
        Write down these 12 words in order. They are the only way to recover your Cashu wallet.
        Never share them with anyone.
      </p>
    </div>

    <div class="grid grid-cols-3 gap-2">
      {#each words as word, i}
        <div class="card2 bg-alt flex items-center gap-2 px-3 py-2 text-sm">
          <span class="w-5 text-right opacity-50">{i + 1}.</span>
          <span class="font-mono font-semibold">{word}</span>
        </div>
      {/each}
    </div>

    <div class="flex gap-3">
      <Button class="btn btn-neutral btn-sm flex-1" onclick={copyAll}>
        {copied ? "Copied!" : "Copy All Words"}
      </Button>
      <Button class="btn btn-primary btn-sm flex-1" onclick={startQuiz}>
        I've Written It Down →
      </Button>
    </div>
  {:else}
    <div class="flex flex-col gap-2">
      <h3 class="text-lg font-bold">Confirm Your Backup</h3>
      <p class="text-sm opacity-75">
        Enter the words at the positions below to confirm you've saved your seed phrase.
      </p>
    </div>

    <div class="flex flex-col gap-3">
      {#each quizIndices as idx, i}
        <div class="flex items-center gap-3">
          <span class="w-16 text-right text-sm opacity-75">Word #{idx + 1}</span>
          <input
            class="input input-bordered input-sm flex-1 font-mono"
            type="text"
            placeholder="enter word"
            bind:value={quizAnswers[i]} />
        </div>
      {/each}
    </div>

    {#if error}
      <p class="text-sm text-error">{error}</p>
    {/if}

    <div class="flex gap-3">
      <Button class="btn btn-neutral btn-sm" onclick={() => (step = "display")}>← Back</Button>
      <Button class="btn btn-primary btn-sm flex-1" onclick={verify}>Confirm Backup</Button>
    </div>
  {/if}
</div>