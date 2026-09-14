import {containsPrivateContext, PrivatePublicationError} from "./private-community-policy"

export const PRIVATE_DIAGNOSTICS_REDACTION = "[private-context]"
const observers = new Set<() => void>()
let currentRoute = ""
export const privateDiagnosticsActive = () =>
  containsPrivateContext(currentRoute) ||
  (typeof location !== "undefined" && containsPrivateContext(location.href))
export const observeDiagnosticsRoute = (route: string) => {
  currentRoute = route
  if (privateDiagnosticsActive()) for (const observer of observers) observer()
}
export const onPrivateDiagnosticsContext = (observer: () => void) => {
  observers.add(observer)
  return () => {
    observers.delete(observer)
  }
}
export const redactPrivateDiagnosticString = (value: string) =>
  containsPrivateContext(value) ? PRIVATE_DIAGNOSTICS_REDACTION : value

// Also recheck old snapshots after private intent is learned or the route/account
// changes. Do not retain sensitive object keys or encoded locator values.
export const redactPrivateDiagnostics = <T>(value: T): T => {
  if (typeof value === "string") return redactPrivateDiagnosticString(value) as T
  if (Array.isArray(value)) return value.map(redactPrivateDiagnostics) as T
  if (!value || typeof value !== "object") return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      redactPrivateDiagnosticString(key),
      redactPrivateDiagnostics(item),
    ]),
  ) as T
}
export const assertDiagnosticsExportContext = (value: unknown = "") => {
  const text = typeof value === "string" ? value : JSON.stringify(value)
  if (
    privateDiagnosticsActive() ||
    containsPrivateContext(text) ||
    text?.includes(PRIVATE_DIAGNOSTICS_REDACTION)
  )
    throw new PrivatePublicationError()
}

// Guard the actual bytes before upload authorization, not just manifest tags.
// This includes artifacts prepared before visiting/leaving a private route.
export const assertDiagnosticsArtifact = async (artifact: {
  bytes: Uint8Array
  encoding: "gzip" | "identity"
}) => {
  assertDiagnosticsExportContext()
  if (artifact.bytes.length > 64 * 1024 * 1024)
    throw Error("Diagnostics artifact exceeds the privacy inspection bound")
  let stream = new Blob([artifact.bytes as BlobPart]).stream()
  if (artifact.encoding === "gzip") stream = stream.pipeThrough(new DecompressionStream("gzip"))
  const reader = stream.getReader(),
    decoder = new TextDecoder()
  let text = "",
    size = 0
  try {
    while (true) {
      const {done, value} = await reader.read()
      if (done) break
      if ((size += value.length) > 64 * 1024 * 1024)
        throw Error("Diagnostics artifact exceeds the privacy inspection bound")
      text += decoder.decode(value, {stream: true})
    }
    text += decoder.decode()
  } finally {
    await reader.cancel()
  }
  assertDiagnosticsExportContext(text)
  return text
}
