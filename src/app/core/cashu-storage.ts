/**
 * Thin storage adapter backed by localStorage for web-only builds.
 */

export const storageGet = async (key: string): Promise<string | null> => {
  return localStorage.getItem(key)
}

export const storageSet = async (key: string, value: string): Promise<void> => {
  localStorage.setItem(key, value)
}

export const storageRemove = async (key: string): Promise<void> => {
  localStorage.removeItem(key)
}
