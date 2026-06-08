/* global clients, __ALERTS__ */

import {base, build, files, version} from "$service-worker"
import * as nip19 from "nostr-tools/nip19"

const APP_CACHE_PREFIX = "budabit-app-"
const APP_CACHE_NAME = `${APP_CACHE_PREFIX}${version}`
const APP_BASE = base === "/" ? "" : base

const toAppPath = path => {
  const pathname = path.startsWith("/") ? path : `/${path}`

  if (!APP_BASE || pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`)) {
    return pathname
  }

  return `${APP_BASE}${pathname}`
}

const INDEX_PATH = toAppPath("/index.html")
const NETWORK_ONLY_PATHS = new Set([
  toAppPath("/_app/version.json"),
  toAppPath("/service-worker.js"),
  toAppPath("/sw.js"),
])

const hasHiddenPathSegment = pathname =>
  pathname
    .split("/")
    .filter(Boolean)
    .some(segment => segment.startsWith("."))

const shouldPrecachePath = pathname =>
  !pathname.endsWith(".map") && !NETWORK_ONLY_PATHS.has(pathname) && !hasHiddenPathSegment(pathname)

const APP_SHELL_PATHS = Array.from(
  new Set([INDEX_PATH, ...build.map(toAppPath), ...files.map(toAppPath)]),
)
  .filter(shouldPrecachePath)
  .sort()
const APP_SHELL_PATH_SET = new Set(APP_SHELL_PATHS)

self.__SW_VERSION__ = version

const toAbsoluteUrl = pathname => new URL(pathname, self.location.origin).toString()

const isWithinAppBase = pathname =>
  !APP_BASE || pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`)

const stripAppBase = pathname => {
  if (!APP_BASE) return pathname
  if (pathname === APP_BASE) return "/"
  if (pathname.startsWith(`${APP_BASE}/`)) return pathname.slice(APP_BASE.length)
  return pathname
}

const notifyClients = async message => {
  const clientList = await self.clients.matchAll({type: "window", includeUncontrolled: true})

  for (const client of clientList) {
    client.postMessage(message)
  }
}

const cacheAppShell = async () => {
  const cache = await caches.open(APP_CACHE_NAME)

  try {
    await Promise.all(
      APP_SHELL_PATHS.map(async pathname => {
        const response = await fetch(new Request(toAbsoluteUrl(pathname), {cache: "reload"}))

        if (!response.ok) {
          throw new Error(`Failed to cache ${pathname}: ${response.status}`)
        }

        await cache.put(toAbsoluteUrl(pathname), response)
      }),
    )
  } catch (error) {
    await caches.delete(APP_CACHE_NAME)
    throw error
  }
}

const getAppCacheNamesToKeep = async () => {
  const keys = await caches.keys()
  const previousCacheName = keys
    .filter(key => key.startsWith(APP_CACHE_PREFIX) && key !== APP_CACHE_NAME)
    .at(-1)

  return new Set([APP_CACHE_NAME, previousCacheName].filter(Boolean))
}

const cleanupOldAppCaches = async () => {
  const keys = await caches.keys()
  const appCachesToKeep = await getAppCacheNamesToKeep()

  await Promise.all(
    keys
      .filter(key => key.startsWith(APP_CACHE_PREFIX) && !appCachesToKeep.has(key))
      .map(key => caches.delete(key)),
  )
}

const appShellMiss = pathname =>
  new Response(`App shell file is not available in the active cache: ${pathname}`, {
    status: 503,
    statusText: "Service Unavailable",
    headers: {
      "cache-control": "no-store",
      "content-type": "text/plain; charset=utf-8",
    },
  })

const respondFromAppCache = async pathname => {
  const cache = await caches.open(APP_CACHE_NAME)
  const response = await cache.match(toAbsoluteUrl(pathname))

  return response || appShellMiss(pathname)
}

const fetchWithoutCache = request => fetch(new Request(request, {cache: "no-store"}))

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      await cacheAppShell()
      await notifyClients({type: "APP_CACHE_READY", version})
    })(),
  )
})

self.addEventListener("message", event => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting()
  }
})

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      await cleanupOldAppCaches()
      await self.clients.claim()
      await notifyClients({type: "APP_CACHE_ACTIVATED", version})
    })(),
  )
})

self.addEventListener("fetch", event => {
  const {request} = event

  if (request.method !== "GET") return

  const url = new URL(request.url)

  if (url.origin !== self.location.origin) return
  if (!isWithinAppBase(url.pathname)) return

  if (NETWORK_ONLY_PATHS.has(url.pathname)) {
    event.respondWith(fetchWithoutCache(request))
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(respondFromAppCache(INDEX_PATH))
    return
  }

  if (APP_SHELL_PATH_SET.has(url.pathname)) {
    event.respondWith(respondFromAppCache(url.pathname))
    return
  }

  if (stripAppBase(url.pathname).startsWith("/_app/immutable/")) {
    event.respondWith(appShellMiss(url.pathname))
  }
})

self.addEventListener("push", e => {
  if (typeof __ALERTS__ === "undefined" || !__ALERTS__) return

  console.log("Service Worker: Push event received", e)

  let url = "/"
  let title = "New activity"
  let body = "You have a new message"

  try {
    const data = e.data?.json()

    if (data?.event) {
      url += nip19.neventEncode({
        id: data.event.id,
        relays: data.relays || [],
      })
    }

    if (data?.title) {
      title = data.title
    }

    if (data?.body) {
      body = data.body
    }
  } catch (e) {
    console.log("Service Worker: Failed to parse push data", e)
  }

  e.waitUntil(
    self.registration.showNotification(title, {
      body,
      data: {url},
      icon: "/pwa-192x192.png",
      badge: "/pwa-64x64.png",
      tag: "flotilla-notification",
      requireInteraction: false,
    }),
  )
})

self.addEventListener("notificationclick", e => {
  console.log("Service Worker: Notification click event", e)

  e.notification.close()

  if (e.action === "close") {
    return
  }

  // Default action or 'open' action
  const url = e.notification.data?.url

  e.waitUntil(
    clients
      .matchAll({
        type: "window",
        includeUncontrolled: true,
      })
      .then(clientList => {
        // Check if app is already open and send navigation message
        for (const client of clientList) {
          if (client.url.includes(location.origin)) {
            client.postMessage({
              type: "NAVIGATE",
              url: url,
            })

            return client.focus()
          }
        }

        // Open new window if app is not open
        if (clients.openWindow) {
          return clients.openWindow(url)
        }
      }),
  )
})
