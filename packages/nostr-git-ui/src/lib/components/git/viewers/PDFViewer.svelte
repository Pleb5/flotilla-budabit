<script lang="ts">
  import { createDataUrl, createBlob } from "../../../utils/binaryHelpers";

  const {
    content,
    filename,
  }: {
    content: string;
    filename: string;
  } = $props();

  // Convert content to data URL for PDF display
  let dataUrl = $state("");
  let pdfError = $state(false);

  $effect(() => {
    try {
      dataUrl = createDataUrl(content, "application/pdf");
    } catch (error) {
      console.error("Failed to create data URL for PDF:", error);
      pdfError = true;
    }
  });

  function handlePdfError() {
    pdfError = true;
  }

  function downloadPdf() {
    try {
      const blob = createBlob(content, "application/pdf");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download PDF:", error);
    }
  }
</script>

<div class="pdf-viewer">
  {#if pdfError}
    <div class="flex flex-col items-center justify-center h-64 bg-muted/20 rounded-lg">
      <div class="text-center mb-4">
        <p class="text-muted-foreground">Cannot display PDF in browser</p>
        <p class="text-sm text-muted-foreground">{filename}</p>
      </div>
      <button
        onclick={downloadPdf}
        class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
      >
        Download PDF
      </button>
    </div>
  {:else}
    <div class="relative">
      <embed
        src={dataUrl}
        type="application/pdf"
        width="100%"
        height="600"
        class="rounded-lg shadow-sm"
        onerror={handlePdfError}
      />

      <div class="mt-2 flex justify-center">
        <button
          onclick={downloadPdf}
          class="px-3 py-1 text-sm bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
        >
          Download PDF
        </button>
      </div>
    </div>
  {/if}
</div>

<style>
  .pdf-viewer {
    width: 100%;
  }
</style>
