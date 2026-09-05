import {joinBytes, parsePktLines} from "./pkt-line.js"
import {parsePackfile, type PackfileResult} from "./parse-packfile.js"
import {assertSuccessfulResponse, type GitNaturalRequestOptions} from "./request.js"

export class MissingRef extends Error {
  constructor(message = "missing ref") {
    super(message)
    this.name = "MissingRef"
  }
}

const decoder = new TextDecoder("utf-8")

export async function fetchPackfile(
  url: string,
  want: string,
  options: GitNaturalRequestOptions,
): Promise<PackfileResult> {
  const response = await options.fetcher(`${url}/git-upload-pack`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-git-upload-pack-request",
      Accept: "application/x-git-upload-pack-result",
    },
    body: want,
    signal: options.signal,
  })
  assertSuccessfulResponse(response, "git upload-pack")

  const bytes = new Uint8Array(await response.arrayBuffer())
  if (bytes.length === 0) throw new Error("empty upload-pack response")

  const packChunks: Uint8Array[] = []
  for (const packet of parsePktLines(bytes)) {
    if (packet.type !== "data" || packet.payload.length === 0) continue

    const channel = packet.payload[0]
    if (channel === 1) {
      packChunks.push(packet.payload.subarray(1))
      continue
    }
    if (channel === 2) continue
    if (channel === 3) {
      throw new Error(`upload-pack side-band error: ${decoder.decode(packet.payload.subarray(1)).trim()}`)
    }

    const message = decoder.decode(packet.payload).trim()
    if (message.startsWith("ERR ")) {
      if (/not our ref|unadvertised object|no such ref/i.test(message)) {
        throw new MissingRef(message.slice(4))
      }
      throw new Error(`upload-pack error: ${message.slice(4)}`)
    }
    if (packet.payload.length >= 4 && decoder.decode(packet.payload.subarray(0, 4)) === "PACK") {
      packChunks.push(packet.payload)
    }
  }

  if (packChunks.length === 0) throw new Error("upload-pack response contained no packfile data")
  return parsePackfile(joinBytes(packChunks))
}
