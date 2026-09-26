import {nip19} from 'nostr-tools'
import type {WidgetBridge} from 'budabit-sdk'

export const HOST_ACTIONS = Symbol('workflow-host-actions')
export interface HostActions {
  openEvent: (id: string) => void
  openProfile: (pubkey: string) => void
}

export function eventPath(id: string, relays: string[] = []): string {
  return `/${nip19.neventEncode({id, relays: [...new Set(relays)]})}`
}

export function profilePath(pubkey: string): string {
  return `/people/${nip19.npubEncode(pubkey)}`
}

export async function navigateHost(bridge: WidgetBridge | null, path: string): Promise<void> {
  if (!bridge) throw new Error('Host navigation is unavailable')
  const response = await bridge.request('ui:navigate', {path}) as {error?: string}
  if (response?.error) throw new Error(response.error)
}

export async function copyToClipboard(value: string): Promise<void> {
  // Older hosts may not delegate clipboard-write to the iframe. In that case
  // use the user-initiated copy command without provoking a policy violation.
  const policy = (document as Document & {
    featurePolicy?: {allowsFeature: (feature: string) => boolean}
  }).featurePolicy
  if (navigator.clipboard?.writeText && policy?.allowsFeature('clipboard-write') !== false) {
    try {
      await navigator.clipboard.writeText(value)
      return
    } catch {
      // Fall back for browsers that require a different clipboard mechanism.
    }
  }
  const active = document.activeElement as HTMLElement | null
  const selection = window.getSelection()
  const ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i)) : []
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.readOnly = true
  textarea.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0'
  document.body.append(textarea)
  try {
    textarea.select()
    if (!document.execCommand('copy')) throw new Error('Clipboard copy was blocked')
  } finally {
    textarea.remove()
    active?.focus({preventScroll: true})
    selection?.removeAllRanges()
    for (const range of ranges) selection?.addRange(range)
  }
}
