import type {ExtensionSlotId, ExtensionSlotHandler, LoadedExtension} from "./types"

const slotHandlers = new Map<ExtensionSlotId, ExtensionSlotHandler[]>()

export const registerSlotHandler = (slot: ExtensionSlotId, handler: ExtensionSlotHandler) => {
  const arr = slotHandlers.get(slot) || []
  arr.push(handler)
  slotHandlers.set(slot, arr)
}

export const getSlotHandlers = (slot: ExtensionSlotId) => slotHandlers.get(slot) || []

export const invokeSlot = (
  slot: ExtensionSlotId,
  args: {root?: HTMLElement; context: Record<string, unknown>; extension?: LoadedExtension},
) => {
  for (const handler of getSlotHandlers(slot)) {
    try {
      handler(args as any)
    } catch (e) {
      console.error("Slot handler error:", e)
    }
  }
}

export const renderSlot = (
  slot: ExtensionSlotId,
  root: HTMLElement,
  context: Record<string, unknown> = {},
  extension?: LoadedExtension,
): void => {
  const handlers = getSlotHandlers(slot)
  handlers.forEach(handler => {
    try {
      handler({root, context, extension})
    } catch (e) {
      console.error(`Error rendering slot ${slot}:`, e)
    }
  })
}
