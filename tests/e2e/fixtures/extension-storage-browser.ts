// Isolated storage-only fixture: no app bootstrap, auth, signing or relay modules.
import {
  accessExtensionStorage,
  extensionStorageLockName,
} from "../../../src/app/extensions/storage-concurrency"

const locations = ["budabit:e2e:extension-storage:current", "budabit:e2e:extension-storage:legacy"]
let release: (() => void) | undefined
const harness = {
  run: (operation: Parameters<typeof accessExtensionStorage>[1]) =>
    accessExtensionStorage(locations, operation, () => {}, 1024 * 1024),
  inspect: () => locations.map(key => localStorage.getItem(key)),
  seed: (legacy = false) => {
    for (const key of locations) localStorage.removeItem(key)
    localStorage.setItem(locations[legacy ? 1 : 0], JSON.stringify({batch: "seed"}))
  },
  hold: () =>
    new Promise<void>(resolve => {
      void navigator.locks.request(extensionStorageLockName(locations[0]), async () => {
        await new Promise<void>(done => {
          release = done
          resolve()
        })
      })
    }),
  release: () => {
    release?.()
    release = undefined
  },
}

declare global {
  interface Window {
    extensionStorageHarness: typeof harness
  }
}
window.extensionStorageHarness = harness
document.body.textContent = "Isolated extension storage ready"
