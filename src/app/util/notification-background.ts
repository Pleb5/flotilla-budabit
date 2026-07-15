import {writable} from "svelte/store"

export const notificationBackgroundEnabled = writable(false)

export const setNotificationBackgroundEnabled = (enabled: boolean) =>
  notificationBackgroundEnabled.set(enabled)
