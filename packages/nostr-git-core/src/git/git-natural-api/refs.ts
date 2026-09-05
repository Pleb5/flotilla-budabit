import {parsePktLines} from "./pkt-line.js"
import {requestBytes, type GitNaturalRequestOptions} from "./request.js"

export type InfoRefsUploadPackResponse = {
  refs: Record<string, string>
  capabilities: string[]
  symrefs: Record<string, string>
}

const decoder = new TextDecoder("utf-8")

export async function getInfoRefs(
  url: string,
  options: GitNaturalRequestOptions,
): Promise<InfoRefsUploadPackResponse> {
  const result: InfoRefsUploadPackResponse = {refs: {}, capabilities: [], symrefs: {}}
  const endpoint = `${url}/info/refs?service=git-upload-pack`
  const bytes = await requestBytes(endpoint, {method: "GET"}, options, "git info/refs")
  for (const packet of parsePktLines(bytes)) {
    if (packet.type !== "data") continue
    const content = decoder.decode(packet.payload).replace(/\n$/, "")
    if (!content || content.startsWith("# service=")) continue
    if (content.startsWith("ERR ")) throw new Error(content.slice(4))

    const separator = content.indexOf(" ")
    if (separator === -1) continue
    const hash = content.slice(0, separator)
    const refAndCaps = content.slice(separator + 1)
    const capabilitySeparator = refAndCaps.indexOf("\0")
    const ref = (
      capabilitySeparator === -1 ? refAndCaps : refAndCaps.slice(0, capabilitySeparator)
    ).trim()
    if (ref) result.refs[ref] = hash

    if (capabilitySeparator !== -1) {
      result.capabilities = refAndCaps
        .slice(capabilitySeparator + 1)
        .trim()
        .split(/\s+/)
        .filter(Boolean)
      for (const capability of result.capabilities) {
        if (!capability.startsWith("symref=")) continue
        const value = capability.slice(7)
        const colon = value.indexOf(":")
        if (colon !== -1) result.symrefs[value.slice(0, colon)] = value.slice(colon + 1)
      }
    }
  }

  return result
}
