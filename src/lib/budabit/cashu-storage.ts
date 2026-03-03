import {Capacitor} from "@capacitor/core"
import {Preferences} from "@capacitor/preferences"

/**
 * Thin storage adapter: uses @capacitor/preferences on native (iOS/Android)
 * and localStorage on web. This ensures the mnemonic survives OS storage
 * pressure on mobile devices.
 */

export const storageGet = async (key: string): Promise<string | null> => {
  if (Capacitor.isNativePlatform()) {
    const {value} = await Preferences.get({key})
    return value
  }
  return localStorage.getItem(key)
}

export const storageSet = async (key: string, value: string): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    await Preferences.set({key, value})
  } else {
    localStorage.setItem(key, value)
  }
}

export const storageRemove = async (key: string): Promise<void> => {
  if (Capacitor.isNativePlatform()) {
    await Preferences.remove({key})
  } else {
    localStorage.removeItem(key)
  }
}