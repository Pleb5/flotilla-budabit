import {mount, unmount} from "svelte"
import {Address, type TrustedEvent} from "@welshman/util"
import {setNotificationsConfig} from "../../../src/app/util/notifications"
import {theme} from "../../../src/app/util/theme"
import NotificationIndicators from "./NotificationIndicators.svelte"

// UI-only fixtures: no signing, publishing, or personal account state.
export const fixtureRepo: TrustedEvent = {
  id: "1".repeat(64),
  pubkey: "2".repeat(64),
  sig: "",
  kind: 30617,
  created_at: 1,
  content: "",
  tags: [
    ["d", "notification-fixture"],
    ["name", "Repository with unread updates"],
    ["description", "Notification layout fixture"],
  ],
}

export const showNotificationIndicators = (mode: "light" | "dark") => {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  theme.set(mode)
  const target = document.createElement("div")
  target.className = "fixed inset-0 overflow-auto bg-base-300 text-base-content"
  target.style.zIndex = "10000"
  document.body.append(target)
  setNotificationsConfig({
    augmentPaths: paths =>
      new Set([
        ...paths,
        "/chat/notification-fixture",
        `/git/${Address.fromEvent(fixtureRepo).toNaddr()}/issues`,
      ]),
  })
  const component = mount(NotificationIndicators, {target, props: {repo: fixtureRepo}})
  return async () => {
    await unmount(component)
    target.remove()
    setNotificationsConfig({})
  }
}

export const showRouteNotifications = (paths: string[]) => {
  if (!import.meta.env.DEV) throw new Error("Development fixture only")
  setNotificationsConfig({augmentPaths: current => new Set([...current, ...paths])})
}

export const measureNotificationContrast = (selector: string, text = false) => {
  const canvas = document.createElement("canvas")
  canvas.width = canvas.height = 1
  const context = canvas.getContext("2d", {willReadFrequently: true})!
  const rgb = (color: string) => {
    context.clearRect(0, 0, 1, 1)
    context.fillStyle = color
    context.fillRect(0, 0, 1, 1)
    return Array.from(context.getImageData(0, 0, 1, 1).data)
  }
  const luminance = (color: number[]) =>
    color
      .slice(0, 3)
      .map(value => {
        const n = value / 255
        return n <= 0.04045 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4
      })
      .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  const contrast = (a: number[], b: number[]) => {
    const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
    return (lighter + 0.05) / (darker + 0.05)
  }
  return Array.from(document.querySelectorAll<HTMLElement>(selector))
    .filter(element => element.checkVisibility())
    .map(element => {
      const style = getComputedStyle(element)
      let surface = text ? element : element.parentElement
      const layers: number[][] = []
      while (surface) {
        layers.unshift(rgb(getComputedStyle(surface).backgroundColor))
        surface = surface.parentElement
      }
      const background = layers.reduce(
        (under, over) => {
          const alpha = over[3] / 255
          return over.slice(0, 3).map((value, index) => value * alpha + under[index] * (1 - alpha))
        },
        [255, 255, 255],
      )
      const foreground = rgb(text ? style.color : style.backgroundColor)
      const ringColor = style.boxShadow.match(/^(.+) 0px 0px 0px 1px$/)?.[1]
      return {
        text: element.textContent?.trim() || element.title,
        foreground,
        background,
        contrast: Math.max(
          contrast(foreground, background),
          !text && ringColor ? contrast(rgb(ringColor), background) : 0,
        ),
        width: element.getBoundingClientRect().width,
        height: element.getBoundingClientRect().height,
      }
    })
}
