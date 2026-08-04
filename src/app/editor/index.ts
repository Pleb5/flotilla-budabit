import {mount} from "svelte"
import type {Writable} from "svelte/store"
import {get} from "svelte/store"
import {Router} from "@welshman/router"
import {signer} from "@welshman/app"
import type {FileAttributes, WelshmanExtensionOptions} from "@welshman/editor"
import {Editor, MentionSuggestion, WelshmanExtension, editorProps} from "@welshman/editor"
import {makeMentionNodeView} from "@app/editor/MentionNodeView"
import ProfileSuggestion from "@app/editor/ProfileSuggestion.svelte"
import {uploadFile} from "@app/core/commands"
import type {BlossomUploadContext, BlossomUploadStage} from "@app/core/blossom"
import {peopleDiscoverySearch} from "@app/core/people-discovery-search"
import {pushToast} from "@app/util/toast"
import {promptBlossomMirrorUpload} from "@app/util/blossom-mirror-prompt"
import {getQuoteEventTags} from "@app/util/git-quote"
import {PermalinkExtension} from "@nostr-git/ui"
import Spinner from "@lib/components/Spinner.svelte"
export {plainTextToTiptapHTML} from "./text"

type NEventNodeAttrs = {
  id: string
  author?: string
  relays?: string[]
}

// The Welshman runtime accepts `false` for every child extension, but its type
// currently omits that option for fileUpload.
type EditorExtensionOptions = Omit<WelshmanExtensionOptions, "fileUpload"> & {
  fileUpload?: WelshmanExtensionOptions["fileUpload"] | false
}

const expandNeventQTags = (nostrStorage: any) => {
  nostrStorage.getQtags = (hints = true) =>
    nostrStorage
      .getNevents()
      .flatMap(({id, author, relays}: NEventNodeAttrs) =>
        getQuoteEventTags({id, author, relays}, hints),
      )

  nostrStorage.getEditorTags = (hints = true) => [
    ...nostrStorage.getPtags(hints),
    ...nostrStorage.getQtags(hints),
    ...nostrStorage.getAtags(hints),
    ...nostrStorage.getImetaTags(),
    ...nostrStorage.getTtags(),
  ]
}

export const makeEditor = async ({
  encryptFiles = false,
  aggressive = false,
  autofocus = false,
  blossomContext,
  charCount,
  content = "",
  inlineUploads = true,
  placeholder = "",
  url,
  submit,
  uploadStage,
  uploading,
  wordCount,
}: {
  encryptFiles?: boolean
  aggressive?: boolean
  autofocus?: boolean
  blossomContext?: BlossomUploadContext
  charCount?: Writable<number>
  content?: string
  inlineUploads?: boolean
  placeholder?: string
  url?: string
  submit: () => void
  uploadStage?: Writable<BlossomUploadStage>
  uploading?: Writable<boolean>
  wordCount?: Writable<number>
}) => {
  const upload = async (attrs: FileAttributes) => {
    const uploadResult = await uploadFile(attrs.file, {
      blossomContext,
      encrypt: encryptFiles,
      onStage: stage => uploadStage?.set(stage),
    })

    if (uploadResult.result) promptBlossomMirrorUpload(uploadResult.uploadId)

    return uploadResult
  }

  const extensions: EditorExtensionOptions = {
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
    fileUpload: inlineUploads
      ? {
          config: {
            upload,
            onDrop: () => {
              uploadStage?.set("preparing")
              uploading?.set(true)
            },
            onComplete: () => uploading?.set(false),
            onUploadError(currentEditor, task) {
              currentEditor.commands.removeFailedUploads()
              uploadStage?.set("failed")
              pushToast({theme: "error", message: task.error})
              uploading?.set(false)
            },
          },
        }
      : false,
    nprofile: {
      extend: {
        addNodeView: () => makeMentionNodeView(url),
        addProseMirrorPlugins() {
          return [
            MentionSuggestion({
              editor: (this as any).editor,
              search: (term: string) =>
                get(peopleDiscoverySearch).searchValues(term, {
                  context: {scope: "global_discovery"},
                  resultLimit: 8,
                }),
              getRelays: (pubkey: string) => Router.get().FromPubkeys([pubkey]).getUrls(),
              updateSignal: peopleDiscoverySearch,
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
  }

  const editor = new Editor({
    content,
    autofocus,
    editorProps,
    element: document.createElement("div"),
    extensions: [
      PermalinkExtension.configure({
        signer: async e => await signer.get().sign(e),
        relays: Router.get().FromUser().getUrls(),
        spinnerComponent: Spinner,
      }),
      WelshmanExtension.configure({
        submit,
        extensions: extensions as WelshmanExtensionOptions,
      }),
    ],
    onUpdate({editor}) {
      wordCount?.set(editor.storage.wordCount.words)
      charCount?.set(editor.storage.wordCount.chars)
    },
  })

  expandNeventQTags(editor.storage.nostr)

  return editor
}
