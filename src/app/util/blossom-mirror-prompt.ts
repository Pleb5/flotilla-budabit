import {get} from "svelte/store"
import BlossomMirrorPrompt from "@app/components/BlossomMirrorPrompt.svelte"
import {
  blossomDashboardState,
  blossomSettings,
  shouldPromptForBlossomMirrorUpload,
} from "@app/core/blossom"
import {pushModal} from "@app/util/modal"
import {pushToast} from "@app/util/toast"

export const promptBlossomMirrorUploads = (uploadIds: Array<string | undefined>) => {
  const uniqueUploadIds = Array.from(new Set(uploadIds.filter((id): id is string => Boolean(id))))
  if (uniqueUploadIds.length === 0) return

  const records = get(blossomDashboardState).uploads.filter(upload =>
    uniqueUploadIds.includes(upload.id),
  )
  const settings = get(blossomSettings)
  const promptUploadIds = records
    .filter(record => shouldPromptForBlossomMirrorUpload({record, settings}))
    .map(record => record.id)

  if (promptUploadIds.length === 0) return

  const multiple = promptUploadIds.length > 1

  pushToast({
    theme: "info",
    timeout: 20_000,
    message: multiple
      ? `${promptUploadIds.length} Blossom uploads ready. Choose optional mirrors?`
      : "Blossom upload ready. Choose optional mirrors?",
    action: {
      message: "Review mirrors",
      onclick: () => pushModal(BlossomMirrorPrompt, {uploadIds: promptUploadIds}),
    },
  })
}

export const promptBlossomMirrorUpload = (uploadId?: string) =>
  promptBlossomMirrorUploads([uploadId])
