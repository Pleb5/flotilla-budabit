import {beforeEach, describe, expect, it, vi} from "vitest"
const mocks = vi.hoisted(() => ({pushModal: vi.fn(), stack: [] as any[], component: {}}))
vi.mock("@app/components/ProfileDetail.svelte", () => ({default: mocks.component}))
vi.mock("@app/util/modal", () => ({
  modalStack: {
    subscribe(run: (stack: any[]) => void) {
      run(mocks.stack)
      return () => {}
    },
  },
  pushModal: mocks.pushModal,
}))
import {openWidgetProfile} from "./profile-modal"
beforeEach(() => {
  mocks.stack = []
  mocks.pushModal.mockReset().mockReturnValue("profile-modal")
})
describe("widget profile modal", () => {
  it("pushes the existing host component while preserving the widget stack and using new-tab full profiles", () => {
    mocks.stack = [{id: "widget"}]
    openWidgetProfile("a".repeat(64), ["wss://community.example"])
    expect(mocks.pushModal).toHaveBeenCalledWith(
      mocks.component,
      {pubkey: "a".repeat(64), relays: ["wss://community.example"], fullProfileInNewTab: true},
      {ariaLabel: "Profile", trapFocus: true},
    )
    expect(mocks.stack).toEqual([{id: "widget"}])
  })
  it("does not stack a duplicate active profile and reports a refused modal", () => {
    mocks.stack = [
      {component: mocks.component, props: {pubkey: "a".repeat(64), fullProfileInNewTab: true}},
    ]
    openWidgetProfile("a".repeat(64), [])
    expect(mocks.pushModal).not.toHaveBeenCalled()
    mocks.stack = []
    mocks.pushModal.mockReturnValue(null)
    expect(() => openWidgetProfile("a".repeat(64), [])).toThrow("Unable to open profile")
  })
})
