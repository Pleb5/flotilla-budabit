const PRESERVED_CACHE_PREFIXES = ["budabit-app-"]

self.addEventListener("install", () => {
  self.skipWaiting()
})

self.addEventListener("activate", event => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(
        keys
          .filter(key => !PRESERVED_CACHE_PREFIXES.some(prefix => key.startsWith(prefix)))
          .map(key => caches.delete(key)),
      )

      await clients.claim()
      await self.registration.unregister()
    })(),
  )
})
