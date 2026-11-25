import {build, files, version} from "$service-worker"

const APP_CACHE_PREFIX = "budabit-app-"
const APP_CACHE_NAME = `${APP_CACHE_PREFIX}${version}`
const APP_BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "")
const CACHE_BATCH_SIZE = 12
const STARTUP_ACTIVATION_MARKER_TIMEOUT = 3_000
const FETCH_DIAGNOSTICS_AVAILABLE = import.meta.env.VITE_DIAGNOSTICS === "1"
const activeFetchDiagnostics = new Map()
let fetchDiagnosticsEnabled = false
let fetchDiagnosticSequence = 0

const toAppPath = path => {
  const pathname = path.startsWith("/") ? path : `/${path}`

  if (!APP_BASE || pathname === APP_BASE || pathname.startsWith(`${APP_BASE}/`)) {
    return pathname
  }

  return `${APP_BASE}${pathname}`
}

const INDEX_PATH = toAppPath("/index.html")
const VERSION_PATH = toAppPath("/_app/version.json")
const CACHE_COMPLETE_PATH = toAppPath("/__budabit_app_cache_complete__")
const NETWORK_ONLY_PATHS = new Set([
  VERSION_PATH,
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
const IMMUTABLE_PATH_PREFIX = toAppPath("/_app/immutable/")

self.__SW_VERSION__ = version
self.__SW_BUILD_CONTRACT__ = "budabit-build:" + import.meta.env.VITE_BUILD_ID

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

const getPublishedVersion = async signal => {
  const versionUrl = new URL(toAbsoluteUrl(VERSION_PATH))
  versionUrl.searchParams.set("_budabitWorker", version)
  const response = await fetch(
    new Request(versionUrl, {
      cache: "no-store",
      headers: {"cache-control": "no-cache", pragma: "no-cache"},
      signal,
    }),
  )

  if (!response.ok) {
    throw new Error(`Failed to read published app version: ${response.status}`)
  }

  const payload = await response.json()
  return typeof payload?.version === "string" ? payload.version : ""
}

const assertPublishedVersion = async () => {
  const publishedVersion = await getPublishedVersion()
  if (publishedVersion !== version) {
    throw new Error(
      `App build ${version} is not published (current marker: ${publishedVersion || "missing"})`,
    )
  }
}

// Static hosts and nsite gateways can answer a missing file with the HTML app shell and
// status 200. Never cache that as a script, stylesheet or JSON file.
const NON_HTML_ASSET_PATH = /\.(?:m?js|css|json|webmanifest)$/
const isHtmlForNonHtmlAsset = (pathname, response) =>
  NON_HTML_ASSET_PATH.test(pathname) &&
  (response.headers.get("content-type") || "").toLowerCase().startsWith("text/html")

const cacheAppShell = async () => {
  try {
    await assertPublishedVersion()
    const cache = await caches.open(APP_CACHE_NAME)
    const reusableCaches = await getCompletedAppCaches()

    for (let index = 0; index < APP_SHELL_PATHS.length; index += CACHE_BATCH_SIZE) {
      const batch = APP_SHELL_PATHS.slice(index, index + CACHE_BATCH_SIZE)
      await Promise.all(
        batch.map(async pathname => {
          if (pathname.startsWith(IMMUTABLE_PATH_PREFIX)) {
            for (const reusableCache of reusableCaches) {
              const response = await reusableCache.match(toAbsoluteUrl(pathname))
              if (response && !isHtmlForNonHtmlAsset(pathname, response)) {
                await cache.put(toAbsoluteUrl(pathname), response)
                return
              }
            }
          }

          const response = await fetch(new Request(toAbsoluteUrl(pathname), {cache: "reload"}))

          if (!response.ok) {
            throw new Error(`Failed to cache ${pathname}: ${response.status}`)
          }

          if (isHtmlForNonHtmlAsset(pathname, response)) {
            throw new Error(`Refusing to cache HTML for ${pathname}`)
          }

          await cache.put(toAbsoluteUrl(pathname), response)
        }),
      )
    }

    // A newer deploy may have started while this cache was downloading.
    await assertPublishedVersion()
    await cache.put(
      toAbsoluteUrl(CACHE_COMPLETE_PATH),
      new Response(JSON.stringify({version, completedAt: Date.now()}), {
        headers: {"content-type": "application/json"},
      }),
    )
  } catch (error) {
    await caches.delete(APP_CACHE_NAME)
    throw error
  }
}

const getCompletedAppCaches = async () => {
  const keys = await caches.keys()
  const completed = []

  for (const cacheName of keys) {
    if (!cacheName.startsWith(APP_CACHE_PREFIX) || cacheName === APP_CACHE_NAME) continue
    const cache = await caches.open(cacheName)
    if (await cache.match(toAbsoluteUrl(CACHE_COMPLETE_PATH))) completed.push(cache)
  }

  return completed.reverse()
}

const getAppCacheNamesToKeep = async () => {
  const keys = await caches.keys()
  const otherAppCacheNames = keys.filter(
    key => key.startsWith(APP_CACHE_PREFIX) && key !== APP_CACHE_NAME,
  )
  const completedCaches = await Promise.all(
    otherAppCacheNames.map(async (cacheName, order) => {
      const cache = await caches.open(cacheName)
      const response = await cache.match(toAbsoluteUrl(CACHE_COMPLETE_PATH))
      if (!response) return {cacheName, completedAt: 0, order}

      try {
        const metadata = await response.json()
        return {
          cacheName,
          completedAt: Number.isFinite(metadata?.completedAt) ? metadata.completedAt : 0,
          order,
        }
      } catch {
        return {cacheName, completedAt: 0, order}
      }
    }),
  )
  const previousCacheName =
    completedCaches.sort((a, b) => b.completedAt - a.completedAt || b.order - a.order)[0]
      ?.cacheName ||
    otherAppCacheNames.at(-1) ||
    ""

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

const getFetchRequestClass = (request, pathname) => {
  if (request.mode === "navigate") return "navigation"
  if (pathname === VERSION_PATH) return "version"
  if (NETWORK_ONLY_PATHS.has(pathname)) return "worker"
  if (APP_SHELL_PATH_SET.has(pathname)) return "app-shell"
  if (pathname.startsWith(IMMUTABLE_PATH_PREFIX)) return "immutable"
  return "other"
}

const trackFetchResponse = (request, pathname, response) => {
  if (!fetchDiagnosticsEnabled) return response

  fetchDiagnosticSequence += 1
  const id = fetchDiagnosticSequence
  activeFetchDiagnostics.set(id, {
    requestClass: getFetchRequestClass(request, pathname),
    mode: request.mode || "",
    destination: request.destination || "",
    startedAt: Date.now(),
  })

  return Promise.resolve(response).finally(() => activeFetchDiagnostics.delete(id))
}

const getFetchActivity = () => {
  const now = Date.now()
  const requests = Array.from(activeFetchDiagnostics.values(), request => ({
    requestClass: request.requestClass,
    mode: request.mode,
    destination: request.destination,
    ageMs: Math.max(0, now - request.startedAt),
  })).slice(0, 20)

  return {
    enabled: fetchDiagnosticsEnabled,
    inFlightCount: activeFetchDiagnostics.size,
    oldestAgeMs: requests.reduce((oldest, request) => Math.max(oldest, request.ageMs), 0),
    requests,
  }
}

self.addEventListener("install", event => {
  event.waitUntil(
    (async () => {
      await cacheAppShell()
      await notifyClients({type: "APP_CACHE_READY", version})
    })(),
  )
})

self.addEventListener("message", event => {
  const data = event.data

  if (data && data.type === "APP_CACHE_GET_VERSION") {
    // startupActivation: this worker handles APP_CACHE_ACTIVATE_IF_SOLE_CLIENT.
    event.ports?.[0]?.postMessage({type: "APP_CACHE_VERSION", version, startupActivation: true})
    return
  }

  if (data?.type === "APP_CACHE_SET_FETCH_DIAGNOSTICS") {
    fetchDiagnosticsEnabled = FETCH_DIAGNOSTICS_AVAILABLE && data.enabled === true
    return
  }

  if (data?.type === "APP_CACHE_GET_FETCH_ACTIVITY") {
    event.ports?.[0]?.postMessage({
      type: "APP_CACHE_FETCH_ACTIVITY",
      version,
      requestId: typeof data.requestId === "string" ? data.requestId.slice(0, 200) : "",
      ...getFetchActivity(),
    })
    return
  }

  if (data?.type === "APP_CACHE_ACTIVATE_IF_SOLE_CLIENT") {
    // Startup auto-update: activate only if the requesting window is the only window of this
    // origin and this worker's build is still published. Other windows may hold drafts or live
    // calls, and activation makes every older open window reload into the new build. The page
    // stops waiting after `deadline`, so this worker never activates after it.
    const port = event.ports?.[0]
    const requesterId = event.source && "id" in event.source ? event.source.id : ""
    const deadline = typeof data.deadline === "number" ? data.deadline : 0
    const reply = (accepted, reason, windowClients) =>
      port?.postMessage({
        type: "APP_CACHE_ACTIVATE_IF_SOLE_CLIENT_RESULT",
        version,
        accepted,
        reason,
        windowClients,
      })
    const countWindows = async () => {
      const windows = await self.clients.matchAll({type: "window", includeUncontrolled: true})
      return {
        sole: Boolean(requesterId) && windows.length === 1 && windows[0].id === requesterId,
        count: windows.length,
      }
    }
    event.waitUntil(
      (async () => {
        try {
          // Cheap check first: refuse without a network request while another window is open.
          let windows = await countWindows()
          if (!windows.sole) return reply(false, "other-windows", windows.count)

          const marker = new AbortController()
          const markerTimer = setTimeout(() => marker.abort(), STARTUP_ACTIVATION_MARKER_TIMEOUT)
          let publishedVersion = ""
          try {
            publishedVersion = await getPublishedVersion(marker.signal)
          } finally {
            clearTimeout(markerTimer)
          }
          if (publishedVersion !== version) {
            return reply(false, "not-published", windows.count)
          }

          // Recheck after the network round trip, then decide without awaiting anything.
          windows = await countWindows()
          if (!windows.sole) return reply(false, "other-windows", windows.count)
          if (!deadline || Date.now() > deadline) {
            return reply(false, "deadline", windows.count)
          }
          void self.skipWaiting()
          reply(true, "accepted", windows.count)
        } catch {
          reply(false, "error", -1)
        }
      })(),
    )
    return
  }

  if (data?.type === "SKIP_WAITING") {
    const activationStartedAt = Date.now()
    const requestId = typeof data.requestId === "string" ? data.requestId.slice(0, 200) : ""
    const source = event.source
    const getRegistrationState = () => ({
      installing: self.registration.installing?.state || "",
      waiting: self.registration.waiting?.state || "",
      active: self.registration.active?.state || "",
    })
    const reportActivation = (type, detail = {}) => {
      if (data.diagnostics !== true) return
      source?.postMessage({
        type,
        version,
        requestId,
        registration: getRegistrationState(),
        ...detail,
      })
    }

    reportActivation("APP_CACHE_SKIP_WAITING_RECEIVED")
    const activation = self.skipWaiting()
    activation.then(
      () =>
        reportActivation("APP_CACHE_SKIP_WAITING_RESOLVED", {
          durationMs: Date.now() - activationStartedAt,
        }),
      error =>
        reportActivation("APP_CACHE_SKIP_WAITING_REJECTED", {
          durationMs: Date.now() - activationStartedAt,
          errorName: typeof error?.name === "string" ? error.name : "",
          errorMessage: typeof error?.message === "string" ? error.message.slice(0, 500) : "",
        }),
    )
  }
})

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      await self.clients.claim()
      await notifyClients({type: "APP_CACHE_ACTIVATED", version})

      try {
        await cleanupOldAppCaches()
      } catch (error) {
        console.warn("Service Worker: Failed to clean old app caches", error)
      }
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
    event.respondWith(trackFetchResponse(request, url.pathname, fetchWithoutCache(request)))
    return
  }

  if (request.mode === "navigate") {
    event.respondWith(trackFetchResponse(request, url.pathname, respondFromAppCache(INDEX_PATH)))
    return
  }

  if (APP_SHELL_PATH_SET.has(url.pathname)) {
    event.respondWith(trackFetchResponse(request, url.pathname, respondFromAppCache(url.pathname)))
    return
  }

  if (stripAppBase(url.pathname).startsWith("/_app/immutable/")) {
    event.respondWith(trackFetchResponse(request, url.pathname, appShellMiss(url.pathname)))
  }
})
