// @vitest-environment jsdom
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest"
import {Editor, Node} from "@tiptap/core"
import {Amount, getEncodedToken} from "@cashu/cashu-ts"
import {CashuToken} from "./CashuToken"

const token = getEncodedToken({
  mint: "https://mint.example",
  unit: "sat",
  proofs: [
    {
      id: "009a1f293253e41e",
      amount: Amount.from(2),
      secret: "public-editor-fixture",
      C: `02${"a".repeat(64)}`,
    },
  ],
})
const legacy =
  "cashuA" +
  Buffer.from(
    JSON.stringify({
      unit: "sat",
      token: [
        {
          mint: "https://mint.example",
          proofs: [
            {
              id: "009a1f293253e41e",
              amount: 2,
              secret: "public-editor-fixture",
              C: `02${"a".repeat(64)}`,
            },
          ],
        },
      ],
    }),
  ).toString("base64url")

const editors: Editor[] = []
const makeEditor = (content = "") => {
  const editor = new Editor({
    element: document.createElement("div"),
    content,
    extensions: [
      Node.create({name: "doc", topNode: true, content: "block+"}),
      Node.create({
        name: "paragraph",
        group: "block",
        content: "inline*",
        parseHTML: () => [{tag: "p"}],
        renderHTML: () => ["p", 0],
      }),
      Node.create({name: "text", group: "inline"}),
      Node.create({
        name: "codeBlock",
        group: "block",
        content: "text*",
        code: true,
        parseHTML: () => [{tag: "pre"}],
        renderHTML: () => ["pre", 0],
      }),
      CashuToken,
    ],
  })
  editors.push(editor)
  return editor
}

// JSDOM lacks ClipboardEvent; ProseMirror supplies the pasted text separately.
beforeEach(() => vi.stubGlobal("ClipboardEvent", class extends Event {}))
afterEach(() => {
  editors.splice(0).forEach(editor => editor.destroy())
  vi.unstubAllGlobals()
})

describe("Cashu composer chips", () => {
  it.each([token, `cashu:${token}`, legacy, `cashu:${legacy}`])(
    "preserves a pasted token verbatim (%#)",
    value => {
      const editor = makeEditor()
      editor.view.pasteText(`Here (${value}), enjoy!`)
      expect(editor.getText()).toBe(`Here (${value}), enjoy!`)
      expect(editor.getJSON().content?.[0].content).toEqual([
        {type: "text", text: "Here ("},
        {type: "cashuToken", attrs: {token: value}},
        {type: "text", text: "), enjoy!"},
      ])
      expect(editor.view.dom.querySelector("[data-cashu-token]")?.textContent).toBe(
        "Cashu · 2 sats",
      )
    },
  )

  it("preserves multiple inline tokens, surrounding text, clipboard text, and HTML round-trips", () => {
    const editor = makeEditor()
    const text = `First ${token}, second cashu:${legacy}!`
    editor.view.pasteText(text)
    expect(editor.view.dom.querySelectorAll("[data-cashu-token]")).toHaveLength(2)
    expect(editor.getText()).toBe(text)
    editor.commands.selectAll()
    expect(editor.view.serializeForClipboard(editor.state.doc.slice(0)).text).toBe(text)
    const restored = makeEditor(editor.getHTML())
    expect(restored.getText()).toBe(text)
    expect(restored.getJSON()).toEqual(editor.getJSON())
  })

  it("leaves invalid tokens and tokens embedded in URLs or words as text", () => {
    const editor = makeEditor()
    const text = `cashuB${"a".repeat(30)} https://example.com/${token} prefix${token}`
    editor.view.pasteText(text)
    expect(editor.getText()).toBe(text)
    expect(editor.view.dom.querySelectorAll("[data-cashu-token]")).toHaveLength(0)
  })

  it("preserves long tokens and line breaks when pasted into a message", () => {
    const longToken = getEncodedToken({
      mint: "https://mint.example",
      unit: "sat",
      proofs: Array.from({length: 32}, (_, index) => ({
        id: "009a1f293253e41e",
        amount: Amount.from(1),
        secret: `public-editor-fixture-${index}`,
        C: `02${"a".repeat(64)}`,
      })),
    })
    const editor = makeEditor()
    const text = `Here you go:\n${longToken}\nThanks!`
    editor.view.pasteText(text)
    expect(editor.getText({blockSeparator: "\n"})).toBe(text)
    expect(editor.view.dom.querySelector("[data-cashu-token]")?.textContent).toBe("Cashu · 32 sats")
  })

  it("deletes a chip as one item without leaving part of the token behind", () => {
    const editor = makeEditor()
    editor.view.pasteText(`Before ${token}`)
    editor.commands.deleteRange({from: 8, to: 9})
    expect(editor.getText()).toBe("Before ")
    expect(editor.view.dom.querySelectorAll("[data-cashu-token]")).toHaveLength(0)
  })

  it("leaves code blocks alone", () => {
    const editor = makeEditor("<pre></pre>")
    editor.view.pasteText(token)
    expect(editor.getText()).toBe(token)
    expect(editor.view.dom.querySelectorAll("[data-cashu-token]")).toHaveLength(0)
  })

  it("uses the normal input rule for a complete token", () => {
    const editor = makeEditor()
    editor.view.someProp("handleTextInput", handler =>
      handler(editor.view, 1, 1, token, () => editor.state.tr.insertText(token)),
    )
    expect(editor.getText()).toBe(token)
    expect(editor.view.dom.querySelectorAll("[data-cashu-token]")).toHaveLength(1)
  })
})
