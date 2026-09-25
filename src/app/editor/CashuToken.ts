import {Node, nodeInputRule, nodePasteRule} from "@tiptap/core"
import {ParsedType} from "@welshman/content"
import {
  getCashuMintDisplayName,
  getCashuTokenInfo,
  shortenCashuToken,
  splitCashuTokensFromText,
} from "@app/util/cashu-token"

const findTokens = (text: string) => {
  let index = 0
  return splitCashuTokensFromText(text).flatMap(part => {
    const start = index
    index += part.raw.length
    return part.type === ParsedType.Cashu ? [{index: start, text: part.raw}] : []
  })
}

// An inline atom changes only the presentation. Sending and copying retain the complete token.
export const CashuToken = Node.create({
  name: "cashuToken",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {token: {default: "", rendered: false}}
  },

  parseHTML() {
    return [
      {
        tag: "span[data-cashu-token]",
        getAttrs: element => {
          const token = element.getAttribute("data-cashu-token") || ""
          return getCashuTokenInfo(token) ? {token} : false
        },
      },
    ]
  },

  renderHTML({node}) {
    const token = node.attrs.token as string
    const info = getCashuTokenInfo(token)
    return [
      "span",
      {
        "data-cashu-token": token,
        class: "tiptap-object inline-block max-w-full align-bottom",
        contenteditable: "false",
        title: info
          ? `${getCashuMintDisplayName(info.mintUrl)} · ${shortenCashuToken(token)}`
          : shortenCashuToken(token),
      },
      info ? `Cashu · ${info.amount} ${info.unit === "sat" ? "sats" : info.unit}` : "Cashu token",
    ]
  },

  renderText({node}) {
    return node.attrs.token
  },

  addPasteRules() {
    return [
      nodePasteRule({
        find: findTokens,
        type: this.type,
        getAttributes: match => ({token: match[0]}),
      }),
    ]
  },

  addInputRules() {
    return [
      nodeInputRule({
        find: text =>
          findTokens(text).find(match => match.index + match.text.length === text.length) || null,
        type: this.type,
        getAttributes: match => ({token: match[0]}),
      }),
    ]
  },
})
