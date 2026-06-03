<script lang="ts">
  import { formatFileSize } from "../../../utils/fileTypeDetection";
  import { createBlob } from "../../../utils/binaryHelpers";

  const {
    content,
    filename,
    fileSize,
  }: {
    content: string;
    filename: string;
    fileSize?: number;
  } = $props();

  function downloadFile() {
    try {
      const blob = createBlob(content, "application/octet-stream");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("Failed to download binary file:", error);
    }
  }

  // Generate hex preview for first few bytes
  function getHexPreview(content: string, maxBytes: number = 256): string {
    const bytes = new TextEncoder().encode(content.slice(0, maxBytes));
    const hexLines: string[] = [];

    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const hex = Array.from(chunk)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      const ascii = Array.from(chunk)
        .map((b) => (b >= 32 && b <= 126 ? String.fromCharCode(b) : "."))
        .join("");

      const offset = i.toString(16).padStart(8, "0");
      hexLines.push(`${offset}: ${hex.padEnd(47)} |${ascii}|`);
    }

    return hexLines.join("\n");
  }

  const hexPreview = $derived(getHexPreview(content));
  const displaySize = $derived(fileSize ? formatFileSize(fileSize) : formatFileSize(content.length));
</script>

<div class="binary-viewer">
  <div class="flex flex-col items-center justify-center py-8">
    <div class="text-center mb-6">
      <div class="w-16 h-16 mx-auto mb-4 bg-muted/20 rounded-lg flex items-center justify-center">
        <svg
          class="w-8 h-8 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
          ></path>
        </svg>
      </div>
      <h3 class="text-lg font-medium text-foreground mb-2">Binary File</h3>
      <p class="text-muted-foreground mb-1">{filename}</p>
      <p class="text-sm text-muted-foreground">Size: {displaySize}</p>
    </div>

    <button
      onclick={downloadFile}
      class="px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors mb-6"
    >
      Download File
    </button>

    {#if hexPreview}
      <div class="w-full">
        <h4 class="text-sm font-medium text-foreground mb-2">Hex Preview (first 256 bytes)</h4>
        <div class="bg-muted/20 rounded-lg p-3 overflow-x-auto">
          <pre class="text-xs font-mono text-muted-foreground whitespace-pre">{hexPreview}</pre>
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .binary-viewer {
    width: 100%;
    min-height: 200px;
  }
</style>
