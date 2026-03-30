import {VAPID_PUBLIC_KEY} from "@app/core/state"

export const platform = "web"

export const platformName = "Web"

export const initializePushNotifications = () => {}

export const canSendPushNotifications = () => true

export const getWebPushInfo = async () => {
  if (!("serviceWorker" in navigator)) {
    throw new Error("Service Worker not supported")
  }

  if (!("PushManager" in window)) {
    throw new Error("Push notifications are not supported")
  }

  if (Notification.permission === "denied") {
    throw new Error("Push notifications are blocked")
  }

  if (Notification.permission !== "granted") {
    const permission = await Notification.requestPermission()

    if (permission !== "granted") {
      throw new Error("Push notification permission denied")
    }
  }

  const registration = await navigator.serviceWorker.ready

  // This will hang on firefox in development builds, but works in production
  let subscription = await registration.pushManager.getSubscription()

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: VAPID_PUBLIC_KEY,
    })
  }

  const {keys} = subscription.toJSON()

  if (!keys) {
    throw new Error(`Failed to get push info: no keys were returned`)
  }

  return {
    endpoint: subscription.endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
  }
}

export const getPushInfo = () => getWebPushInfo()
