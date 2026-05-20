import {get} from "svelte/store"
import BlossomMirrorPrompt from "@app/components/BlossomMirrorPrompt.svelte"
import {
  blossomDashboardState,
  blossomSettings,
  shouldPromptForBlossomMirrorUpload,
} from "@app/core/blossom"
import {pushModal} from "@app/util/modal"
import {pushToast} from "@app/util/toast"

export const promptBlossomMirrorUpload = (uploadId?: string) => {
  if (!uploadId) return

  const record = get(blossomDashboardState).uploads.find(upload => upload.id === uploadId)
  const settings = get(blossomSettings)

  if (!shouldPromptForBlossomMirrorUpload({record, settings})) return

  pushToast({
    theme: "info",
    timeout: 20_000,
    message: "Blossom upload ready. Choose optional mirrors?",
    action: {
      message: "Review mirrors",
      onclick: () => pushModal(BlossomMirrorPrompt, {uploadId}),
    },
  })
}
