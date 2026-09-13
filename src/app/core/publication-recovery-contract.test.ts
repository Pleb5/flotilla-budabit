import {readFileSync} from "node:fs"
import {describe, expect, it} from "vitest"

const readProjectFile = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8")

describe("publication recovery source contracts", () => {
  it("shows raw relay feedback across recovery surfaces and retains partial reports", () => {
    for (const name of [
      "PublicationStatus",
      "PublicationRecoveryToast",
      "PublicationRecoveryList",
      "ThunkStatusDetail",
      "ThunkToast",
      "RelayDeliveryNotice",
    ]) {
      expect(readProjectFile(`../components/${name}.svelte`)).toContain("RelayPublishFeedback")
    }
    const feedback = readProjectFile("../components/RelayPublishFeedback.svelte")
    expect(feedback).toContain("outcome.detail")
    expect(feedback).not.toContain("{@html")
    expect(readProjectFile("../components/NotificationsModal.svelte")).toContain(
      "$relayDeliveryNotices.size",
    )
    expect(readProjectFile("../components/PublicationRecoveryList.svelte")).toContain(
      "RelayDeliveryNotice",
    )
  })
  it("keeps recovery accessible from the notification center after toast dismissal", () => {
    const observer = readProjectFile("../components/PublicationRecoveryObserver.svelte")
    const list = readProjectFile("../components/PublicationRecoveryList.svelte")
    const notifications = readProjectFile("../components/NotificationsModal.svelte")
    const primaryNav = readProjectFile("../components/PrimaryNav.svelte")

    expect(observer).not.toContain("PublicationRecoveryList")
    expect(observer).not.toContain("fixed z-toast")
    expect(notifications).toContain("PublicationRecoveryList")
    expect(notifications).toContain("openPublicationRecovery")
    expect(notifications).toContain("Publications")
    expect(primaryNav).toContain("publicationOperationsNeedingAttention")
    expect(list).toContain("cancelPublication")
    expect(list).toContain("retryPublication")
    expect(list).toContain("discardPublication")
    expect(list).toContain("Discard local copy")
    expect(list).toContain("Discard retry")
  })

  it("offers discard without treating notification dismissal as discard", () => {
    const toast = readProjectFile("../components/PublicationRecoveryToast.svelte")
    const renderer = readProjectFile("../components/Toast.svelte")

    expect(toast).toContain("discardPublication(operationId)")
    expect(toast).toContain("does not retract")
    expect(renderer).toContain("popToast(item.id)")
    expect(renderer).not.toContain("discardPublication")
  })

  it("surfaces operation capacity errors at reaction and governance boundaries", () => {
    const commands = readProjectFile("./commands.ts")
    const community = readProjectFile("../../routes/c/[community]/+page.svelte")

    expect(commands).toContain("error instanceof PublicationCapacityError")
    expect(commands).toContain('pushToast({theme: "error", message: error.message})')
    expect(community).toContain("let startError: unknown")
    expect(community).toContain("if (started > 0) history.back()")
  })
})
