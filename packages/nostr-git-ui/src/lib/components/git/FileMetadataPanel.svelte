<script lang="ts">
  import { X, Info } from "@lucide/svelte";
  import { useRegistry } from "../../useRegistry";
  const { Button } = useRegistry();
  import { formatFileSize, type FileTypeInfo } from "../../utils/fileTypeDetection";
  import type { FileEntry } from "@nostr-git/core/types";

  let {
    isOpen = $bindable(),
    file,
    content,
    typeInfo,
    metadata,
  }: {
    isOpen: boolean;
    file: FileEntry;
    content?: string;
    typeInfo?: FileTypeInfo | null;
    metadata?: Record<string, string>;
  } = $props();

  function closePanel() {
    isOpen = false;
  }

  // Enhanced metadata with computed values
  const enhancedMetadata = $derived.by(() => {
    const base = metadata || {};
    const enhanced: Record<string, string> = { ...base };

    // Add computed metadata
    if (file) {
      enhanced["Name"] = file.name || "Unknown";
      enhanced["Path"] = file.path || "";
      enhanced["Type"] = file.type || "file";
    }

    if (content) {
      enhanced["Characters"] = content.length.toLocaleString();
      const lines = content.split("\n").length;
      enhanced["Lines"] = lines.toLocaleString();

      // Estimate reading time (average 200 words per minute)
      const words = content.split(/\s+/).length;
      enhanced["Words"] = words.toLocaleString();
      const readingTime = Math.ceil(words / 200);
      enhanced["Est. Reading Time"] = `${readingTime} min${readingTime !== 1 ? "s" : ""}`;
    }

    if (typeInfo) {
      enhanced["Category"] = typeInfo.category;
      enhanced["MIME Type"] = typeInfo.mimeType;
      enhanced["Can Preview"] = typeInfo.canPreview ? "Yes" : "No";
      enhanced["Can Edit"] = typeInfo.canEdit ? "Yes" : "No";

      if (typeInfo.language) {
        enhanced["Language"] = typeInfo.language;
      }
    }

    return enhanced;
  });

  // Group metadata by category
  const groupedMetadata = $derived.by(() => {
    const groups: Record<string, Record<string, string>> = {
      "File Information": {},
      "Content Analysis": {},
      "Technical Details": {},
    };

    Object.entries(enhancedMetadata).forEach(([key, value]) => {
      if (["Name", "Path", "Type", "Category", "Language"].includes(key)) {
        groups["File Information"][key] = value;
      } else if (["Lines", "Characters", "Words", "Est. Reading Time"].includes(key)) {
        groups["Content Analysis"][key] = value;
      } else {
        groups["Technical Details"][key] = value;
      }
    });

    // Remove empty groups
    return Object.fromEntries(
      Object.entries(groups).filter(([_, group]) => Object.keys(group).length > 0)
    );
  });
</script>

<!-- Modal -->
{#if isOpen}
  <!-- Backdrop -->
  <div
    class="fixed inset-0 bg-black/50 z-[9998] flex items-center justify-center p-4"
    onclick={closePanel}
    role="button"
    tabindex="0"
    onkeydown={(e) => e.key === "Escape" && closePanel()}
  >
    <!-- Modal Content -->
    <div
      class="bg-background border rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] flex flex-col z-[9999]"
      style="border-color: hsl(var(--ng-border));"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => e.key === 'Escape' && closePanel()}
      role="dialog"
      aria-modal="true"
      tabindex="-1"
    >
      <div class="flex flex-col h-full">
    <!-- Header -->
    <div
      class="flex items-center justify-between p-4 border-b"
      style="border-color: hsl(var(--ng-border));"
    >
      <div class="flex items-center gap-2">
        <Info class="h-5 w-5 text-muted-foreground" />
        <h2 class="text-lg font-semibold">File Information</h2>
      </div>
      <Button variant="ghost" size="sm" class="h-8 w-8 p-0" onclick={closePanel}>
        <X class="h-4 w-4" />
      </Button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-y-auto p-4">
      {#if file}
        <!-- File name prominently displayed -->
        <div class="mb-6">
          <h3 class="text-xl font-medium text-foreground break-all">{file.name}</h3>
          {#if file.path && file.path !== file.name}
            <p class="text-sm text-muted-foreground mt-1 break-all">{file.path}</p>
          {/if}
        </div>

        <!-- Metadata groups -->
        {#each Object.entries(groupedMetadata) as [groupName, groupData]}
          <div class="mb-6">
            <h4 class="text-sm font-medium text-foreground mb-3 uppercase tracking-wide">
              {groupName}
            </h4>
            <div class="space-y-2">
              {#each Object.entries(groupData) as [key, value]}
                <div class="flex justify-between items-start gap-4">
                  <span class="text-sm text-muted-foreground min-w-0 flex-shrink-0">
                    {key}:
                  </span>
                  <span class="text-sm text-foreground text-right break-all">
                    {value}
                  </span>
                </div>
              {/each}
            </div>
          </div>
        {/each}

        <!-- File type specific information -->
        {#if typeInfo?.category === "image" && content}
          <div class="mb-6">
            <h4 class="text-sm font-medium text-foreground mb-3 uppercase tracking-wide">
              Image Properties
            </h4>
            <p class="text-sm text-muted-foreground">
              Image dimensions and other properties are displayed when the image loads.
            </p>
          </div>
        {/if}

        <!-- Content Preview -->
        {#if typeInfo?.category === "text" && content}
          <div class="mb-6">
            <h4 class="text-sm font-medium text-foreground mb-3 uppercase tracking-wide">
              Content Preview
            </h4>
            <div class="bg-muted/50 rounded p-3 max-h-32 overflow-y-auto">
              <pre
                class="text-xs text-foreground whitespace-pre-wrap break-all"
                style="font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, Monaco, Consolas, 'DejaVu Sans Mono', monospace;">{content.slice(
                  0,
                  200
                )}{content.length > 200 ? "..." : ""}</pre>
            </div>
          </div>
        {/if}
      {:else}
        <div class="text-center text-muted-foreground py-8">
          <p class="text-sm">No information available for this file.</p>
        </div>
      {/if}
    </div>
      </div>
    </div>
  </div>
{/if}
