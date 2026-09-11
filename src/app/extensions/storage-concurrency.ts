import {sha256} from "@noble/hashes/sha2.js"
import {bytesToHex} from "@noble/hashes/utils.js"

export const supportsAtomicStorage = () =>
  typeof navigator !== "undefined" && typeof navigator.locks?.request === "function"

export const extensionStorageLockName = (key: string) => `budabit:storage:${key}`

// Opaque revision of the exact persisted bytes, including the caller's batch ID.
export const storageRevision = (raw: string | null): string | null =>
  raw === null ? null : bytesToHex(sha256(new TextEncoder().encode(raw)))

type StorageOperation = {
  action: "get" | "set" | "remove" | "compareAndSet"
  withRevision?: boolean
  expectedRevision?: unknown
  data?: unknown
}

/** All bridge writes (and read migrations) participate in the same host-origin lock.
 * No lock is held during signer/relay work. Atomic callers have no unlocked fallback.
 */
export async function accessExtensionStorage(
  locations: string[],
  operation: StorageOperation,
  assertScope: () => void,
  maxValueBytes: number,
): Promise<Record<string, unknown>> {
  const atomic = supportsAtomicStorage()
  const conditional = operation.action === "compareAndSet"
  if ((conditional || operation.withRevision) && !atomic) {
    throw new Error("Atomic extension storage unavailable; a host with Web Locks is required")
  }
  if (
    conditional &&
    operation.expectedRevision !== null &&
    (typeof operation.expectedRevision !== "string" ||
      !/^[0-9a-f]{64}$/.test(operation.expectedRevision))
  ) {
    throw new Error("Invalid expected storage revision")
  }
  if (conditional && !Object.hasOwn(operation, "data")) {
    throw new Error("Conditional storage write requires data (null to remove)")
  }
  const work = () => {
    // Account/repository may change while this tab waits behind another tab.
    assertScope()
    const raw =
      locations.map(key => localStorage.getItem(key)).find(value => value !== null) ?? null
    const revision = storageRevision(raw)
    if (operation.action === "get") {
      let data: unknown
      try {
        data = raw === null ? null : JSON.parse(raw)
      } catch (error) {
        // Preserve an exact discard target even if the raw stored JSON is corrupt.
        if (operation.withRevision)
          return {status: "ok", data: null, invalid: true, revision, atomic}
        throw error
      }
      if (raw !== null && localStorage.getItem(locations[0]) === null) {
        localStorage.setItem(locations[0], raw)
        for (const key of locations.slice(1)) localStorage.removeItem(key)
      }
      return {status: "ok", data, ...(operation.withRevision ? {revision, atomic} : {})}
    }
    if (conditional && operation.expectedRevision !== revision) return {status: "conflict"}
    const serialized = operation.data == null ? null : JSON.stringify(operation.data)
    if (operation.action === "remove" || serialized === null) {
      for (const key of locations) localStorage.removeItem(key)
      return {status: "ok", ...(conditional ? {revision: null} : {})}
    }
    if (new TextEncoder().encode(serialized).byteLength > maxValueBytes) {
      throw new Error(`Value exceeds maximum size of ${maxValueBytes} bytes`)
    }
    localStorage.setItem(locations[0], serialized)
    for (const key of locations.slice(1)) localStorage.removeItem(key)
    return {status: "ok", ...(conditional ? {revision: storageRevision(serialized)} : {})}
  }
  return atomic
    ? navigator.locks.request(extensionStorageLockName(locations[0]), {mode: "exclusive"}, work)
    : work()
}
