import type {GitProvider} from "../../git/provider.js"
import {loadConfig, setDefaultCorsProxyOverride} from "../../git/config.js"

export interface GitWorkerConfig {
  defaultCorsProxy?: string | null
}

let gitConfig: GitWorkerConfig = {}

const applyCorsProxy = (git: GitProvider, corsProxy: string | null) => {
  const target = (git as any).baseProvider ?? git
  if (target && "corsProxy" in (target as any)) {
    ;(target as any).corsProxy = corsProxy
  }
}

export function setGitConfig(config: GitWorkerConfig, git?: GitProvider): void {
  gitConfig = {...gitConfig, ...config}

  if (Object.prototype.hasOwnProperty.call(config, "defaultCorsProxy")) {
    const value = config.defaultCorsProxy ?? null
    setDefaultCorsProxyOverride(value)
    if (git) applyCorsProxy(git, value)
  }
}

export function getGitConfig(): GitWorkerConfig {
  return {...gitConfig}
}

export function resolveDefaultCorsProxy(): string | null {
  if (Object.prototype.hasOwnProperty.call(gitConfig, "defaultCorsProxy")) {
    return gitConfig.defaultCorsProxy ?? null
  }
  const cfg = loadConfig()
  return cfg.defaultCorsProxy ?? null
}

export function applyGitConfigToProvider(git: GitProvider): void {
  if (Object.prototype.hasOwnProperty.call(gitConfig, "defaultCorsProxy")) {
    applyCorsProxy(git, gitConfig.defaultCorsProxy ?? null)
    return
  }
  const cfg = loadConfig()
  applyCorsProxy(git, cfg.defaultCorsProxy ?? null)
}
