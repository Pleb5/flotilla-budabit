import type {GitProvider} from "./provider.js"
import {IsomorphicGitProvider} from "./isomorphic-git-provider.js"
import {CachedGitProvider} from "./cached-provider.js"
import {loadConfig, type GitConfig} from "./config.js"
import * as fsNode from "fs"
import httpNode from "isomorphic-git/http/node"
import httpWeb from "isomorphic-git/http/web"
import LightningFS from "@isomorphic-git/lightning-fs"

let singleton: GitProvider | null = null

export interface CreateGitProviderOptions extends Partial<GitConfig> {
  /** Custom HTTP client (for NIP-98 auth injection) */
  http?: any
  /** Skip singleton caching (for creating isolated providers) */
  skipSingleton?: boolean
}

export function createGitProvider(overrides?: CreateGitProviderOptions): GitProvider {
  const skipSingleton = overrides?.skipSingleton ?? false

  if (!skipSingleton && singleton) return singleton

  const cfg = loadConfig(overrides)

  // Note: compatMode is consumed by isomorphic-git v2 via process.env (dotenv-loaded).
  // We don't branch code here; we just ensure env is loaded in config.
  // Detect browser-like environments, including Web Workers (self)
  const hasWindow = typeof window !== "undefined"
  const hasSelf = typeof self !== "undefined"
  const hasIndexedDB = typeof (globalThis as any).indexedDB !== "undefined"
  const isBrowserLike = (hasWindow || hasSelf) && hasIndexedDB
  const fs = isBrowserLike ? new LightningFS("nostr-git") : fsNode
  // Use custom HTTP client if provided, otherwise use default
  const http = overrides?.http ?? (isBrowserLike ? httpWeb : httpNode)
  const corsProxy =
    cfg.defaultCorsProxy === undefined ? "https://cors.isomorphic-git.org" : cfg.defaultCorsProxy
  const provider = new IsomorphicGitProvider({
    fs,
    http,
    corsProxy,
  })

  if (cfg.cacheMode === "off") {
    if (!skipSingleton) singleton = provider
    return provider
  }

  const cachedProvider = new CachedGitProvider(provider, cfg)
  if (!skipSingleton) singleton = cachedProvider
  return cachedProvider
}
