/**
 * Browser-only factory for GitProvider
 * This file should be used in browser/worker contexts where Node.js modules are not available.
 */
import type {GitProvider} from "./provider.js"
import {IsomorphicGitProvider} from "./isomorphic-git-provider.js"
import {CachedGitProvider} from "./cached-provider.js"
import {loadConfig, type GitConfig} from "./config.js"
import httpWeb from "isomorphic-git/http/web"
import LightningFS from "@isomorphic-git/lightning-fs"

let singleton: GitProvider | null = null

export function createGitProvider(overrides?: Partial<GitConfig>): GitProvider {
  if (singleton) return singleton

  const cfg = loadConfig(overrides)

  const fs = new LightningFS("nostr-git")
  const http = httpWeb
  const corsProxy =
    cfg.defaultCorsProxy === undefined ? "https://cors.isomorphic-git.org" : cfg.defaultCorsProxy
  const provider = new IsomorphicGitProvider({
    fs,
    http,
    corsProxy,
  })

  if (cfg.cacheMode === "off") {
    singleton = provider
    return provider
  }

  singleton = new CachedGitProvider(provider, cfg)
  return singleton
}
