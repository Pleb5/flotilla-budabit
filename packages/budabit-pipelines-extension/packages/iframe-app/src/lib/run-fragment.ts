import type {WidgetBridge} from 'budabit-sdk'
import {navigateHost} from './host-actions'

export function readRunIdFromUrl(): string | null {
  return /^#run-[0-9a-f]{64}$/.test(window.location.hash) ? window.location.hash.slice(5) : null
}

export function writeRunIdToUrl(bridge: WidgetBridge | null, id: string | null): void {
  const fragment = id ? `#run-${id}` : '#'
  // Older hosts may reject fragment navigation; retain the iframe-local link.
  void navigateHost(bridge, fragment).catch(() => {})
  const baseUrl = window.location.pathname + window.location.search
  history.replaceState(history.state, '', id ? `${baseUrl}${fragment}` : baseUrl)
}
