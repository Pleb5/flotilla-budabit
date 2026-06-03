<script lang="ts">
  import { createDataUrl, createBlob } from "../../../utils/binaryHelpers";

  const {
    content,
    filename,
    mimeType,
  }: {
    content: string;
    filename: string;
    mimeType: string;
  } = $props();

  // Convert content to data URL for audio display
  let dataUrl = $state("");
  let audioError = $state(false);
  let audioElement = $state<HTMLAudioElement>();

  $effect(() => {
    try {
      dataUrl = createDataUrl(content, mimeType);
    } catch (error) {
      console.error("Failed to create data URL for audio:", error);
      audioError = true;
    }
  });

  function handleAudioError() {
    audioError = true;
  }

  function downloadAudio() {
    try {
      const blob = createBlob(content, mimeType);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download audio:", error);
    }
  }
</script>

<div class="audio-viewer">
  {#if audioError}
    <div class="flex flex-col items-center justify-center h-32 bg-muted/20 rounded-lg">
      <div class="text-center mb-4">
        <p class="text-muted-foreground">Cannot play audio in browser</p>
        <p class="text-sm text-muted-foreground">{filename}</p>
      </div>
      <button
        onclick={downloadAudio}
        class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Download Audio
      </button>
    </div>
  {:else}
    <div class="flex flex-col items-center">
      <div class="w-full max-w-md">
        <audio
          bind:this={audioElement}
          src={dataUrl}
          controls
          class="w-full"
          onerror={handleAudioError}
        >
          Your browser does not support the audio tag.
        </audio>
      </div>

      <div class="mt-3">
        <button
          onclick={downloadAudio}
          class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
        >
          Download Audio
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .audio-viewer {
    width: 100%;
    padding: 1rem;
  }
</style>
