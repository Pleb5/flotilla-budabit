import {mount} from "svelte"
import type {Writable} from "svelte/store"
import {get} from "svelte/store"
import {Router} from "@welshman/router"
import {profileSearch, signer} from "@welshman/app"
import type {FileAttributes} from "@welshman/editor"
import {Editor, MentionSuggestion, WelshmanExtension} from "@welshman/editor"
import {makeMentionNodeView} from "@app/editor/MentionNodeView"
import ProfileSuggestion from "@app/editor/ProfileSuggestion.svelte"
import {uploadFile} from "@app/core/commands"
import {pushToast} from "@app/util/toast"
import { PermalinkExtension } from "@nostr-git/ui"
import Spinner from "@lib/components/Spinner.svelte"

export const makeEditor = async ({
  encryptFiles = false,
  aggressive = false,
  autofocus = false,
  charCount,
  content = "",
  placeholder = "",
  url,
  submit,
  uploading,
  wordCount,
}: {
  encryptFiles?: boolean
  aggressive?: boolean
  autofocus?: boolean
  charCount?: Writable<number>
  content?: string
  placeholder?: string
  url?: string
  submit: () => void
  uploading?: Writable<boolean>
  wordCount?: Writable<number>
}) => {
  return new Editor({
    content,
    autofocus,
    element: document.createElement("div"),
    extensions: [
      PermalinkExtension.configure({
        signer: async (e) => await signer.get().sign(e),
        relays: Router.get().FromUser().getUrls(),
        spinnerComponent: Spinner,
      }),
      WelshmanExtension.configure({
        submit,
        extensions: {
          placeholder: {
            config: {
              placeholder,
            },
          },
          breakOrSubmit: {
            config: {
              aggressive,
            },
          },
          fileUpload: {
            config: {
              upload: (attrs: FileAttributes) =>
                uploadFile(attrs.file, {url, encrypt: encryptFiles}),
              onDrop: () => uploading?.set(true),
              onComplete: () => uploading?.set(false),
              onUploadError(currentEditor, task) {
                currentEditor.commands.removeFailedUploads()
                pushToast({theme: "error", message: task.error})
                uploading?.set(false)
              },
            },
          },
          nprofile: {
            extend: {
              addNodeView: () => makeMentionNodeView(url),
              addProseMirrorPlugins() {
                return [
                  MentionSuggestion({
                    editor: (this as any).editor,
                    search: (term: string) => get(profileSearch).searchValues(term),
                    getRelays: (pubkey: string) => Router.get().FromPubkeys([pubkey]).getUrls(),
                    createSuggestion: (value: string) => {
                      const target = document.createElement("div")

                      mount(ProfileSuggestion, {target, props: {value, url}})

                      return target
                    },
                  }),
                ]
              },
            },
          },
        },
      }),
    ],
    onUpdate({editor}) {
      wordCount?.set(editor.storage.wordCount.words)
      charCount?.set(editor.storage.wordCount.chars)
    },
  })
}
// Convert plain text (with \n) into HTML that Tiptap will keep as line breaks.
const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const plainTextToTiptapHTML = (text: string) => {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n")

  // blank line(s) => new paragraph
  const paragraphs = normalized.split(/\n{2,}/)

  return paragraphs
    .map(p => {
      // single newline inside a paragraph => hard break
      const inner = escapeHtml(p).replaceAll("\n", "<br>")
      // ensure empty paragraphs still render
      return `<p>${inner || "<br>"}</p>`
    })
    .join("")
}
