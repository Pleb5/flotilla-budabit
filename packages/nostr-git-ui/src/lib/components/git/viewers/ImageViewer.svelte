<script lang="ts">
  import { onMount } from "svelte";
  import { createDataUrl } from "../../../utils/binaryHelpers";

  const {
    content,
    filename,
    mimeType,
  }: {
    content: string;
    filename: string;
    mimeType: string;
  } = $props();

  let imageElement = $state<HTMLImageElement>();
  let imageError = $state(false);
  let imageLoaded = $state(false);
  let imageDimensions = $state<{ width: number; height: number } | null>(null);
  let error = $state<string | null>(null);

  // Convert binary content to data URL for display
  let dataUrl = $state("");

  $effect(() => {
    if (content) {
      try {
        dataUrl = createDataUrl(content, mimeType);
        error = null;
      } catch (err) {
        console.error("Failed to create data URL for image:", err);
        error = "Failed to process image data";
        dataUrl = "";
      }
    }
  });

  onMount(() => {
    if (imageElement) {
      imageElement.onload = () => {
        imageLoaded = true;
        imageDimensions = {
          width: imageElement.naturalWidth,
          height: imageElement.naturalHeight,
        };
      };
      imageElement.onerror = () => {
        imageError = true;
      };
    }
  });
</script>

<div class="image-viewer">
  {#if error || imageError}
    <div class="flex flex-col items-center justify-center p-8 text-muted-foreground">
      <p>Failed to load image {filename}</p>
      <p class="text-sm">{error || "Unknown error"}</p>
    </div>
  {:else if dataUrl}
    <div class="relative">
      <img
        src={dataUrl}
        alt={filename}
        class="max-w-full h-auto rounded border"
        onload={(event) => {
          imageLoaded = true;
          const img = event.target as HTMLImageElement;
          imageDimensions = { width: img.naturalWidth, height: img.naturalHeight };
        }}
        onerror={() => {
          imageError = true;
          error = "Image failed to display";
        }}
      />

      {#if imageLoaded && imageDimensions}
        <div class="mt-2 text-sm text-muted-foreground text-center">
          {imageDimensions.width} × {imageDimensions.height} pixels
        </div>
      {/if}
    </div>
  {:else}
    <div class="flex items-center justify-center p-8 text-muted-foreground">
      <div class="text-center">
        <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-2"></div>
        <p>Loading image...</p>
      </div>
    </div>
  {/if}
</div>

<style>
  .image-viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1rem;
  }
</style>
