<script lang="ts">
  import {onMount, onDestroy} from "svelte"
  import {displayUrl, sha256} from "@welshman/lib"
  import {getTags, getBlob, decryptFile, getTagValue, tagsFromIMeta} from "@welshman/util"
  import {getBlossomServerList, loadBlossomServerList, signer} from "@welshman/app"
  import LinkRound from "@assets/icons/link-round.svg?dataurl"
  import Icon from "@lib/components/Icon.svelte"
  import {activeCommunityBlossomServers} from "@app/core/community-state"
  import {
    extractSha256FromUrl,
    getBlossomFallbackTargets,
    getBlossomServersFromList,
  } from "@app/util/blossom-fallback"
  import {makeBudabitBlossomAuthEvent, makeBudabitBlossomAuthHeader} from "@app/util/blossom-auth"

  const {value, event, ...props} = $props()

  const url = value.url.toString()
  const meta =
    getTags("imeta", event.tags)
      .map(tagsFromIMeta)
      .find(meta => getTagValue("url", meta) === url) || event.tags

  // Fallback to filename if hash was omitted from the message for interoperability
  const hash = getTagValue("x", meta) || extractSha256FromUrl(url)
  const key = getTagValue("decryption-key", meta)
  const nonce = getTagValue("decryption-nonce", meta)
  const algorithm = getTagValue("encryption-algorithm", meta)
  const mimeType = getTagValue("m", meta)

  const getOriginalServer = () => {
    try {
      return new URL(url).origin
    } catch {
      return ""
    }
  }

  const getAuthorBlossomServers = async () => {
    if (!event.pubkey) return []

    try {
      await loadBlossomServerList(event.pubkey)
    } catch {
      // Use whatever is already cached when relay lookups fail.
    }

    return getBlossomServersFromList(getBlossomServerList(event.pubkey))
  }

  const getFallbackTargets = async () => {
    if (!hash) return []

    return getBlossomFallbackTargets({
      hash,
      originalUrl: url,
      originalServers: [getOriginalServer()],
      communityServers: $activeCommunityBlossomServers,
      authorServers: await getAuthorBlossomServers(),
    })
  }

  const makeGetAuthEvent = async (server: string) => {
    const activeSigner = signer.get()

    return activeSigner
      ? activeSigner.sign(makeBudabitBlossomAuthEvent({action: "get", server, hashes: [hash]}))
      : undefined
  }

  const readVerifiedBytes = async (res: Response) => {
    if (!res.ok) return undefined

    const bytes = await res.arrayBuffer()
    if (hash && (await sha256(bytes)) !== hash) return undefined

    return bytes
  }

  const fetchOriginalBytes = async () => {
    try {
      return readVerifiedBytes(await fetch(url))
    } catch {
      return undefined
    }
  }

  const fetchFallbackBytes = async () => {
    for (const target of await getFallbackTargets()) {
      try {
        const authEvent = await makeGetAuthEvent(target.server)
        const res = await getBlob(
          target.server,
          hash,
          authEvent ? {headers: {Authorization: makeBudabitBlossomAuthHeader(authEvent)}} : {},
        )
        const bytes = await readVerifiedBytes(res)

        if (bytes) return bytes
      } catch {
        // Try the next fallback server.
      }
    }
  }

  const setObjectSrc = (blob: Blob) => {
    if (objectSrc) URL.revokeObjectURL(objectSrc)

    objectSrc = URL.createObjectURL(blob)
    src = objectSrc
  }

  const loadEncryptedImage = async () => {
    if (!key || !nonce || !algorithm) {
      hasError = true
      return
    }

    const bytes = (await fetchOriginalBytes()) || (await fetchFallbackBytes())
    if (!bytes) {
      hasError = true
      return
    }

    try {
      const decryptedData = await decryptFile({
        ciphertext: new Uint8Array(bytes),
        key,
        nonce,
        algorithm,
      })

      setObjectSrc(new Blob([new Uint8Array(decryptedData)]))
    } catch {
      hasError = true
    }
  }

  const onError = async () => {
    if (loadingFallback) return

    loadingFallback = true
    try {
      const bytes = await fetchFallbackBytes()

      if (bytes) {
        setObjectSrc(new Blob([bytes], {type: mimeType || undefined}))
      } else {
        hasError = true
      }
    } catch {
      hasError = true
    } finally {
      loadingFallback = false
    }
  }

  let hasError = $state(false)
  let loadingFallback = $state(false)
  let objectSrc = ""
  let src = $state("")

  onMount(async () => {
    // If we have an encryption algorithm, fetch and decrypt
    if (algorithm === "aes-gcm" && key && nonce) {
      await loadEncryptedImage()
    } else {
      src = url
    }
  })

  onDestroy(() => {
    if (objectSrc) URL.revokeObjectURL(objectSrc)
  })
</script>

{#if hasError}
  <a href={url} class="link-content whitespace-nowrap">
    <Icon icon={LinkRound} size={3} class="inline-block" />
    {displayUrl(url)}
  </a>
{:else if src}
  <img alt="" {src} onerror={onError} {...props} />
{/if}
