<script lang="ts">
  import {addSession, makeNip01Session} from "@welshman/app"
  import {preventDefault} from "@lib/html"
  import {nsecDecode, parseNsecsFromText} from "@lib/util"
  import Spinner from "@lib/components/Spinner.svelte"
  import Button from "@lib/components/Button.svelte"
  import Field from "@lib/components/Field.svelte"
  import ModalHeader from "@lib/components/ModalHeader.svelte"
  import ModalFooter from "@lib/components/ModalFooter.svelte"
  import Icon from "@lib/components/Icon.svelte"
  import ShieldWarning from "@assets/icons/shield-warning.svg?dataurl"
  import Key from "@assets/icons/key-minimalistic.svg?dataurl"
  import UploadMinimalistic from "@assets/icons/upload-minimalistic.svg?dataurl"
  import AltArrowLeft from "@assets/icons/alt-arrow-left.svg?dataurl"
  import AltArrowRight from "@assets/icons/alt-arrow-right.svg?dataurl"
  import {clearModals} from "@app/util/modal"
  import {setChecked} from "@app/util/notifications"
  import {pushToast} from "@app/util/toast"

  const KEY_FILE_ACCEPT = ".txt,.text,.md,.json,text/plain,text/markdown,application/json"
  const KEY_FILE_MAX_BYTES = 1024 * 1024
  const KEY_FILE_NAME_PATTERN = /\.(txt|text|md|json)$/i

  const isSupportedKeyFile = (file: File) =>
    !file.type ||
    file.type.startsWith("text/") ||
    file.type === "application/json" ||
    KEY_FILE_NAME_PATTERN.test(file.name)

  const back = () => history.back()

  const loginWithNsec = async (
    value: string,
    invalidMessage = "Enter a valid nsec private key.",
  ) => {
    if (loading) return

    const key = value.trim()
    if (!key) return

    fileError = ""
    loading = true

    try {
      const secret = nsecDecode(key)
      addSession(makeNip01Session(secret))
      pushToast({message: "Successfully logged in!"})
      setChecked("*")
      clearModals()
    } catch {
      pushToast({theme: "error", message: invalidMessage})
    } finally {
      loading = false
    }
  }

  const submit = async () => loginWithNsec(nsec)

  const showFileError = (message: string) => {
    fileError = message
    pushToast({theme: "error", message})
  }

  const handleKeyFile = async (file: File | undefined) => {
    if (loading || !file) return

    selectedFileName = file.name
    fileError = ""

    if (!isSupportedKeyFile(file)) {
      showFileError("Choose a text key file, such as Nostr Secret Key.txt.")
      return
    }

    if (file.size > KEY_FILE_MAX_BYTES) {
      showFileError("Choose a key file smaller than 1 MB.")
      return
    }

    let text = ""

    try {
      text = await file.text()
    } catch {
      showFileError("Could not read the selected key file.")
      return
    }

    const result = parseNsecsFromText(text)

    if (result.nsecs.length === 1) {
      nsec = result.nsecs[0]
      await loginWithNsec(result.nsecs[0], "The selected file does not contain a valid nsec.")
      return
    }

    if (result.nsecs.length > 1) {
      showFileError("The selected file contains multiple nsecs. Paste the key you want to use.")
      return
    }

    if (result.hasEncryptedNsec) {
      showFileError("Encrypted ncryptsec key files need a password and are not supported here yet.")
      return
    }

    if (result.hasInvalidNsec) {
      showFileError("The selected file contains an invalid nsec private key.")
      return
    }

    showFileError("No nsec private key was found in the selected file.")
  }

  const handleFiles = async (files: FileList | null | undefined) => {
    if (!files?.length) return

    if (files.length > 1) {
      showFileError("Choose one key file at a time.")
      return
    }

    await handleKeyFile(files[0])
  }

  const onFileChange = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement

    await handleFiles(input.files)

    input.value = ""
  }

  const preventFileEvent = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onDragEnter = (event: DragEvent) => {
    preventFileEvent(event)
    if (!loading) dragActive = true
  }

  const onDragOver = (event: DragEvent) => {
    preventFileEvent(event)
    if (loading) return

    dragActive = true

    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy"
  }

  const onDragLeave = (event: DragEvent) => {
    preventFileEvent(event)

    const current = event.currentTarget as HTMLElement
    const next = event.relatedTarget as Node | null

    if (next && current.contains(next)) return

    dragActive = false
  }

  const onDrop = async (event: DragEvent) => {
    preventFileEvent(event)
    dragActive = false

    if (loading) return

    await handleFiles(event.dataTransfer?.files)
  }

  let nsec = $state("")
  let loading = $state(false)
  let fileError = $state("")
  let dragActive = $state(false)
  let selectedFileName = $state("")
</script>

<form class="column gap-4" onsubmit={preventDefault(submit)}>
  <ModalHeader>
    {#snippet title()}
      <div>Log In with Local Key</div>
    {/snippet}
    {#snippet info()}
      <div>Use an nsec private key stored on this device.</div>
    {/snippet}
  </ModalHeader>

  <div class="rounded-box border border-warning/40 bg-warning/10 p-3 text-sm">
    <div class="flex items-center gap-2 font-semibold">
      <Icon icon={ShieldWarning} />
      least secure
    </div>
    <p class="mt-1 opacity-80">
      Prefer an extension or remote signer when possible. A local key grants full account access
      from this browser profile.
    </p>
  </div>

  <Field>
    {#snippet label()}
      <p>Private key</p>
    {/snippet}
    {#snippet input()}
      <label class="input input-bordered flex w-full items-center gap-2">
        <Icon icon={Key} />
        <input
          bind:value={nsec}
          oninput={() => (fileError = "")}
          disabled={loading}
          type="password"
          class="grow"
          autocomplete="off"
          spellcheck="false"
          placeholder="nsec1..." />
      </label>
    {/snippet}
    {#snippet info()}
      <p>The key is stored encrypted at rest using NIP-44 encryption to self.</p>
    {/snippet}
  </Field>

  <Field error={fileError}>
    {#snippet label()}
      <p>Key file</p>
    {/snippet}
    {#snippet input()}
      <input
        id="local-key-file"
        type="file"
        accept={KEY_FILE_ACCEPT}
        disabled={loading}
        class="hidden"
        onchange={onFileChange} />
      <label
        for="local-key-file"
        aria-disabled={loading}
        class="flex cursor-pointer flex-col items-center gap-2 rounded-box border border-dashed border-base-content/20 p-4 text-center transition-all hover:border-primary hover:bg-base-300/30"
        class:border-primary={dragActive}
        class:bg-base-300={dragActive}
        class:cursor-not-allowed={loading}
        class:opacity-60={loading}
        ondragenter={onDragEnter}
        ondragover={onDragOver}
        ondragleave={onDragLeave}
        ondrop={onDrop}>
        <Icon icon={UploadMinimalistic} />
        <div class="font-medium">
          {selectedFileName || "Choose a key file or drop it here"}
        </div>
        <p class="text-xs opacity-60">
          Text files only. If one valid nsec is found, log in starts automatically.
        </p>
      </label>
    {/snippet}
    {#snippet info()}
      <p>Use the Nostr Secret Key.txt file downloaded during signup.</p>
    {/snippet}
  </Field>

  <ModalFooter>
    <Button class="btn btn-link" onclick={back} disabled={loading}>
      <Icon icon={AltArrowLeft} />
      Go back
    </Button>
    <Button type="submit" class="btn btn-primary" disabled={loading || !nsec.trim()}>
      <Spinner {loading}>Log in</Spinner>
      <Icon icon={AltArrowRight} />
    </Button>
  </ModalFooter>
</form>
