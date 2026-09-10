/** Development-only adapters for real routes; Playwright serves the fixture iframe HTML. */
import {get} from "svelte/store"
import {goto} from "$app/navigation"
import {pubkey, repository} from "@welshman/app"
import type {TrustedEvent} from "@welshman/util"
import {applyRemoteExtensionSettings, extensionSettings} from "../../../src/app/extensions/settings"
import type {SmartWidgetEvent} from "../../../src/app/extensions/types"

export function cacheRepositoryIdentityEvent(event: TrustedEvent) {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  // Welshman's local read cache, not the signing/relay publication transport.
  repository.publish(event)
}

export function navigateRepositoryIdentityRoute(path: string) {
  if (!import.meta.env.DEV || !path.startsWith("/git/naddr"))
    throw new Error("Repository fixture route only")
  return goto(path)
}

export function installRepositoryIdentityWidget() {
  if (!import.meta.env.DEV || get(pubkey)) throw new Error("Anonymous development fixture only")
  const previous = get(extensionSettings)
  const id = "identity-review-widget"
  const widget = {
    id,
    kind: 30033,
    pubkey: "",
    created_at: 1,
    tags: [],
    identifier: id,
    content: "Identity review",
    widgetType: "tool",
    appUrl: `${location.origin}/tests/e2e/fixtures/repository-identity-widget.html`,
    slot: {type: "repo-tab", path: "identity-review", label: "Identity review"},
    permissions: ["storage:get", "storage:set"],
    imageUrl: "",
    buttons: [],
  } as SmartWidgetEvent
  applyRemoteExtensionSettings({
    ...previous,
    enabled: [...previous.enabled, id],
    installed: {...previous.installed, widget: {...previous.installed.widget, [id]: widget}},
  })
  return () => applyRemoteExtensionSettings(previous)
}
