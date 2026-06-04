// Convert plain text (with \n) into HTML that Tiptap will keep as line breaks.
const escapeHtml = (s: string) =>
  s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")

export const plainTextToTiptapHTML = (text: string) => {
  const normalized = (text ?? "").replace(/\r\n?/g, "\n")
  const lines = normalized.split("\n")

  const paragraphs: string[] = []
  let current: string[] = []

  for (const line of lines) {
    if (line === "") {
      if (current.length) {
        paragraphs.push(current.join("<br>"))
        current = []
      }
      paragraphs.push("")
    } else {
      current.push(escapeHtml(line))
    }
  }

  if (current.length) paragraphs.push(current.join("<br>"))

  return paragraphs.map(p => `<p>${p}</p>`).join("")
}
