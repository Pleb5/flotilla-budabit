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

  // Convert content to data URL for video display
  let dataUrl = $state("");
  let videoError = $state(false);
  let videoElement = $state<HTMLVideoElement>();

  $effect(() => {
    try {
      dataUrl = createDataUrl(content, mimeType);
    } catch (error) {
      console.error("Failed to create data URL for video:", error);
      videoError = true;
    }
  });

  function handleVideoError() {
    videoError = true;
  }

  function downloadVideo() {
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
      console.error("Failed to download video:", error);
    }
  }
</script>

<div class="video-viewer">
  {#if videoError}
    <div class="flex flex-col items-center justify-center h-64 bg-muted/20 rounded-lg">
      <div class="text-center mb-4">
        <p class="text-muted-foreground">Cannot play video in browser</p>
        <p class="text-sm text-muted-foreground">{filename}</p>
      </div>
      <button
        onclick={downloadVideo}
        class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Download Video
      </button>
    </div>
  {:else}
    <div class="relative">
      <video
        bind:this={videoElement}
        src={dataUrl}
        controls
        class="w-full max-w-full rounded-lg shadow-sm"
        style="max-height: 600px;"
        onerror={handleVideoError}
      >
        <track kind="captions" srclang="en" label="English" />
        Your browser does not support the video tag.
      </video>

      <div class="mt-2 flex justify-center">
        <button
          onclick={downloadVideo}
          class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
        >
          Download Video
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .video-viewer {
    width: 100%;
  }
</style>
