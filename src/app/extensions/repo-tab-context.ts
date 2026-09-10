import {buildRepoExtensionUpdate} from "./repo-context"
import {getHostCapabilitySnapshot} from "./host-capabilities"
import type {LoadedWidgetExtension, RepoContext} from "./types"

type SurfaceBridge = {post: (action: string, payload: unknown) => void}

export function postRepoTabContext(
  bridge: SurfaceBridge,
  extension: LoadedWidgetExtension,
  repo: RepoContext | undefined,
  userPubkey: string | null | undefined,
) {
  extension.repoContext = repo
  const update = repo ? buildRepoExtensionUpdate(repo, userPubkey) : null
  bridge.post("context:update", update)
  bridge.post("context:repoUpdate", update?.repo ?? null)
}

export function postRepoTabInit(
  bridge: SurfaceBridge,
  extension: LoadedWidgetExtension,
  userPubkey: string | null | undefined,
  theme: string,
  themeBackground: string,
) {
  bridge.post("widget:init", {
    pubkey: userPubkey || null,
    relays: extension.repoContext?.relays ?? [],
    hostVersion: "2",
    repoContext: extension.repoContext ?? null,
    capabilities: getHostCapabilitySnapshot({widget: extension.widget, slot: "repo-tab"}),
    theme,
    themeBackground,
  })
}
