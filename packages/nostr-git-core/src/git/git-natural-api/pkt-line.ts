const textDecoder = new TextDecoder("utf-8")

export type PktLine =
  | {type: "data"; payload: Uint8Array}
  | {type: "flush" | "delimiter" | "response-end"}

export function parsePktLines(data: Uint8Array): PktLine[] {
  const packets: PktLine[] = []
  let offset = 0

  while (offset < data.length) {
    if (data.length - offset < 4) {
      throw new Error(`truncated pkt-line header at byte ${offset}`)
    }

    const header = textDecoder.decode(data.subarray(offset, offset + 4))
    if (!/^[0-9a-fA-F]{4}$/.test(header)) {
      throw new Error(`invalid pkt-line length '${header}' at byte ${offset}`)
    }

    const length = Number.parseInt(header, 16)
    offset += 4
    if (length === 0) {
      packets.push({type: "flush"})
      continue
    }
    if (length === 1) {
      packets.push({type: "delimiter"})
      continue
    }
    if (length === 2) {
      packets.push({type: "response-end"})
      continue
    }
    if (length < 4) {
      throw new Error(`invalid pkt-line length ${length} at byte ${offset - 4}`)
    }

    const payloadLength = length - 4
    if (payloadLength > data.length - offset) {
      throw new Error(
        `truncated pkt-line payload at byte ${offset - 4}: expected ${payloadLength}, received ${data.length - offset}`,
      )
    }

    packets.push({type: "data", payload: data.subarray(offset, offset + payloadLength)})
    offset += payloadLength
  }

  return packets
}

export function joinBytes(chunks: readonly Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const joined = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.length
  }
  return joined
}
