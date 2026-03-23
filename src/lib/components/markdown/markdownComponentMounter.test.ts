// @vitest-environment jsdom

import {describe, expect, it, vi, beforeEach} from "vitest"
import {
  mountPlaceholderComponents,
  cleanupMountedComponents,
  type MountedComponent,
} from "./markdownComponentMounter"

const mockMount = vi.fn()
vi.mock("svelte", () => ({
  mount: (...args: unknown[]) => mockMount(...args),
}))

vi.mock("@app/components/Profile.svelte", () => ({default: "Profile"}))
vi.mock("@app/components/ProfileLink.svelte", () => ({default: "ProfileLink"}))
vi.mock("@app/components/ContentLinkBlock.svelte", () => ({default: "ContentLinkBlock"}))
vi.mock("@app/components/ContentQuote.svelte", () => ({default: "ContentQuote"}))

describe("markdownComponentMounter", () => {
  const mockDestroy = vi.fn()

  beforeEach(() => {
    mockMount.mockReset()
    mockMount.mockReturnValue({$destroy: mockDestroy})
    mockDestroy.mockReset()
  })

  describe("mountPlaceholderComponents", () => {
    it("returns empty array when container has no placeholders", () => {
      const container = document.createElement("div")
      container.innerHTML = "<p>Plain text</p>"

      const result = mountPlaceholderComponents(container, {})

      expect(result).toEqual([])
      expect(mockMount).not.toHaveBeenCalled()
    })

    it("mounts profile placeholders and replaces with Profile + ProfileLink", () => {
      const pubkey = "a".repeat(64)
      const container = document.createElement("div")
      container.innerHTML = `<span class="nostr-profile-placeholder" data-pubkey="${pubkey}" data-url=""></span>`

      const result = mountPlaceholderComponents(container, {})

      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(mockMount).toHaveBeenCalledTimes(2)
      expect(mockMount).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        expect.objectContaining({
          target: expect.any(HTMLSpanElement),
          props: expect.objectContaining({
            pubkey,
            avatarSize: 6,
            hideDetails: true,
          }),
        }),
      )
      expect(container.querySelector(".nostr-profile-placeholder")).toBeNull()
      expect(container.querySelector(".inline-flex")).not.toBeNull()
    })

    it("skips profile placeholder without data-pubkey", () => {
      const container = document.createElement("div")
      container.innerHTML = '<span class="nostr-profile-placeholder" data-url=""></span>'

      const result = mountPlaceholderComponents(container, {})

      expect(result).toEqual([])
      expect(mockMount).not.toHaveBeenCalled()
    })

    it("does not mount link block placeholders when event not provided", () => {
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-link-block-placeholder" data-url="https://example.com/img.jpg" data-event-id="evt1"></span>`

      const result = mountPlaceholderComponents(container, {})

      expect(mockMount).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it("mounts link block placeholder when event provided and eventId matches", () => {
      const mockEvent = {id: "evt123"} as any
      const url = "https://example.com/photo.jpg"
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-link-block-placeholder" data-url="${url}" data-event-id="evt123"></span>`

      const result = mountPlaceholderComponents(container, {event: mockEvent})

      expect(mockMount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          props: expect.objectContaining({
            value: {url: new URL(url)},
            event: mockEvent,
          }),
        }),
      )
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it("skips link block placeholder when eventId does not match", () => {
      const mockEvent = {id: "evt123"} as any
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-link-block-placeholder" data-url="https://example.com/img.jpg" data-event-id="evt456"></span>`

      const result = mountPlaceholderComponents(container, {event: mockEvent})

      expect(mockMount).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it("does not mount quote placeholders when event not provided", () => {
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-quote-placeholder" data-type="note" data-id="noteid" data-relays="[]" data-event-id="evt1"></span>`

      const result = mountPlaceholderComponents(container, {})

      expect(mockMount).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })

    it("mounts note quote placeholder when event provided and eventId matches", () => {
      const mockEvent = {id: "evt123"} as any
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-quote-placeholder" data-type="note" data-id="noteid456" data-relays="[]" data-event-id="evt123" data-url="" data-minimal="false" data-depth="0" data-hide-media="1"></span>`

      const result = mountPlaceholderComponents(container, {event: mockEvent})

      expect(mockMount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          props: expect.objectContaining({
            value: {id: "noteid456", relays: []},
            event: mockEvent,
          }),
        }),
      )
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it("mounts nevent quote placeholder with relays", () => {
      const mockEvent = {id: "evt1"} as any
      const relaysAttr = JSON.stringify(["wss://relay.example.com"]).replace(/"/g, "&quot;")
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-quote-placeholder" data-type="nevent" data-id="evtid" data-relays="${relaysAttr}" data-event-id="evt1" data-url="" data-minimal="false" data-depth="0" data-hide-media="1"></span>`

      const result = mountPlaceholderComponents(container, {event: mockEvent})

      expect(mockMount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          props: expect.objectContaining({
            value: {id: "evtid", relays: ["wss://relay.example.com"]},
          }),
        }),
      )
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it("mounts naddr quote placeholder with kind, pubkey, identifier", () => {
      const mockEvent = {id: "evt1"} as any
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-quote-placeholder" data-type="naddr" data-kind="30023" data-pubkey="${"a".repeat(64)}" data-identifier="repo" data-relays="[]" data-event-id="evt1" data-url="" data-minimal="false" data-depth="0" data-hide-media="1"></span>`

      const result = mountPlaceholderComponents(container, {event: mockEvent})

      expect(mockMount).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          props: expect.objectContaining({
            value: expect.objectContaining({
              kind: 30023,
              pubkey: "a".repeat(64),
              identifier: "repo",
              relays: [],
            }),
          }),
        }),
      )
      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it("skips quote placeholder when eventId does not match", () => {
      const mockEvent = {id: "evt123"} as any
      const container = document.createElement("div")
      container.innerHTML = `<span class="markdown-quote-placeholder" data-type="note" data-id="noteid" data-relays="[]" data-event-id="evt456"></span>`

      const result = mountPlaceholderComponents(container, {event: mockEvent})

      expect(mockMount).not.toHaveBeenCalled()
      expect(result).toEqual([])
    })
  })

  describe("cleanupMountedComponents", () => {
    it("calls $destroy on each mounted component", () => {
      const components = [
        {target: document.createElement("div"), component: {$destroy: mockDestroy}},
        {target: document.createElement("div"), component: {$destroy: mockDestroy}},
      ] as MountedComponent[]

      cleanupMountedComponents(components)

      expect(mockDestroy).toHaveBeenCalledTimes(2)
    })

    it("handles components without $destroy gracefully", () => {
      const components = [
        {target: document.createElement("div"), component: {}},
      ] as MountedComponent[]

      expect(() => cleanupMountedComponents(components)).not.toThrow()
    })
  })
})
