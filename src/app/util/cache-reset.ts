export const clearServiceWorkers = async () => {
  if (!("serviceWorker" in navigator)) return
  const registrations = await navigator.serviceWorker.getRegistrations()
  console.info("[PWA] Unregistering service workers", registrations.length)
  await Promise.all(registrations.map(registration => registration.unregister()))
}

export const clearCacheStorage = async () => {
  if (!("caches" in window)) return
  const keys = await caches.keys()
  console.info("[PWA] Clearing cache storage", keys)
  await Promise.all(keys.map(key => caches.delete(key)))
}

export const resetAppCache = async () => {
  console.info("[PWA] Resetting app cache")
  await Promise.all([clearServiceWorkers(), clearCacheStorage()])
  console.info("[PWA] App cache reset complete")
}
