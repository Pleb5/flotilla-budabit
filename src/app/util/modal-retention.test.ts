import {beforeEach, describe, expect, it} from "vitest"
import {get} from "svelte/store"
import {
  clearModals,
  closeTopModal,
  modalIds,
  modalStack,
  modals,
  retainTopModal,
  syncModalStoresToActiveId,
} from "./modal"

const notificationModal = {
  id: "notifications",
  component: (() => undefined) as any,
  props: {},
  options: {},
}

describe("modal retention", () => {
  beforeEach(() => {
    clearModals()
    modals.set({notifications: notificationModal})
    modalIds.set(["notifications"])
  })

  it("keeps the active modal mounted and non-dismissible across navigation hashes", () => {
    const release = retainTopModal("notifications")

    syncModalStoresToActiveId("event-target")
    expect(closeTopModal()).toBe(false)

    expect(get(modalIds)).toEqual(["notifications"])
    expect(get(modalStack).map(modal => modal.id)).toEqual(["notifications"])

    release()
    syncModalStoresToActiveId("event-target")
    expect(get(modalIds)).toEqual([])
  })
})
