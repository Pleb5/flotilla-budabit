<script lang="ts">
  import {randomId} from "@welshman/lib"
  import {preventDefault, stopPropagation} from "@lib/html"
  import {ImagePlus, X} from "@lucide/svelte"
  import BlossomUploadStatus from "@app/components/BlossomUploadStatus.svelte"
  import {uploadFile} from "@app/core/commands"
  import type {BlossomUploadStage} from "@app/core/blossom"
  import {promptBlossomMirrorUpload} from "@app/util/blossom-mirror-prompt"

  interface Props {
    file?: File
    url?: string
    uploading?: boolean
    variant?: "avatar" | "banner"
  }
  let {
    file = $bindable(),
    url = $bindable(),
    uploading = $bindable(false),
    variant = "avatar",
  }: Props = $props()
  const id = randomId()
  const label = $derived(variant === "banner" ? "banner image" : "profile image")
  let active = $state(false)
  let uploadStage = $state<BlossomUploadStage>("idle")
  let error = $state("")

  async function selectFile(selected?: File) {
    if (!selected || uploading) return
    error = ""
    if (!selected.type.startsWith("image/")) {
      error = "Choose an image file."
      return
    }
    uploading = true
    file = selected
    try {
      const {result, uploadId} = await uploadFile(selected, {
        onStage: stage => (uploadStage = stage),
      })
      if (result?.url) {
        url = result.url
        promptBlossomMirrorUpload(uploadId)
      } else {
        uploadStage = "failed"
        error =
          "Image upload failed. Your previous image has been kept. Try again or paste an image URL."
      }
    } catch {
      uploadStage = "failed"
      error = "Image upload failed. Please try again."
    } finally {
      uploading = false
    }
  }
  const onDrop = (event: Event) => {
    active = false
    void selectFile((event as DragEvent).dataTransfer?.files[0])
  }
  const onChange = (event: Event) => {
    const input = event.target as HTMLInputElement
    void selectFile(input.files?.[0])
    input.value = ""
  }
  const clear = () => {
    url = ""
    file = undefined
    error = ""
    uploadStage = "idle"
  }
</script>

<div class={variant === "banner" ? "w-full" : "w-24"}>
  <div class="relative">
    <input
      {id}
      type="file"
      accept="image/*"
      aria-label="Upload {label}"
      onchange={onChange}
      disabled={uploading}
      class="peer sr-only" />
    <label
      for={id}
      aria-label="Upload {label}"
      class="relative flex cursor-pointer items-center justify-center overflow-hidden border-2 border-base-content/30 bg-base-300 transition-all peer-focus-visible:ring-2 peer-focus-visible:ring-primary {variant ===
      'banner'
        ? 'h-36 w-full rounded-xl sm:h-44'
        : 'h-24 w-24 rounded-full'}"
      class:border-primary={active}
      ondragenter={stopPropagation(preventDefault(() => (active = true)))}
      ondragover={stopPropagation(preventDefault(() => (active = true)))}
      ondragleave={stopPropagation(preventDefault(() => (active = false)))}
      ondrop={stopPropagation(preventDefault(onDrop))}>
      {#if url}<img
          src={url}
          alt={variant === "banner" ? "Banner preview" : "Profile image preview"}
          class="h-full w-full object-cover" />
      {:else}<ImagePlus class="h-7 w-7 opacity-70" />{/if}
    </label>
    {#if url}
      <button
        type="button"
        class="btn btn-circle btn-neutral btn-xs absolute right-1 top-1"
        aria-label="Remove {label}"
        onclick={clear}
        disabled={uploading}><X class="h-4 w-4" /></button>
    {/if}
  </div>
  <div class="mt-2"><BlossomUploadStatus stage={uploadStage} /></div>
  {#if error}<p role="alert" class="mt-2 text-sm text-error">{error}</p>{/if}
</div>
